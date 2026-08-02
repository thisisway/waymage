import {
  AssetKind,
  AssetStatus,
  GenerationStatus,
  ProviderRunStatus,
  type Prisma,
  type PrismaClient,
} from '@waymage/database';
import {
  assertTransition,
  generationJobPayloadSchema,
  isTerminal,
  STATE_PROGRESS,
  type GenerationEvent,
  type GenerationState,
} from '@waymage/domain';
import { promptCompiler } from '@waymage/prompt-compiler';
import {
  ProviderError,
  type GenerationMode,
  type ImageProvider,
  type ProviderImage,
  type ProviderReference,
} from '@waymage/provider-sdk';
import { parseSceneSpec, type SceneSpec } from '@waymage/scene-spec';
import { SIGNED_URL_TTL, type StorageService, storageKeys } from '@waymage/storage';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { env } from './config/env';
import type { EventPublisher } from './events';
import { evaluateResult } from './evaluation';
import { recordUsage } from './usage';
import { isBlocking, moderateImage, moderateText, recordDecision } from './moderation';
import {
  markCredentialUsed,
  recentReliability,
  registryFor,
  resolveCandidates,
  routingContext,
} from './providers';
import { runProviderJob } from './run-provider-job';

/**
 * Pipeline de geração (blueprint §12.2).
 *
 * Cada passo avança o estado do job, e toda transição passa por `assertTransition` — pular
 * uma etapa ou reabrir um job terminal significaria, mais adiante, capturar crédito duas
 * vezes ou anexar resultado a um job que já falhou.
 *
 * O estado vai para o banco (fonte da verdade, sobrevive a restart) e para o Redis (pub/sub,
 * que a API reemite por SSE). Só o banco não bastaria: a API teria de fazer polling.
 */

/**
 * Teto de provedores por job.
 *
 * Dois: um fallback cobre a falha isolada de um fornecedor, que e o caso comum. Percorrer a
 * lista inteira transformaria uma indisponibilidade geral numa espera longa, com o usuario
 * olhando uma barra de progresso enquanto cada candidato expira no seu proprio timeout.
 */
const MAX_PROVIDER_ATTEMPTS = 2;

export interface ProcessorDeps {
  prisma: PrismaClient;
  storage: StorageService;
  events: EventPublisher;
  logger: Logger;
}

