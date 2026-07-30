import { AssetKind, AssetStatus, ExportStatus, type PrismaClient } from '@waymage/database';
import { exportJobPayloadSchema } from '@waymage/domain';
import { type StorageService, storageKeys } from '@waymage/storage';
import { UnrecoverableError, type Job } from 'bullmq';
import type { Logger } from 'pino';
import sharp from 'sharp';

/**
 * Conversão de formato para download.
 *
 * Roda no worker, e não na API, porque decodificar imagem é onde moram os CVEs de
 * biblioteca gráfica — manter isso fora do processo que atende HTTP é a razão da
 * docs/DECISIONS.md D-030.
 *
 * ponytail: um arquivo por resultado, sem ZIP. Empacotar exigiria uma dependência de
 * arquivamento para um caso que ainda não sabemos se acontece — quem exporta a grade inteira
 * baixa quatro arquivos. Trocar por ZIP é acrescentar um passo aqui quando o uso justificar.
 */

export interface ExportProcessorDeps {
  prisma: PrismaClient;
  storage: StorageService;
  logger: Logger;
}

/** Formatos de entrega e como o sharp os produz. */
const ENCODERS = {
  png: (image: sharp.Sharp) => image.png(),
  jpeg: (image: sharp.Sharp) => image.jpeg({ quality: 92 }),
  webp: (image: sharp.Sharp) => image.webp({ quality: 92 }),
} as const;

type ExportFormat = keyof typeof ENCODERS;

export async function processExportJob(
  job: Job<unknown>,
  { prisma, storage, logger }: ExportProcessorDeps,
): Promise<{ assetIds: string[] }> {
  const payload = exportJobPayloadSchema.parse(job.data);
  const log = logger.child({ exportJobId: payload.exportJobId, workspaceId: payload.workspaceId });

  const exportJob = await prisma.exportJob.findFirst({
    where: { id: payload.exportJobId, workspaceId: payload.workspaceId },
    select: { id: true, format: true, resultIds: true, status: true },
  });

  if (!exportJob) {
    log.warn('Exportação não encontrada; job descartado');
    return { assetIds: [] };
  }

  if (exportJob.status === ExportStatus.READY) {
    log.info('Exportação já concluída; nada a fazer');
    return { assetIds: [] };
  }

  try {
    await prisma.exportJob.update({
      where: { id: exportJob.id },
      data: { status: ExportStatus.PROCESSING },
    });

    const results = await prisma.generationResult.findMany({
      where: { id: { in: exportJob.resultIds }, workspaceId: payload.workspaceId },
      select: {
        id: true,
        asset: { select: { storageKey: true, projectId: true } },
      },
    });

    const byId = new Map(results.map((result) => [result.id, result]));
    const format = (exportJob.format in ENCODERS ? exportJob.format : 'png') as ExportFormat;
    const assetIds: string[] = [];

    // Ordem preservada: o usuário espera os arquivos na sequência que escolheu.
    for (const [index, resultId] of exportJob.resultIds.entries()) {
      const result = byId.get(resultId);
      if (!result?.asset?.projectId) continue;

      const original = await storage.getObject(result.asset.storageKey);
      // Sem `withMetadata()`: a exportação também não deve carregar metadados.
      const converted = await ENCODERS[format](sharp(original)).toBuffer();

      const key = storageKeys.export(
        payload.workspaceId,
        result.asset.projectId,
        `${exportJob.id}-${index}`,
        format,
      );
      await storage.put({ key, body: converted, contentType: `image/${format}` });

      const asset = await prisma.asset.create({
        data: {
          workspaceId: payload.workspaceId,
          projectId: result.asset.projectId,
          kind: AssetKind.EXPORT,
          status: AssetStatus.READY,
          storageKey: key,
          mimeType: `image/${format}`,
          sizeBytes: converted.length,
        },
        select: { id: true },
      });

      assetIds.push(asset.id);
    }

    if (assetIds.length === 0) throw new Error('Nenhum resultado exportável encontrado');

    await prisma.exportJob.update({
      where: { id: exportJob.id },
      data: { status: ExportStatus.READY, assetIds },
    });

    log.info({ count: assetIds.length, format }, 'Exportação concluída');
    return { assetIds };
  } catch (error) {
    // FAILED com mensagem, não exceção silenciosa: a tela precisa dizer o que houve em vez
    // de deixar o download girando para sempre.
    await prisma.exportJob.update({
      where: { id: exportJob.id },
      data: {
        status: ExportStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : 'Falha ao exportar',
      },
    });
    log.error({ err: error }, 'Falha ao exportar');

    // Objeto ausente no bucket não reaparece por insistência: repetir só gasta CPU e enche
    // o log. `UnrecoverableError` diz ao BullMQ para não tentar de novo.
    if (isMissingObject(error)) {
      throw new UnrecoverableError(
        error instanceof Error ? error.message : 'Arquivo de origem não encontrado',
      );
    }
    throw error;
  }
}

/** O erro do S3 para objeto inexistente é permanente, não transitório. */
function isMissingObject(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'NoSuchKey' || error.name === 'NotFound')
  );
}
