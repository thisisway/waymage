import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  AssetKind,
  AssetStatus,
  GenerationStatus,
  OperationType,
  type ModerationTarget,
  type ModerationVerdict,
  type Prisma,
  type ProviderRunStatus,
} from '@waymage/database';
import { isTerminal, STATE_LABELS, STATE_PROGRESS, type GenerationState } from '@waymage/domain';
import {
  ModelRouter,
  PROVIDER_QUALITY,
  createWorkspaceRegistry,
  type ProviderCapabilities,
  type ProviderRegistry,
  type RoutingRequest,
} from '@waymage/provider-sdk';
import { openSecret } from '@waymage/domain';
import { env } from '../config/env';
import { promptCompiler } from '@waymage/prompt-compiler';
import { hasBlockingIssues, parseSceneSpec, validateSceneSpec } from '@waymage/scene-spec';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { PrismaService } from '../infra/prisma.service';
import { AppStorageService } from '../infra/storage.service';
import type { RequestPrincipal } from '../auth/request-user';
import { GenerationQueueService } from '../queue/generation-queue.service';
import { ScenesService } from '../scenes/scenes.service';
import type { CreateGenerationInput, EditInput, EstimateInput } from './generations.schemas';

export interface GenerationResultView {
  id: string;
  width: number;
  height: number;
  format: string;
  seed: string | null;
  selected: boolean;
  evaluation: unknown;
  url: string | null;
  thumbnailUrl: string | null;
}

export interface GenerationJobView {
  id: string;
  sceneId: string;
  sceneVersionId: string;
  status: GenerationState;
  statusLabel: string;
  progress: number;
  operationType: OperationType;
  /** Resultado de origem, em variação, refinamento e edição. */
  sourceResultId: string | null;
  /**
   * A imagem de origem, resolvida.
   *
   * Vem junto para que o "antes e depois" não precise de uma segunda ida ao servidor — e
   * porque o resultado de origem costuma estar noutro job, que a tela não tem em mãos.
   */
  sourceResult: GenerationResultView | null;
  requestedCount: number;
  selectedProvider: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
  results: GenerationResultView[];
  /**
   * Tentativas contra provedores, na ordem.
   *
   * Mais de uma significa que houve fallback. Sem isto o usuário veria só o provedor que
   * entregou e não saberia que o primeiro falhou — nem por quê, quando o job demora o dobro.
   */
  runs: ProviderRunView[];
  /**
   * Ressalvas da moderação.
   *
   * Só o que não foi `ALLOW` chega aqui — é o que faz `ALLOW_WITH_WARNING` significar algo
   * para quem pediu. Sem isto, "permitido com aviso" seria idêntico a "permitido".
   */
  moderation: ModerationNoteView[];
}

export interface ModerationNoteView {
  target: ModerationTarget;
  verdict: ModerationVerdict;
  reason: string | null;
}

export interface ProviderRunView {
  provider: string;
  status: ProviderRunStatus;
  attempt: number;
  errorCode: string | null;
  latencyMs: number | null;
}

export interface ProviderAlternative {
  provider: string;
  eligible: boolean;
  estimatedSeconds: number;
  /** 0..1 pelos pesos do blueprint §11.3. Só comparável entre elegíveis. */
  score: number;
  /** Por que foi descartado, ou o que pesou contra. */
  notes: string[];
}

export interface EstimateView {
  /**
   * O workspace não tem chave de IA cadastrada.
   *
   * Separado de `canGenerate` porque a saída é outra: erro de cena se resolve no inspetor,
   * falta de chave se resolve noutra tela. Misturar os dois faria a mensagem mandar a pessoa
   * procurar um problema que não existe.
   */
  needsCredential: boolean;
  provider: string;
  estimatedSeconds: number;
  count: number;
  /** Todos os provedores considerados, do melhor para o pior. */
  alternatives: ProviderAlternative[];
  summary: string;
  prompt: string;
  warnings: { code: string; message: string }[];
  issues: { code: string; level: string; message: string }[];
  /** Falso quando há erro bloqueante: o botão Gerar precisa ficar desabilitado. */
  canGenerate: boolean;
}

@Injectable()
export class GenerationsService {
  private readonly logger = new Logger(GenerationsService.name);