export async function processGenerationJob(
  job: Job<unknown>,
  deps: ProcessorDeps,
): Promise<{ resultIds: string[] }> {
  const payload = generationJobPayloadSchema.parse(job.data);
  const { prisma, storage, logger } = deps;

  const log = logger.child({
    generationJobId: payload.generationJobId,
    workspaceId: payload.workspaceId,
    requestId: payload.requestId,
  });

  const record = await prisma.generationJob.findFirst({
    where: { id: payload.generationJobId, workspaceId: payload.workspaceId },
    select: {
      id: true,
      status: true,
      projectId: true,
      requestedCount: true,
      providerStrategy: true,
      operationType: true,
      sceneVersion: { select: { id: true, sceneSpec: true } },
      sourceResult: { select: { seed: true, asset: { select: { storageKey: true } } } },
      editOperation: {
        select: {
          id: true,
          instruction: true,
          mask: {
            select: { featherPx: true, inverted: true, asset: { select: { storageKey: true } } },
          },
        },
      },
    },
  });

  if (!record) {
    log.warn('Job não encontrado; descartado');
    return { resultIds: [] };
  }

  // Cancelado enquanto esperava na fila: não começa.
  if (isTerminal(record.status as GenerationState)) {
    log.info({ status: record.status }, 'Job já terminou; nada a fazer');
    return { resultIds: [] };
  }

  const advance = makeAdvance(payload.generationJobId, deps);
  const spec = parseSceneSpec(record.sceneVersion.sceneSpec);

  try {
    await advance(record.status as GenerationState, 'VALIDATING');

    /**
     * Roteamento (blueprint §11.3).
     *
     * Acontece antes da compilação porque o prompt depende das capacidades do provedor: sem
     * negative prompt, o compilador dobra as restrições dentro do prompt principal. Escolher
     * depois de compilar produziria um prompt feito para outro fornecedor.
     */
    const routing = {
      operation: record.operationType,
      aspectRatio: spec.output.aspectRatio,
      format: spec.output.format,
      count: record.requestedCount,
      mode: (record.operationType === 'MASKED_EDIT'
        ? 'edit'
        : spec.output.quality === 'final' || record.operationType === 'REFINE'
          ? 'final'
          : 'draft') as GenerationMode,
      referenceCount: spec.references.length,
      transparentBackground: spec.output.transparentBackground,
      needsSeed: spec.advanced.seed !== null,
      needsNegativePrompt: Boolean(spec.advanced.negativePrompt),
    } as const;

    const context = routingContext(await recentReliability(prisma));
    // Registro montado com as credenciais DESTE workspace: a chave é de quem pediu.
    const registry = await registryFor(prisma, payload.workspaceId);
    const candidates = await resolveCandidates(registry, record.providerStrategy, routing, context);

    await advance('VALIDATING', 'MODERATING_INPUT');

    /**
     * Modera tudo que o usuário escreveu, não só a descrição do sujeito.
     *
     * Antes só `description` e `location` eram olhados, e o negative prompt — campo livre,
     * escrito à mão, que vai inteiro para o provedor — passava sem ser lido.
     */
    const inputVerdict = moderateText(
      [
        spec.subject.description,
        spec.subject.wardrobe?.description,
        spec.scene.location,
        spec.intent.message,
        spec.intent.targetAudience,
        spec.advanced.negativePrompt,
        record.editOperation?.instruction,
      ]
        .filter(Boolean)
        .join(' \n '),
    );

    await recordDecision(prisma, {
      workspaceId: payload.workspaceId,
      target: 'PROMPT_TEXT',
      result: inputVerdict,
      generationJobId: record.id,
    });

    if (isBlocking(inputVerdict.verdict)) {
      throw new ProviderError(
        'moderation',
        inputVerdict.verdict === 'BLOCK' ? 'INPUT_BLOCKED' : 'REVIEW_REQUIRED',
        inputVerdict.reason ?? 'Conteúdo da cena rejeitado.',
      );
    }

    await advance('MODERATING_INPUT', 'COMPILING');

    /**
     * Variação e refinamento partem da mesma cena, mas pedem coisas opostas ao provedor.
     *
     * Variação quer outra saída: seed nova, mesma qualidade. Refinamento quer a MESMA saída
     * com mais detalhe, então preserva a seed do resultado de origem e sobe a qualidade —
     * trocar a seed aqui produziria uma imagem diferente, que não é o que foi pedido.
     */
    const mode =
      record.operationType === 'MASKED_EDIT'
        ? 'edit'
        : record.operationType === 'REFINE'
          ? 'final'
          : spec.output.quality === 'final'
            ? 'final'
            : 'draft';

    // Edição preserva a seed pela mesma razão do refinamento: fora da máscara a imagem tem
    // de continuar a mesma, e seed nova redesenharia o quadro inteiro.
    const seed =
      record.operationType === 'VARIATION'
        ? Math.floor(Math.random() * 2_147_483_647)
        : record.operationType === 'REFINE' || record.operationType === 'MASKED_EDIT'
          ? Number(record.sourceResult?.seed ?? spec.advanced.seed ?? 0) || undefined
          : (spec.advanced.seed ?? undefined);

    const references = await resolveReferences(spec, payload.workspaceId, prisma, storage);

    // Refinamento anexa a imagem de origem: o provedor precisa ve-la para manter a
    // composicao enquanto acrescenta detalhe.
    if (record.operationType === 'REFINE' && record.sourceResult?.asset) {
      references.push({
        role: 'scene',
        weight: 0.9,
        preserve: ['composition'],
        url: await storage.signedReadUrl(record.sourceResult.asset.storageKey, SIGNED_URL_TTL.read),
      });
    }

    /**
     * Edicao localizada: imagem base e mascara vao fora de `references`.
     *
     * Sao insumos posicionais, nao influencias — o provedor precisa saber exatamente QUAL
     * arquivo repintar e ONDE. Trata-los como referencia os colocaria em pe de igualdade com
     * as referencias de estilo, e o provedor escolheria quanto peso dar.
     */
    const editInputs =
      record.operationType === 'MASKED_EDIT' && record.sourceResult?.asset
        ? {
            baseImageUrl: await storage.signedReadUrl(
              record.sourceResult.asset.storageKey,
              SIGNED_URL_TTL.read,
            ),
            ...(record.editOperation?.mask?.asset
              ? {
                  maskUrl: await storage.signedReadUrl(
                    record.editOperation.mask.asset.storageKey,
                    SIGNED_URL_TTL.read,
                  ),
                  maskFeatherPx: record.editOperation.mask.featherPx,
                  maskInverted: record.editOperation.mask.inverted,
                }
              : {}),
          }
        : {};

    await advance('COMPILING', 'ROUTING');
    await advance('ROUTING', 'SUBMITTING');

    /**
     * Uma tentativa contra um provedor: compila, registra e executa.
     *
     * A compilacao vive aqui dentro, e nao antes do laco, porque o prompt depende de quem vai
     * recebe-lo — provedor sem negative prompt recebe as restricoes dobradas dentro do prompt
     * principal. Reaproveitar o prompt do primeiro candidato no segundo mandaria um texto
     * feito para outro fornecedor.
     */
    const attempt = async (provider: ImageProvider, attemptNumber: number) => {
      const compilation = await promptCompiler.compile({
        sceneSpec: spec,
        providerCapabilities: provider.getCapabilities(),
        mode,
        ...(record.editOperation ? { editInstruction: record.editOperation.instruction } : {}),
      });

      /**
       * O prompt compilado passa pela moderação de novo.
       *
       * Não é redundância: o compilador junta campos que, isolados, não acionam nada — o
       * sujeito de um lado, o cenário do outro — e o texto final é o que o fornecedor
       * realmente recebe. É esse texto que precisa estar dentro da política.
       */
      const promptVerdict = moderateText(
        `${compilation.prompt} ${compilation.negativePrompt ?? ''}`,
      );

      await recordDecision(prisma, {
        workspaceId: payload.workspaceId,
        target: 'COMPILED_PROMPT',
        result: promptVerdict,
        generationJobId: record.id,
      });

      if (isBlocking(promptVerdict.verdict)) {
        throw new ProviderError(
          'moderation',
          promptVerdict.verdict === 'BLOCK' ? 'PROMPT_BLOCKED' : 'REVIEW_REQUIRED',
          promptVerdict.reason ?? 'Prompt rejeitado pela política de conteúdo.',
        );
      }

      // Nunca guardar so o prompt: SceneSpec normalizado, versao do compilador e avisos
      // ficam junto, senao nao ha como explicar por que uma imagem saiu como saiu.
      await prisma.promptCompilation.create({
        data: {
          workspaceId: payload.workspaceId,
          generationJobId: record.id,
          provider: provider.id,
          mode,
          prompt: compilation.prompt,
          negativePrompt: compilation.negativePrompt ?? null,
          referenceInstructions:
            compilation.referenceInstructions as unknown as Prisma.InputJsonValue,
          warnings: compilation.warnings as unknown as Prisma.InputJsonValue,
          normalizedSpec: compilation.normalizedSceneSpec as unknown as Prisma.InputJsonValue,
          compilerVersion: compilation.compilerVersion,
        },
      });

      await prisma.generationJob.update({
        where: { id: record.id },
        data: { selectedProvider: provider.id, startedAt: new Date() },
      });

      const request = {
        requestId: payload.requestId,
        prompt: compilation.prompt,
        ...(compilation.negativePrompt ? { negativePrompt: compilation.negativePrompt } : {}),
        references,
        aspectRatio: spec.output.aspectRatio,
        format: spec.output.format,
        count: record.requestedCount,
        mode,
        ...(seed === undefined ? {} : { seed }),
        transparentBackground: spec.output.transparentBackground,
        sceneSpec: spec,
        ...editInputs,
      } as const;

      const providerRun = await prisma.providerRun.create({
        data: {
          workspaceId: payload.workspaceId,
          generationJobId: record.id,
          provider: provider.id,
          // Sem as URLs assinadas: elas dao acesso aos arquivos e nao devem ficar no banco.
          // Vale para referencias, imagem base e mascara — todas sao links de leitura direta.
          request: {
            ...request,
            baseImageUrl: undefined,
            maskUrl: undefined,
            references: references.map(({ url: _url, ...rest }) => rest),
          } as unknown as Prisma.InputJsonValue,
          status: ProviderRunStatus.RUNNING,
          attempt: attemptNumber,
        },
        select: { id: true },
      });

      try {
        const status = await runProviderJob(provider, request, {
          timeoutMs: env.PROVIDER_TIMEOUT_MS,
          pollIntervalMs: 250,
          onProgress: async (progress, state) => {
            if (state !== 'running') return;
            // Progresso dentro de PROCESSING e continuo; a transicao de estado acontece uma vez.
            await deps.events.publish(event(record.id, 'PROCESSING', 0.25 + progress * 0.35));
          },
        });

        await prisma.providerRun.update({
          where: { id: providerRun.id },
          data: {
            status: ProviderRunStatus.SUCCEEDED,
            latencyMs: status.latencyMs ?? null,
            costExternal: status.externalCostCents ?? 0,
            response: { imageCount: status.images.length } as Prisma.InputJsonValue,
          },
        });

        return { status, providerRunId: providerRun.id, provider };
      } catch (error) {
        // A tentativa fica registrada como falha antes de propagar: e dela que sai a taxa de
        // sucesso recente que o roteador consulta na proxima decisao.
        await prisma.providerRun.update({
          where: { id: providerRun.id },
          data: {
            status: ProviderRunStatus.FAILED,
            errorCode: error instanceof ProviderError ? error.code : 'INTERNAL_ERROR',
          },
        });
        throw error;
      }
    };

    /**
     * Fallback automatico (blueprint 11.3).
     *
     * So entre candidatos que o roteador ja considerou elegiveis — cair para um provedor que
     * nao faz a operacao, ou que custa mais do que foi reservado, trocaria uma falha por
     * outra. Rejeicao por politica de conteudo nao e motivo para tentar de novo: o pedido e o
     * mesmo, e o proximo fornecedor recusaria igual, cobrando por isso.
     */
    const attempts = candidates.slice(0, MAX_PROVIDER_ATTEMPTS);
    let outcome: Awaited<ReturnType<typeof attempt>> | null = null;

    for (const [index, candidate] of attempts.entries()) {
      try {
        outcome = await attempt(candidate, index + 1);
        break;
      } catch (error) {
        const failure = error instanceof ProviderError ? error : null;
        const last = index + 1 >= attempts.length;

        // Trocar de fornecedor só resolve falha DELE. Recusa por política e pedido inválido
        // seriam recusados igual pelo próximo, cobrando uma segunda chamada por isso.
        if (last || !(failure?.shouldTryNextProvider ?? false)) throw error;

        log.warn(
          { provider: candidate.id, next: attempts[index + 1]?.id, code: failure?.code },
          'Provedor falhou; tentando o proximo',
        );
      }
    }

    if (!outcome) throw new Error('Nenhum candidato de provedor foi executado.');
    const { status, providerRunId, provider } = outcome;

    await prisma.generationJob.updateMany({
      where: { id: record.id, status: GenerationStatus.SUBMITTING },
      data: { status: GenerationStatus.PROCESSING },
    });

    await advance('PROCESSING', 'DOWNLOADING');
    const stored = await storeImages(status.images, {
      workspaceId: payload.workspaceId,
      projectId: record.projectId,
      jobId: record.id,
      providerRunId,
      prisma,
      storage,
    });

    // Fecha a linhagem da edição: a operação passa a apontar para o que ela produziu.
    if (record.editOperation && stored[0]) {
      await prisma.editOperation.update({
        where: { id: record.editOperation.id },
        data: { resultAssetId: stored[0].assetId },
      });
    }

    await advance('DOWNLOADING', 'MODERATING_OUTPUT');

    /**
     * Moderação da imagem produzida.
     *
     * O veredicto por imagem vive em `GenerationResult.safetyStatus`, e não numa linha de
     * decisão por resultado: é atributo da imagem, consultado sempre que ela é exibida ou
     * exportada. A linha de decisão só existe quando há algo a registrar.
     */
    for (const [index, result] of stored.entries()) {
      const image = status.images[index];
      if (!image) continue;

      const verdict = moderateImage({ bytes: image.data, mimeType: image.mimeType });
      if (verdict.verdict === 'ALLOW') continue;

      await prisma.generationResult.update({
        where: { id: result.id },
        data: { safetyStatus: verdict.verdict },
      });

      await recordDecision(prisma, {
        workspaceId: payload.workspaceId,
        target: 'OUTPUT_IMAGE',
        result: verdict,
        generationJobId: record.id,
        assetId: result.assetId,
      });
    }

    await advance('MODERATING_OUTPUT', 'EVALUATING');

    await Promise.all(
      stored.map((result) =>
        prisma.generationResult.update({
          where: { id: result.id },
          data: {
            evaluation: evaluateResult(spec, {
              width: result.width,
              height: result.height,
            }) as unknown as Prisma.InputJsonValue,
          },
        }),
      ),
    );

    await recordUsage(prisma, {
      workspaceId: payload.workspaceId,
      generationJobId: record.id,
      provider: provider.id,
      imagesProduced: stored.length,
      externalCostCents: status.externalCostCents ?? 0,
    });

    await advance('EVALUATING', 'COMPLETED', `${stored.length} imagens geradas`);
    await prisma.generationJob.update({
      where: { id: record.id },
      data: { completedAt: new Date() },
    });

    await markCredentialUsed(prisma, payload.workspaceId, provider.id);

    log.info({ count: stored.length, provider: provider.id }, 'Geração concluída');
    return { resultIds: stored.map((result) => result.id) };
  } catch (error) {
    const providerError = error instanceof ProviderError ? error : null;

    await prisma.generationJob.update({
      where: { id: record.id },
      data: {
        status: GenerationStatus.FAILED,
        completedAt: new Date(),
        errorCode: providerError?.code ?? 'INTERNAL_ERROR',
        // Mensagem do provedor pode ir para a tela; erro interno vira texto genérico.
        errorMessage: providerError?.message ?? 'Falha interna ao gerar.',
      },
    });

    await deps.events.publish(
      event(record.id, 'FAILED', 1, providerError?.message ?? 'Falha ao gerar.'),
    );

    log.error({ err: error }, 'Geração falhou');
    throw error;
  }
}

