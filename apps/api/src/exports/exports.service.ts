import { Injectable } from '@nestjs/common';
import { ExportStatus } from '@waymage/database';
import { SIGNED_URL_TTL } from '@waymage/storage';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { PrismaService } from '../infra/prisma.service';
import { AppStorageService } from '../infra/storage.service';
import type { RequestPrincipal } from '../auth/request-user';
import { ExportQueueService } from '../queue/export-queue.service';
import type { CreateExportInput } from './exports.schemas';

export interface ExportFileView {
  assetId: string;
  /** URL assinada com `Content-Disposition: attachment` — clicar baixa em vez de abrir. */
  downloadUrl: string;
  filename: string;
}

export interface ExportJobView {
  id: string;
  status: ExportStatus;
  format: string;
  resultIds: string[];
  errorMessage: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  files: ExportFileView[];
}

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AppStorageService,
    private readonly queue: ExportQueueService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Cria o pedido de exportação.
   *
   * Assíncrono porque a conversão de formato usa o `sharp`, que só existe no worker: a API
   * nunca decodifica imagem, para que a superfície de ataque de um decodificador fique fora
   * do processo que atende HTTP (docs/DECISIONS.md D-030).
   */
  async create(
    principal: RequestPrincipal,
    input: CreateExportInput,
    requestId?: string,
  ): Promise<ExportJobView> {
    // Confirma que todos os resultados são do workspace antes de gravar o pedido: sem isso,
    // bastaria listar UUIDs alheios para baixar imagens de outra conta.
    const found = await this.prisma.generationResult.count({
      where: { id: { in: input.resultIds }, workspaceId: principal.workspaceId },
    });

    if (found !== new Set(input.resultIds).size) {
      throw AppError.notFound('Resultado');
    }

    const job = await this.prisma.exportJob.create({
      data: {
        workspaceId: principal.workspaceId,
        requestedById: principal.user.id,
        status: ExportStatus.QUEUED,
        format: input.format,
        resultIds: input.resultIds,
        // Arquivo de exportação é derivado e reconstruível; guardá-lo para sempre só ocupa
        // espaço. Sete dias cobrem o uso real e a política de retenção fecha o resto.
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });

    await this.queue.enqueue({
      exportJobId: job.id,
      workspaceId: principal.workspaceId,
      requestId: requestId ?? job.id,
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'export.create',
      resourceType: 'ExportJob',
      resourceId: job.id,
      metadata: { count: input.resultIds.length, format: input.format },
      ...(requestId ? { requestId } : {}),
    });

    return this.get(principal, job.id);
  }

  async get(principal: RequestPrincipal, exportId: string): Promise<ExportJobView> {
    const job = await this.prisma.exportJob.findFirst({
      where: { id: exportId, workspaceId: principal.workspaceId },
      select: {
        id: true,
        status: true,
        format: true,
        resultIds: true,
        assetIds: true,
        errorMessage: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    if (!job) throw AppError.notFound('Exportação');

    const expired = job.expiresAt !== null && job.expiresAt.getTime() < Date.now();

    return {
      id: job.id,
      status: expired ? ExportStatus.EXPIRED : job.status,
      format: job.format,
      resultIds: job.resultIds,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      expiresAt: job.expiresAt,
      files:
        job.status === ExportStatus.READY && !expired
          ? await this.filesOf(principal, job.id, job.assetIds, job.format)
          : [],
    };
  }

  async list(principal: RequestPrincipal): Promise<ExportJobView[]> {
    const jobs = await this.prisma.exportJob.findMany({
      where: { workspaceId: principal.workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true },
    });

    return Promise.all(jobs.map((job) => this.get(principal, job.id)));
  }

  private async filesOf(
    principal: RequestPrincipal,
    exportId: string,
    assetIds: string[],
    format: string,
  ): Promise<ExportFileView[]> {
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds }, workspaceId: principal.workspaceId, deletedAt: null },
      select: { id: true, storageKey: true },
    });

    // Preserva a ordem pedida: `findMany` não garante a ordem do `in`.
    const byId = new Map(assets.map((asset) => [asset.id, asset]));

    return Promise.all(
      assetIds
        .map((id) => byId.get(id))
        .filter((asset): asset is { id: string; storageKey: string } => asset !== undefined)
        .map(async (asset, index) => ({
          assetId: asset.id,
          filename: `waymage-${exportId.slice(0, 8)}-${index + 1}.${format}`,
          downloadUrl: await this.storage.signedDownloadUrl(
            asset.storageKey,
            `waymage-${exportId.slice(0, 8)}-${index + 1}.${format}`,
            SIGNED_URL_TTL.read,
          ),
        })),
    );
  }
}