  /**
   * Capabilities usadas para estimar e validar antes de enfileirar.
   *
   * O ModelRouter da Fase 9 escolherá o provedor de verdade; até lá, a API consulta o mesmo
   * fake que o worker usa. O importante é que a validação já receba capabilities reais —
   * aceitar um job que o provedor não consegue executar é a pior hora de descobrir.
   */
  /**
   * Os provedores DESTE workspace — o mesmo conjunto que o worker vai executar.
   *
   * Não é um registro do processo: com BYOK (D-070) a chave é do usuário, e dois workspaces
   * têm contas diferentes no mesmo fornecedor. Estimar sobre uma lista e gerar com outra
   * mostraria um provedor na tela e usaria outro na fatura.
   *
   * A chave é decifrada, usada para montar o adapter, e não sobrevive à requisição.
   */
  private async registryFor(workspaceId: string): Promise<ProviderRegistry> {
    const rows = await this.prisma.providerCredential.findMany({
      where: { workspaceId, revokedAt: null },
      select: { provider: true, secretSealed: true },
    });

    return createWorkspaceRegistry({
      credentials: rows.map((row) => ({
        provider: row.provider,
        secret: openSecret(row.secretSealed, env.CREDENTIALS_ENCRYPTION_KEY),
      })),
      // Fora de produção os fakes ficam, para o desenvolvimento não exigir chave de ninguém.
      includeFakes: env.NODE_ENV !== 'production',
    });
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly scenes: ScenesService,
    private readonly queue: GenerationQueueService,
    private readonly storage: AppStorageService,
    private readonly audit: AuditService,
  ) {}