/**
 * Avança o estado validando a transição, grava no banco e publica o evento.
 *
 * Centralizado porque esquecer de publicar deixaria a barra de progresso do usuário parada
 * enquanto o job avança — e esquecer de validar é o que a máquina de estados existe para
 * impedir.
 */
function makeAdvance(jobId: string, { prisma, events }: ProcessorDeps) {
  return async (from: GenerationState, to: GenerationState, message?: string): Promise<void> => {
    assertTransition(from, to);
    await prisma.generationJob.update({
      where: { id: jobId },
      data: { status: to as GenerationStatus },
    });
    await events.publish(event(jobId, to, STATE_PROGRESS[to], message));
  };
}

function event(
  generationJobId: string,
  status: GenerationState,
  progress: number,
  message?: string,
): GenerationEvent {
  return {
    generationJobId,
    status,
    progress,
    at: new Date().toISOString(),
    ...(message === undefined ? {} : { message }),
  };
}

/**
 * Resolve as referências em URLs assinadas para o provedor.
 *
 * Assets não prontos são descartados com silêncio deliberado: uma miniatura ainda
 * processando não deve impedir a geração inteira.
 */
async function resolveReferences(
  spec: SceneSpec,
  workspaceId: string,
  prisma: PrismaClient,
  storage: StorageService,
): Promise<ProviderReference[]> {
  if (spec.references.length === 0) return [];

  const assets = await prisma.asset.findMany({
    where: {
      id: { in: spec.references.map((reference) => reference.assetId) },
      workspaceId,
      status: AssetStatus.READY,
      deletedAt: null,
    },
    select: { id: true, storageKey: true },
  });

  const keyById = new Map(assets.map((asset) => [asset.id, asset.storageKey]));

  return Promise.all(
    spec.references
      .filter((reference) => keyById.has(reference.assetId))
      .map(async (reference) => ({
        role: reference.role,
        weight: reference.weight,
        preserve: reference.preserve,
        url: await storage.signedReadUrl(
          keyById.get(reference.assetId) as string,
          SIGNED_URL_TTL.read,
        ),
      })),
  );
}

