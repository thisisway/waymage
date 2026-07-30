import { AssetStatus, type PrismaClient } from '@waymage/database';
import { assetJobPayloadSchema, detectImageType, SIGNATURE_BYTES } from '@waymage/domain';
import { type StorageService, storageKeys } from '@waymage/storage';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import sharp from 'sharp';

/**
 * Processamento de referência enviada pelo usuário.
 *
 * Faz três coisas, todas necessárias antes de a imagem ser exibida ou enviada a um provedor:
 *
 * 1. **Miniatura** — a biblioteca do editor mostra dezenas de imagens; servir os originais
 *    em 15 MB cada tornaria a tela inutilizável.
 * 2. **Remoção de metadados** — EXIF carrega coordenadas de GPS, modelo do aparelho e
 *    data. Um retrato enviado como referência não deveria revelar onde a pessoa estava.
 *    O `sharp` descarta metadados por padrão; o que o preserva é `withMetadata()`, que
 *    deliberadamente não é chamado aqui.
 * 3. **Dimensões e cores dominantes** — alimentam a validação do SceneSpec e, mais adiante,
 *    a sugestão automática de paleta.
 */

export const THUMBNAIL_MAX_SIDE = 512;

export interface AssetProcessorDeps {
  prisma: PrismaClient;
  storage: StorageService;
  logger: Logger;
}

export async function processAssetJob(
  job: Job<unknown>,
  { prisma, storage, logger }: AssetProcessorDeps,
): Promise<{ width: number; height: number }> {
  const payload = assetJobPayloadSchema.parse(job.data);
  const log = logger.child({ assetId: payload.assetId, workspaceId: payload.workspaceId });

  const asset = await prisma.asset.findFirst({
    where: { id: payload.assetId, workspaceId: payload.workspaceId, deletedAt: null },
    select: { id: true, storageKey: true, projectId: true, workspaceId: true },
  });

  if (!asset || !asset.projectId) {
    // Asset apagado entre a confirmação e o processamento. Não é erro: nada a fazer.
    log.warn('Asset não encontrado; job descartado');
    return { width: 0, height: 0 };
  }

  try {
    const original = await storage.getObject(asset.storageKey);

    // Segunda checagem de assinatura. A primeira foi na API, mas entre uma e outra o objeto
    // poderia ter sido substituído por quem tivesse a URL assinada ainda válida.
    if (!detectImageType(original.subarray(0, SIGNATURE_BYTES))) {
      throw new Error('Conteúdo não é uma imagem suportada');
    }

    const image = sharp(original, { failOn: 'error' });
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    const thumbnail = await sharp(original)
      .rotate() // aplica a orientação do EXIF antes de descartá-lo, senão a miniatura sai deitada
      .resize(THUMBNAIL_MAX_SIDE, THUMBNAIL_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const thumbnailKey = storageKeys.assetThumbnail(asset.workspaceId, asset.projectId, asset.id);
    await storage.put({ key: thumbnailKey, body: thumbnail, contentType: 'image/webp' });

    const dominant = (await sharp(original).stats()).dominant;

    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        status: AssetStatus.READY,
        width,
        height,
        analysis: {
          dominantColor: rgbToHex(dominant),
          thumbnailBytes: thumbnail.length,
          hasAlpha: metadata.hasAlpha ?? false,
        },
      },
    });

    log.info({ width, height, thumbnailBytes: thumbnail.length }, 'Asset processado');
    return { width, height };
  } catch (error) {
    // FAILED e não exceção silenciosa: a biblioteca precisa mostrar que aquele upload não
    // deu certo, em vez de deixar o card girando para sempre.
    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        status: AssetStatus.FAILED,
        analysis: { error: error instanceof Error ? error.message : 'erro desconhecido' },
      },
    });
    log.error({ err: error }, 'Falha ao processar asset');
    throw error;
  }
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const hex = (value: number) => Math.round(value).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}