  /** Prévia do que vai acontecer, antes de gastar qualquer coisa (blueprint §22). */
  /**
   * O provedor que vencer a pontuação, ou erro claro se nenhum atende.
   *
   * A escolha acontece aqui, na criação, e não só no worker: é o custo dela que vira a
   * reserva de crédito. Rotear apenas na execução deixaria o usuário ver um preço e pagar
   * outro.
   */
  private async route(workspaceId: string, request: RoutingRequest) {
    const registry = await this.registryFor(workspaceId);

    if (registry.ids().length === 0) {
      throw new AppError(
        'NO_PROVIDER_CREDENTIAL',
        'Cadastre uma chave de IA para gerar imagens.',
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }

    const ranked = await new ModelRouter(registry).rank(request, { quality: PROVIDER_QUALITY });
    const best = ranked.find((entry) => entry.eligible);

    if (!best) {
      throw new AppError(
        'NO_ELIGIBLE_PROVIDER',
        'Nenhum provedor atende a esta cena.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { alternatives: ranked.map((entry) => ({ provider: entry.provider, notes: entry.notes })) },
      );
    }

    return { ...best, registry };
  }

  async estimate(principal: RequestPrincipal, input: EstimateInput): Promise<EstimateView> {
    const scene = await this.scenes.get(principal, input.sceneId);
    const mode = scene.sceneSpec.output.quality === 'final' ? 'final' : 'draft';

    // Roteia antes de compilar: o prompt depende das capacidades de quem vai receber,
    // porque provedor sem negative prompt recebe as restrições dentro do prompt principal.
    const registry = await this.registryFor(principal.workspaceId);
    const ranked =
      registry.ids().length === 0
        ? []
        : await new ModelRouter(registry).rank(routingFor(scene.sceneSpec, mode), {
            quality: PROVIDER_QUALITY,
          });
    const chosen = ranked.find((entry) => entry.eligible) ?? ranked[0];
    const provider = chosen ? registry.get(chosen.provider) : null;
    const capabilities = provider?.getCapabilities();

    const issues = validateSceneSpec(scene.sceneSpec, capabilities ? { capabilities } : {});

    const compilation = await promptCompiler.compile({
      sceneSpec: scene.sceneSpec,
      providerCapabilities: capabilities ?? FALLBACK_CAPABILITIES,
      mode,
    });

    return {
      needsCredential: registry.ids().length === 0,
      provider: chosen?.provider ?? '—',
      estimatedSeconds: Math.ceil(
        ((chosen?.estimatedLatencyMs ?? 0) * scene.sceneSpec.output.count) / 1000,
      ),
      count: scene.sceneSpec.output.count,
      // A alternativa descartada também aparece, com o motivo: "por que não usou o de
      // qualidade melhor" é a primeira pergunta de quem vê o número.
      alternatives: ranked.map((entry) => ({
        provider: entry.provider,
        eligible: entry.eligible,
        estimatedSeconds: Math.ceil(
          (entry.estimatedLatencyMs * scene.sceneSpec.output.count) / 1000,
        ),
        score: Math.round(entry.score * 100) / 100,
        notes: entry.notes,
      })),
      summary: compilation.summary,
      prompt: compilation.prompt,
      warnings: compilation.warnings,
      issues: issues.map((issue) => ({
        code: issue.code,
        level: issue.level,
        message: issue.message,
      })),
      canGenerate: Boolean(chosen?.eligible) && !hasBlockingIssues(issues),
    };
  }

  /**
   * Cria o job.
   *
   * Três coisas acontecem em ordem e nenhuma pode ser pulada:
   *
   * 1. **Idempotência** — a mesma chave devolve o job existente em vez de criar outro. Sem
   *    isso, um duplo clique ou um retry de rede vira duas cobranças.
   * 2. **Snapshot** — o job aponta para uma `SceneVersion` imutável, criada agora. Se
   *    apontasse para o rascunho, editar a cena depois mudaria retroativamente o que gerou
   *    aquela imagem.
   * 3. **Validação com capabilities** — erro bloqueante impede o enfileiramento. Descobrir
   *    no worker significaria já ter reservado crédito.
   */
  async create(
    principal: RequestPrincipal,
    input: CreateGenerationInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<GenerationJobView> {
    const existing = await this.prisma.generationJob.findUnique({
      where: {
        workspaceId_idempotencyKey: { workspaceId: principal.workspaceId, idempotencyKey },
      },
      select: { id: true },
    });
    if (existing) return this.get(principal, existing.id);

    const scene = await this.scenes.get(principal, input.sceneId);
    const mode = scene.sceneSpec.output.quality === 'final' ? 'final' : 'draft';

    const chosen = await this.route(principal.workspaceId, routingFor(scene.sceneSpec, mode));
    const issues = validateSceneSpec(scene.sceneSpec, {
      capabilities: chosen.registry.get(chosen.provider).getCapabilities(),
    });

    if (hasBlockingIssues(issues)) {
      throw new AppError(
        'SCENE_HAS_BLOCKING_ISSUES',
        'Resolva os conflitos da cena antes de gerar.',
        HttpStatus.BAD_REQUEST,
        { issues: issues.filter((issue) => issue.level === 'error') },
      );
    }

    // Snapshot automático: a geração precisa de um SceneSpec que não muda mais.
    const version = await this.scenes.createVersion(
      principal,
      input.sceneId,
      { changeSummary: 'snapshot automático antes de gerar' },
      requestId,
    );

    const job = await this.prisma.generationJob.create({
      data: {
        workspaceId: principal.workspaceId,
        projectId: scene.projectId,
        sceneId: scene.id,
        sceneVersionId: version.id,
        status: GenerationStatus.QUEUED,
        operationType: input.operationType ?? OperationType.TEXT_TO_IMAGE,
        requestedCount: scene.sceneSpec.output.count,
        providerStrategy: scene.sceneSpec.advanced.provider,
        idempotencyKey,
        createdById: principal.user.id,
      },
      select: { id: true },
    });

    await this.queue.enqueue({
      generationJobId: job.id,
      workspaceId: principal.workspaceId,
      requestId: requestId ?? job.id,
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'generation.create',
      resourceType: 'GenerationJob',
      resourceId: job.id,
      metadata: { sceneVersionId: version.id, count: scene.sceneSpec.output.count },
      ...(requestId ? { requestId } : {}),
    });

    return this.get(principal, job.id);
  }

  /**
   * Variação: mesma cena, seed diferente.
   *
   * Reusa a `SceneVersion` do job de origem em vez de tirar um snapshot novo — o ponto da
   * variação é explorar outra saída da MESMA especificação. Tirar snapshot aqui misturaria
   * edições feitas depois e a comparação deixaria de ser honesta.
   */
  async variation(
    principal: RequestPrincipal,
    resultId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<GenerationJobView> {
    return this.derive(principal, resultId, idempotencyKey, 'VARIATION', requestId);
  }

  /**
   * Refinamento: mesma cena em qualidade final, uma imagem só.
   *
   * O usuário já escolheu a saída que quer; gastar quatro renderizações caras para explorar
   * de novo seria desperdício. A qualidade sobe, a contagem cai para um.
   */
  async refine(
    principal: RequestPrincipal,
    resultId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<GenerationJobView> {
    return this.derive(principal, resultId, idempotencyKey, 'REFINE', requestId);
  }

  /**
   * Edição localizada: repinta só a região marcada na máscara.
   *
   * Nasce de um resultado, não de uma cena — o que se edita é uma imagem que já existe. A
   * cena continua sendo a mesma `SceneVersion` do job de origem, e serve de contexto para o
   * provedor preservar estilo e iluminação fora da máscara.
   */
  async edit(
    principal: RequestPrincipal,
    resultId: string,
    input: EditInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<GenerationJobView> {
    const mask = await this.prisma.asset.findFirst({
      where: {
        id: input.maskAssetId,
        workspaceId: principal.workspaceId,
        kind: AssetKind.MASK,
        deletedAt: null,
        // PENDING_UPLOAD é upload que nunca chegou: não há arquivo para o worker buscar.
        status: { in: [AssetStatus.PROCESSING, AssetStatus.READY] },
      },
      select: { id: true },
    });
    if (!mask) throw AppError.notFound('Máscara');

    return this.derive(principal, resultId, idempotencyKey, 'MASKED_EDIT', requestId, input);
  }

  private async derive(
    principal: RequestPrincipal,
    resultId: string,
    idempotencyKey: string,
    operation: 'VARIATION' | 'REFINE' | 'MASKED_EDIT',
    requestId?: string,
    edit?: EditInput,
  ): Promise<GenerationJobView> {
    const existing = await this.prisma.generationJob.findUnique({
      where: {
        workspaceId_idempotencyKey: { workspaceId: principal.workspaceId, idempotencyKey },
      },
      select: { id: true },
    });
    if (existing) return this.get(principal, existing.id);

    const source = await this.prisma.generationResult.findFirst({
      where: { id: resultId, workspaceId: principal.workspaceId },
      select: {
        id: true,
        seed: true,
        job: {
          select: {
            projectId: true,
            sceneId: true,
            sceneVersionId: true,
            providerStrategy: true,
            sceneVersion: { select: { sceneSpec: true } },
          },
        },
      },
    });
    if (!source) throw AppError.notFound('Resultado');

    const spec = parseSceneSpec(source.job.sceneVersion.sceneSpec);

    // Variação mantém o pedido original; refinamento e edição entregam uma imagem só —
    // ambos partem de uma saída que o usuário já escolheu, e explorar de novo seria desperdício.
    const count = operation === 'VARIATION' ? spec.output.count : 1;
    const mode =
      operation === 'MASKED_EDIT'
        ? ('edit' as const)
        : operation === 'REFINE'
          ? ('final' as const)
          : spec.output.quality === 'final'
            ? ('final' as const)
            : ('draft' as const);

    // Rotear aqui não escolhe nada que o worker vá reusar — ele roteia de novo, com dados de
    // confiabilidade mais frescos. Serve para recusar cedo: se nenhum provedor atende a esta
    // operação, é melhor dizer agora do que enfileirar um job condenado.
    await this.route(principal.workspaceId, {
      ...routingFor(spec, mode === 'edit' ? 'final' : mode),
      operation,
      count,
      mode,
    });

    const job = await this.prisma.generationJob.create({
      data: {
        workspaceId: principal.workspaceId,
        projectId: source.job.projectId,
        sceneId: source.job.sceneId,
        // Mesma versão da cena: é o que torna a comparação legítima.
        sceneVersionId: source.job.sceneVersionId,
        sourceResultId: source.id,
        status: GenerationStatus.QUEUED,
        operationType: operation as OperationType,
        requestedCount: count,
        providerStrategy: source.job.providerStrategy,
        idempotencyKey,
        createdById: principal.user.id,
      },
      select: { id: true },
    });

    if (edit) {
      // Uma `MaskAsset` por edição, mesmo que o PNG se repita: feather e inversão são
      // parâmetros DESTA edição, e compartilhar a linha faria mudar um valor reescrever o
      // histórico de edições anteriores.
      const maskAsset = await this.prisma.maskAsset.create({
        data: {
          workspaceId: principal.workspaceId,
          assetId: edit.maskAssetId,
          featherPx: edit.featherPx,
          inverted: edit.inverted,
        },
        select: { id: true },
      });

      await this.prisma.editOperation.create({
        data: {
          workspaceId: principal.workspaceId,
          sourceResultId: source.id,
          generationJobId: job.id,
          maskId: maskAsset.id,
          instruction: edit.instruction,
        },
      });
    }

    await this.queue.enqueue({
      generationJobId: job.id,
      workspaceId: principal.workspaceId,
      requestId: requestId ?? job.id,
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action:
        operation === 'MASKED_EDIT'
          ? 'generation.edit'
          : operation === 'REFINE'
            ? 'generation.refine'
            : 'generation.variation',
      resourceType: 'GenerationJob',
      resourceId: job.id,
      metadata: { sourceResultId: source.id, ...(edit ? { maskAssetId: edit.maskAssetId } : {}) },
      ...(requestId ? { requestId } : {}),
    });

    return this.get(principal, job.id);
  }

  async get(principal: RequestPrincipal, jobId: string): Promise<GenerationJobView> {
    const job = await this.prisma.generationJob.findFirst({
      where: { id: jobId, workspaceId: principal.workspaceId },
      select: jobSelect,
    });
    if (!job) throw AppError.notFound('Geração');

    return {
      id: job.id,
      sceneId: job.sceneId,
      sceneVersionId: job.sceneVersionId,
      status: job.status as GenerationState,
      statusLabel: STATE_LABELS[job.status as GenerationState],
      progress: STATE_PROGRESS[job.status as GenerationState],
      operationType: job.operationType,
      sourceResultId: job.sourceResultId,
      requestedCount: job.requestedCount,
      selectedProvider: job.selectedProvider,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      results: await Promise.all(job.results.map((result) => this.toResultView(result))),
      sourceResult: job.sourceResult ? await this.toResultView(job.sourceResult) : null,
      runs: job.providerRuns,
      moderation: dedupeNotes(
        job.moderation.map((decision) => ({
          target: decision.target,
          verdict: decision.verdict,
          reason:
            typeof decision.detail === 'object' &&
            decision.detail !== null &&
            'reason' in decision.detail &&
            typeof decision.detail.reason === 'string'
              ? decision.detail.reason
              : null,
        })),
      ),
    };
  }

  async listForScene(principal: RequestPrincipal, sceneId: string): Promise<GenerationJobView[]> {
    await this.scenes.get(principal, sceneId);

    const jobs = await this.prisma.generationJob.findMany({
      where: { sceneId, workspaceId: principal.workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: jobSelect,
    });

    return Promise.all(jobs.map((job) => this.get(principal, job.id)));
  }

  /**
   * Cancela o job.
   *
   * Só antes de o provedor começar a produzir: depois de `PROCESSING`, o custo externo já
   * foi incorrido e cancelar apenas descartaria um resultado já pago.
   */
  async cancel(
    principal: RequestPrincipal,
    jobId: string,
    requestId?: string,
  ): Promise<GenerationJobView> {
    const job = await this.prisma.generationJob.findFirst({
      where: { id: jobId, workspaceId: principal.workspaceId },
      select: { id: true, status: true },
    });
    if (!job) throw AppError.notFound('Geração');

    if (isTerminal(job.status as GenerationState)) {
      throw new AppError(
        'GENERATION_ALREADY_FINISHED',
        'Esta geração já terminou.',
        HttpStatus.CONFLICT,
      );
    }

    await this.prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: GenerationStatus.CANCELLED,
        completedAt: new Date(),
        errorCode: 'CANCELLED_BY_USER',
      },
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'generation.cancel',
      resourceType: 'GenerationJob',
      resourceId: job.id,
      ...(requestId ? { requestId } : {}),
    });

    return this.get(principal, job.id);
  }

  /** Marca o resultado escolhido. Só um por job — escolher outro troca a seleção. */
  async select(
    principal: RequestPrincipal,
    resultId: string,
    requestId?: string,
  ): Promise<GenerationResultView> {
    const result = await this.prisma.generationResult.findFirst({
      where: { id: resultId, workspaceId: principal.workspaceId },
      select: { id: true, generationJobId: true },
    });
    if (!result) throw AppError.notFound('Resultado');

    await this.prisma.$transaction([
      this.prisma.generationResult.updateMany({
        where: { generationJobId: result.generationJobId },
        data: { selected: false },
      }),
      this.prisma.generationResult.update({
        where: { id: result.id },
        data: { selected: true },
      }),
    ]);

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'generation.select_result',
      resourceType: 'GenerationResult',
      resourceId: result.id,
      ...(requestId ? { requestId } : {}),
    });

    const updated = await this.prisma.generationResult.findUniqueOrThrow({
      where: { id: result.id },
      select: resultSelect,
    });
    return this.toResultView(updated);
  }

  private async toResultView(result: {
    id: string;
    width: number;
    height: number;
    format: string;
    seed: bigint | null;
    selected: boolean;
    evaluation: unknown;
    asset: { storageKey: string } | null;
    thumbnailAsset: { storageKey: string } | null;
  }): Promise<GenerationResultView> {
    return {
      id: result.id,
      width: result.width,
      height: result.height,
      format: result.format,
      // BigInt não sobrevive a JSON.stringify; a seed vira string na borda.
      seed: result.seed === null ? null : result.seed.toString(),
      selected: result.selected,
      evaluation: result.evaluation,
      url: result.asset ? await this.storage.signedReadUrl(result.asset.storageKey) : null,
      thumbnailUrl: result.thumbnailAsset
        ? await this.storage.signedReadUrl(result.thumbnailAsset.storageKey)
        : null,
    };
  }
}

/**
 * Um aviso por assunto, mesmo que a regra tenha batido em mais de um alvo.
 *
 * Texto do usuário e prompt compilado acionam a mesma regra quase sempre — o compilador
 * carrega a descrição para dentro do prompt. Mostrar a mesma frase duas vezes faria o aviso
 * parecer defeito, e a segunda ocorrência não acrescenta nada: o registro completo continua
 * em `ModerationDecision`, com o alvo de cada uma.
 */
function dedupeNotes(notes: ModerationNoteView[]): ModerationNoteView[] {
  const seen = new Set<string>();
  return notes.filter((note) => {
    const key = `${note.verdict}:${note.reason ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Capacidades genéricas, usadas só quando não há provedor algum.
 *
 * A estimativa precisa compilar o prompt para mostrar o resumo, e compilar exige saber o que
 * o destinatário aceita. Sem chave cadastrada não há destinatário — então o compilador recebe
 * um perfil conservador, e o `canGenerate` já diz que gerar não é possível.
 */
const FALLBACK_CAPABILITIES: ProviderCapabilities = {
  textToImage: true,
  imageToImage: false,
  maskedEdit: false,
  multipleReferences: false,
  transparentBackground: false,
  seed: false,
  negativePrompt: false,
  partialStreaming: false,
  supportedAspectRatios: ['1:1'],
  supportedFormats: ['png'],
  maxReferenceImages: 0,
  maxOutputs: 1,
};

/** Traduz a cena para a pergunta que o roteador responde. */
function routingFor(
  spec: ReturnType<typeof parseSceneSpec>,
  mode: 'draft' | 'final',
): RoutingRequest {
  return {
    operation: 'TEXT_TO_IMAGE',
    aspectRatio: spec.output.aspectRatio,
    format: spec.output.format,
    count: spec.output.count,
    mode,
    referenceCount: spec.references.length,
    transparentBackground: spec.output.transparentBackground,
    needsSeed: spec.advanced.seed !== null,
    needsNegativePrompt: Boolean(spec.advanced.negativePrompt),
  };
}

const resultSelect = {
  id: true,
  width: true,
  height: true,
  format: true,
  seed: true,
  selected: true,
  evaluation: true,
  asset: { select: { storageKey: true } },
  thumbnailAsset: { select: { storageKey: true } },
} as const satisfies Prisma.GenerationResultSelect;

const jobSelect = {
  id: true,
  sceneId: true,
  sceneVersionId: true,
  status: true,
  operationType: true,
  sourceResultId: true,
  sourceResult: { select: resultSelect },
  requestedCount: true,
  selectedProvider: true,
  errorCode: true,
  errorMessage: true,
  createdAt: true,
  completedAt: true,
  results: { orderBy: { createdAt: 'asc' }, select: resultSelect },
  providerRuns: {
    orderBy: { attempt: 'asc' },
    select: { provider: true, status: true, attempt: true, errorCode: true, latencyMs: true },
  },
  moderation: {
    orderBy: { createdAt: 'asc' },
    select: { target: true, verdict: true, detail: true },
  },
} as const satisfies Prisma.GenerationJobSelect;