/** Grava cada imagem no bucket e cria o `Asset` + `GenerationResult` correspondentes. */
async function storeImages(
  images: readonly ProviderImage[],
  ctx: {
    workspaceId: string;
    projectId: string;
    jobId: string;
    providerRunId: string;
    prisma: PrismaClient;
    storage: StorageService;
  },
): Promise<{ id: string; assetId: string; width: number; height: number }[]> {
  const results: { id: string; assetId: string; width: number; height: number }[] = [];

  for (const [index, image] of images.entries()) {
    const extension = image.mimeType.split('/')[1] ?? 'png';
    const key = storageKeys.generationResult(
      ctx.workspaceId,
      ctx.projectId,
      ctx.jobId,
      ctx.providerRunId,
      index,
      extension,
    );

    await ctx.storage.put({ key, body: image.data, contentType: image.mimeType });

    const asset = await ctx.prisma.asset.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        kind: AssetKind.GENERATED,
        status: AssetStatus.READY,
        storageKey: key,
        mimeType: image.mimeType,
        sizeBytes: image.data.length,
        width: image.width,
        height: image.height,
      },
      select: { id: true },
    });

    const result = await ctx.prisma.generationResult.create({
      data: {
        workspaceId: ctx.workspaceId,
        generationJobId: ctx.jobId,
        providerRunId: ctx.providerRunId,
        assetId: asset.id,
        width: image.width,
        height: image.height,
        format: extension,
        seed: image.seed === undefined ? null : BigInt(image.seed),
      },
      select: { id: true },
    });

    results.push({ id: result.id, assetId: asset.id, width: image.width, height: image.height });
  }

  return results;
}
