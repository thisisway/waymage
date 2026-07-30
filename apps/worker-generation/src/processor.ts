import { captureCredits, recordUsage, releaseCredits } from '@waymage/billing';
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
import { ProviderError, type ProviderImage, type ProviderReference } from '@waymage/provider-sdk';
import { parseSceneSpec, type SceneSpec } from '@waymage/scene-spec';
import { SIGNED_URL_TTL, type StorageService, storageKeys } from '@waymage/storage';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { env } from './config/env';
import type { EventPublisher } from './events';
import { evaluateResult } from './evaluation';
import { moderate } from './moderation';
import { resolveProvider } from './providers';
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
      reservedCredits: true,
      sceneVersion: { select: { id: true, sceneSpec: true } },
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

    const provider = resolveProvider(record.providerStrategy);
    const capabilities = provider.getCapabilities();

    await advance('VALIDATING', 'MODERATING_INPUT');
    const inputVerdict = moderate({ text: spec.subject.description + ' ' + spec.scene.location });
    if (inputVerdict.verdict === 'BLOCK') {
      throw new ProviderError(
        'content_policy',
        'INPUT_BLOCKED',
        inputVerdict.reason ?? 'Conteúdo da cena rejeitado.',
      );
    }

    await advance('MODERATING_INPUT', 'COMPILING');
    const mode = spec.output.quality === 'final' ? 'final' : 'draft';
    const compilation = await promptCompiler.compile({
      sceneSpec: spec,
      providerCapabilities: capabilities,
      mode,
    });

    // Nunca guardar só o prompt: SceneSpec normalizado, versão do compilador e avisos
    // ficam junto, senão não há como explicar por que uma imagem saiu como saiu.
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

    await advance('COMPILING', 'ROUTING');
    await prisma.generationJob.update({
      where: { id: record.id },
      data: { selectedProvider: provider.id, startedAt: new Date() },
    });

    const references = await resolveReferences(spec, payload.workspaceId, prisma, storage);

    const request = {
      requestId: payload.requestId,
      prompt: compilation.prompt,
      ...(compilation.negativePrompt ? { negativePrompt: compilation.negativePrompt } : {}),
      references,
      aspectRatio: spec.output.aspectRatio,
      format: spec.output.format,
      count: record.requestedCount,
      mode,
      ...(spec.advanced.seed === null ? {} : { seed: spec.advanced.seed }),
      transparentBackground: spec.output.transparentBackground,
      sceneSpec: spec,
    } as const;

    const providerRun = await prisma.providerRun.create({
      data: {
        workspaceId: payload.workspaceId,
        generationJobId: record.id,
        provider: provider.id,
        // Sem as URLs assinadas: elas dão acesso aos arquivos e não devem ficar no banco.
        request: {
          ...request,
          references: references.map(({ url: _url, ...rest }) => rest),
        } as unknown as Prisma.InputJsonValue,
        status: ProviderRunStatus.RUNNING,
        attempt: job.attemptsMade + 1,
      },
      select: { id: true },
    });

    await advance('ROUTING', 'SUBMITTING');

    const status = await runProviderJob(provider, request, {
      timeoutMs: env.PROVIDER_TIMEOUT_MS,
      pollIntervalMs: 250,
      onProgress: async (progress, state) => {
        if (state !== 'running') return;
        // Progresso dentro de PROCESSING é contínuo; a transição de estado acontece uma vez.
        await deps.events.publish(event(record.id, 'PROCESSING', 0.25 + progress * 0.35));
      },
    });

    await prisma.generationJob.updateMany({
      where: { id: record.id, status: GenerationStatus.SUBMITTING },
      data: { status: GenerationStatus.PROCESSING },
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

    await advance('PROCESSING', 'DOWNLOADING');
    const stored = await storeImages(status.images, {
      workspaceId: payload.workspaceId,
      projectId: record.projectId,
      jobId: record.id,
      providerRunId: providerRun.id,
      prisma,
      storage,
    });

    await advance('DOWNLOADING', 'MODERATING_OUTPUT');
    // Moderação de saída real entra na Fase 10; o passo existe para o pipeline já ter o
    // ponto de inserção e o estado correspondente.
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

    // Entregou as imagens: o que estava reservado sai de vez.
    if (record.reservedCredits > 0) {
      await captureCredits(prisma, {
        workspaceId: payload.workspaceId,
        amount: record.reservedCredits,
        generationJobId: record.id,
        idempotencyKey: `capture:${record.id}`,
      });
    }

    await recordUsage(prisma, {
      workspaceId: payload.workspaceId,
      generationJobId: record.id,
      provider: provider.id,
      imagesProduced: stored.length,
      creditsCharged: record.reservedCredits,
      externalCostCents: status.externalCostCents ?? 0,
    });

    await advance('EVALUATING', 'COMPLETED', `${stored.length} imagens geradas`);
    await prisma.generationJob.update({
      where: { id: record.id },
      data: { completedAt: new Date(), actualCredits: record.reservedCredits },
    });

    log.info({ count: stored.length, provider: provider.id }, 'Geração concluída');
    return { resultIds: stored.map((result) => result.id) };
  } catch (error) {
    const providerError = error instanceof ProviderError ? error : null;

    /**
     * Quem paga a falha.
     *
     * Falha de provedor, timeout e erro interno são nossos: o usuário não recebeu imagem
     * nenhuma e o crédito volta. Rejeição por política de conteúdo é a exceção — ali o
     * pedido partiu do usuário e o custo foi incorrido, então a reserva é capturada.
     */
    if (record.reservedCredits > 0) {
      const refundable = providerError?.refundable ?? true;
      const settle = refundable ? releaseCredits : captureCredits;

      await settle(prisma, {
        workspaceId: payload.workspaceId,
        amount: record.reservedCredits,
        generationJobId: record.id,
        idempotencyKey: `${refundable ? 'release' : 'capture'}:${record.id}`,
        note: refundable ? 'Falha na geração' : 'Rejeitado por política de conteúdo',
      }).catch((settleError: unknown) => {
        // Falha ao acertar o crédito não pode esconder o erro original.
        log.error({ err: settleError }, 'Falha ao acertar créditos após erro de geração');
      });
    }

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
): Promise<{ id: string; width: number; height: number }[]> {
  const results: { id: string; width: number; height: number }[] = [];

  for (const [index, image] of images.entries()) {
    const extension = image.mimeType.split('/')[1] ?? 'png';
    const key = storageKeys.generationResult(
      ctx.workspaceId,
      ctx.projectId,
      ctx.jobId,
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

    results.push({ id: result.id, width: image.width, height: image.height });
  }

  return results;
}
