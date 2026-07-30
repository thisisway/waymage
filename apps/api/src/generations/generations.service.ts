import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { GenerationStatus, OperationType, type Prisma } from '@waymage/database';
import { isTerminal, STATE_LABELS, STATE_PROGRESS, type GenerationState } from '@waymage/domain';
import { FakeImageProvider } from '@waymage/provider-sdk';
import { promptCompiler } from '@waymage/prompt-compiler';
import { hasBlockingIssues, validateSceneSpec } from '@waymage/scene-spec';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { AppError } from '../common/app-error';
import { PrismaService } from '../infra/prisma.service';
import { AppStorageService } from '../infra/storage.service';
import type { RequestPrincipal } from '../auth/request-user';
import { GenerationQueueService } from '../queue/generation-queue.service';
import { ScenesService } from '../scenes/scenes.service';
import type { CreateGenerationInput, EstimateInput } from './generations.schemas';

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
  requestedCount: number;
  selectedProvider: string | null;
  estimatedCredits: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
  results: GenerationResultView[];
}

export interface EstimateView {
  provider: string;
  credits: number;
  estimatedSeconds: number;
  count: number;
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
  private readonly defaultProvider = new FakeImageProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly scenes: ScenesService,
    private readonly queue: GenerationQueueService,
    private readonly storage: AppStorageService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
  ) {}

  /** Prévia do que vai acontecer, antes de gastar qualquer coisa (blueprint §22). */
  async estimate(principal: RequestPrincipal, input: EstimateInput): Promise<EstimateView> {
    const scene = await this.scenes.get(principal, input.sceneId);
    const capabilities = this.defaultProvider.getCapabilities();

    const issues = validateSceneSpec(scene.sceneSpec, { capabilities });
    const mode = scene.sceneSpec.output.quality === 'final' ? 'final' : 'draft';

    const compilation = await promptCompiler.compile({
      sceneSpec: scene.sceneSpec,
      providerCapabilities: capabilities,
      mode,
    });

    const cost = await this.defaultProvider.estimateCost({
      requestId: 'estimate',
      prompt: compilation.prompt,
      references: [],
      aspectRatio: scene.sceneSpec.output.aspectRatio,
      format: scene.sceneSpec.output.format,
      count: scene.sceneSpec.output.count,
      mode,
    });

    return {
      provider: this.defaultProvider.id,
      credits: cost.credits,
      estimatedSeconds: Math.ceil((cost.estimatedLatencyMs * scene.sceneSpec.output.count) / 1000),
      count: scene.sceneSpec.output.count,
      summary: compilation.summary,
      prompt: compilation.prompt,
      warnings: compilation.warnings,
      issues: issues.map((issue) => ({
        code: issue.code,
        level: issue.level,
        message: issue.message,
      })),
      canGenerate: !hasBlockingIssues(issues),
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
    const capabilities = this.defaultProvider.getCapabilities();
    const issues = validateSceneSpec(scene.sceneSpec, { capabilities });

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

    const mode = scene.sceneSpec.output.quality === 'final' ? 'final' : 'draft';
    const cost = await this.defaultProvider.estimateCost({
      requestId: requestId ?? 'create',
      prompt: '',
      references: [],
      aspectRatio: scene.sceneSpec.output.aspectRatio,
      format: scene.sceneSpec.output.format,
      count: scene.sceneSpec.output.count,
      mode,
    });

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
        estimatedCredits: cost.credits,
        reservedCredits: 0,
        idempotencyKey,
        createdById: principal.user.id,
      },
      select: { id: true },
    });

    // Reserva ANTES de enfileirar. O worker só é acionado com o crédito já preso: enfileirar
    // primeiro abriria uma janela em que a geração roda e o pagamento falha depois.
    try {
      await this.billing.reserve({
        workspaceId: principal.workspaceId,
        amount: cost.credits,
        generationJobId: job.id,
      });
    } catch (error) {
      // Sem crédito, o job não deve existir: deixá-lo em QUEUED faria o worker pegá-lo.
      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: GenerationStatus.FAILED,
          completedAt: new Date(),
          errorCode: 'INSUFFICIENT_CREDITS',
          errorMessage: 'Créditos insuficientes.',
        },
      });
      throw error;
    }

    await this.prisma.generationJob.update({
      where: { id: job.id },
      data: { reservedCredits: cost.credits },
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
      requestedCount: job.requestedCount,
      selectedProvider: job.selectedProvider,
      estimatedCredits: job.estimatedCredits,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      results: await Promise.all(job.results.map((result) => this.toResultView(result))),
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
      select: { id: true, status: true, reservedCredits: true },
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

    // Cancelou antes de receber imagem: o crédito volta.
    if (job.reservedCredits > 0) {
      await this.billing.release({
        workspaceId: principal.workspaceId,
        amount: job.reservedCredits,
        generationJobId: job.id,
        note: 'Geração cancelada pelo usuário',
      });
    }

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
  requestedCount: true,
  selectedProvider: true,
  estimatedCredits: true,
  errorCode: true,
  errorMessage: true,
  createdAt: true,
  completedAt: true,
  results: { orderBy: { createdAt: 'asc' }, select: resultSelect },
} as const satisfies Prisma.GenerationJobSelect;
