import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AssetKind, AssetStatus } from '@waymage/database';
import {
  detectImageType,
  EXTENSION_BY_TYPE,
  MAX_UPLOAD_BYTES,
  SIGNATURE_BYTES,
  type AllowedImageType,
} from '@waymage/domain';
import { SIGNED_URL_TTL, storageKeys } from '@waymage/storage';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { PrismaService } from '../infra/prisma.service';
import { AppStorageService } from '../infra/storage.service';
import type { RequestPrincipal } from '../auth/request-user';
import { AssetQueueService } from '../queue/asset-queue.service';
import type { RequestUploadInput } from './assets.schemas';

export interface UploadTicket {
  assetId: string;
  /** URL assinada de PUT, válida por poucos minutos. */
  uploadUrl: string;
  /** O cliente precisa enviar exatamente este Content-Type: ele foi assinado junto. */
  contentType: string;
  expiresInSeconds: number;
}

export interface AssetView {
  id: string;
  kind: AssetKind;
  status: AssetStatus;
  mimeType: string;
  originalName: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
  /** URL assinada de leitura. Curta e renovada a cada consulta. */
  url: string | null;
  thumbnailUrl: string | null;
}

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AppStorageService,
    private readonly queue: AssetQueueService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Passo 1: reserva o asset e devolve URL assinada.
   *
   * O arquivo vai do browser direto para o storage, sem passar pela API — o que evita
   * carregar dezenas de MB na memória do processo que atende todo mundo.
   *
   * A chave no bucket é gerada aqui, a partir de ids nossos. Derivá-la do nome enviado
   * permitiria path traversal (`../../outro-workspace/...`) e colisão entre usuários.
   */
  async requestUpload(
    principal: RequestPrincipal,
    input: RequestUploadInput,
  ): Promise<UploadTicket> {
    await this.assertProject(principal, input.projectId);

    const assetId = randomUUID();
    const extension = EXTENSION_BY_TYPE[input.contentType];
    const storageKey = storageKeys.assetOriginal(
      principal.workspaceId,
      input.projectId,
      assetId,
      extension,
    );

    await this.prisma.asset.create({
      data: {
        id: assetId,
        workspaceId: principal.workspaceId,
        projectId: input.projectId,
        kind: AssetKind.REFERENCE,
        status: AssetStatus.PENDING_UPLOAD,
        storageKey,
        mimeType: input.contentType,
        sizeBytes: input.sizeBytes,
        originalName: input.filename,
        uploadedById: principal.user.id,
      },
    });

    return {
      assetId,
      uploadUrl: await this.storage.signedUploadUrl(storageKey, input.contentType),
      contentType: input.contentType,
      expiresInSeconds: SIGNED_URL_TTL.upload,
    };
  }

  /**
   * Passo 3: confirma o upload e valida o que realmente chegou.
   *
   * Aqui está a verificação que importa: o tipo é determinado pelos **bytes**, não pelo que
   * o cliente declarou. Nada impede alguém de pedir URL para `image/png` e subir um HTML com
   * script — e esse arquivo voltaria ao browser depois. Só o conteúdo decide.
   */
  async completeUpload(
    principal: RequestPrincipal,
    assetId: string,
    requestId?: string,
  ): Promise<AssetView> {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, workspaceId: principal.workspaceId, deletedAt: null },
    });
    if (!asset) throw AppError.notFound('Asset');

    if (asset.status !== AssetStatus.PENDING_UPLOAD) {
      throw new AppError(
        'ASSET_ALREADY_COMPLETED',
        'Este upload já foi confirmado.',
        HttpStatus.CONFLICT,
      );
    }

    const object = await this.storage.getObject(asset.storageKey).catch(() => null);
    if (!object) {
      throw new AppError(
        'UPLOAD_NOT_FOUND',
        'O arquivo não chegou ao storage. Tente enviar novamente.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Tamanho real, não o declarado: a URL assinada não limita quantos bytes cabem nela.
    if (object.length > MAX_UPLOAD_BYTES) {
      await this.quarantine(asset.id, asset.storageKey, 'FILE_TOO_LARGE');
      throw new AppError(
        'FILE_TOO_LARGE',
        `O arquivo excede ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const detected = detectImageType(object.subarray(0, SIGNATURE_BYTES));
    if (!detected) {
      // Some do bucket na hora: arquivo não identificado não fica guardado esperando alguém
      // encontrar uma forma de servi-lo.
      await this.quarantine(asset.id, asset.storageKey, 'UNSUPPORTED_FILE_TYPE');
      throw new AppError(
        'UNSUPPORTED_FILE_TYPE',
        'O arquivo enviado não é uma imagem JPEG, PNG ou WebP.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (detected !== asset.mimeType) {
      this.logger.warn(
        { assetId, declared: asset.mimeType, detected, requestId },
        'Tipo declarado difere do conteúdo real; prevalece o conteúdo',
      );
    }

    const updated = await this.prisma.asset.update({
      where: { id: asset.id },
      data: {
        status: AssetStatus.PROCESSING,
        // Prevalece o tipo detectado, sempre.
        mimeType: detected,
        sizeBytes: object.length,
        checksum: createHash('sha256').update(object).digest('hex'),
      },
    });

    await this.queue.enqueue({
      assetId: asset.id,
      workspaceId: principal.workspaceId,
      requestId: requestId ?? 'complete',
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'asset.upload_complete',
      resourceType: 'Asset',
      resourceId: asset.id,
      metadata: { mimeType: detected, sizeBytes: object.length },
      ...(requestId ? { requestId } : {}),
    });

    return this.toView(updated);
  }

  async list(principal: RequestPrincipal, projectId: string): Promise<AssetView[]> {
    await this.assertProject(principal, projectId);

    const assets = await this.prisma.asset.findMany({
      where: {
        workspaceId: principal.workspaceId,
        projectId,
        kind: AssetKind.REFERENCE,
        deletedAt: null,
        // PENDING_UPLOAD é upload abandonado: não existe arquivo para mostrar.
        status: { in: [AssetStatus.PROCESSING, AssetStatus.READY, AssetStatus.FAILED] },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(assets.map((asset) => this.toView(asset)));
  }

  async get(principal: RequestPrincipal, assetId: string): Promise<AssetView> {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, workspaceId: principal.workspaceId, deletedAt: null },
    });
    if (!asset) throw AppError.notFound('Asset');
    return this.toView(asset);
  }

  /**
   * Exclusão: apaga os bytes e marca a linha.
   *
   * A linha sobrevive porque `GenerationResult` e `AuditLog` a referenciam — apagá-la
   * levaria junto o histórico de o que gerou o quê. Os bytes, que são o dado pessoal,
   * somem de verdade.
   */
  async remove(principal: RequestPrincipal, assetId: string, requestId?: string): Promise<void> {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, workspaceId: principal.workspaceId, deletedAt: null },
      select: { id: true, storageKey: true, projectId: true },
    });
    if (!asset) throw AppError.notFound('Asset');

    const thumbnailKey = asset.projectId
      ? storageKeys.assetThumbnail(principal.workspaceId, asset.projectId, asset.id)
      : null;

    await Promise.all([
      this.storage.delete(asset.storageKey).catch((error: unknown) => {
        // Falha ao apagar do bucket não pode travar a exclusão; fica registrada para varredura.
        this.logger.error({ assetId, err: error }, 'Falha ao remover objeto do storage');
      }),
      thumbnailKey ? this.storage.delete(thumbnailKey).catch(() => undefined) : Promise.resolve(),
    ]);

    await this.prisma.asset.updateMany({
      where: { id: asset.id, workspaceId: principal.workspaceId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'asset.delete',
      resourceType: 'Asset',
      resourceId: asset.id,
      ...(requestId ? { requestId } : {}),
    });
  }

  /**
   * Confirma que todos os assets referenciados são do workspace.
   *
   * Chamado antes de gravar um SceneSpec: sem isto, bastaria escrever o UUID de um asset
   * alheio no campo `references` para que a geração o utilizasse. É o mesmo IDOR das rotas,
   * entrando por dentro de um campo JSON.
   */
  async assertAssetsBelongToWorkspace(workspaceId: string, assetIds: string[]): Promise<void> {
    const unique = [...new Set(assetIds)];
    if (unique.length === 0) return;

    const found = await this.prisma.asset.count({
      where: { id: { in: unique }, workspaceId, deletedAt: null },
    });

    if (found !== unique.length) {
      throw new AppError(
        'REFERENCE_ASSET_NOT_FOUND',
        'Uma das referências não existe ou não pertence a este workspace.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async toView(asset: {
    id: string;
    workspaceId: string;
    projectId: string | null;
    kind: AssetKind;
    status: AssetStatus;
    mimeType: string;
    originalName: string | null;
    sizeBytes: number | null;
    width: number | null;
    height: number | null;
    storageKey: string;
    createdAt: Date;
  }): Promise<AssetView> {
    // READY só é gravado pelo worker depois de a miniatura existir, então o status é a
    // própria confirmação — não é preciso guardar a chave nem consultar o bucket.
    const ready = asset.status === AssetStatus.READY;
    const thumbnailKey =
      ready && asset.projectId
        ? storageKeys.assetThumbnail(asset.workspaceId, asset.projectId, asset.id)
        : null;

    return {
      id: asset.id,
      kind: asset.kind,
      status: asset.status,
      mimeType: asset.mimeType,
      originalName: asset.originalName,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      createdAt: asset.createdAt,
      // Bucket privado: a única forma de o browser ver a imagem é por URL assinada curta.
      url: ready ? await this.storage.signedReadUrl(asset.storageKey) : null,
      thumbnailUrl: thumbnailKey ? await this.storage.signedReadUrl(thumbnailKey) : null,
    };
  }

  private async quarantine(assetId: string, storageKey: string, reason: string): Promise<void> {
    await this.storage.delete(storageKey).catch(() => undefined);
    await this.prisma.asset.update({
      where: { id: assetId },
      data: { status: AssetStatus.QUARANTINED, analysis: { reason } },
    });
  }

  private async assertProject(principal: RequestPrincipal, projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId: principal.workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw AppError.notFound('Projeto');
  }
}

/** Reexport para o controller não precisar conhecer o enum do Prisma. */
export type { AllowedImageType };
