import { generationJobPayloadSchema, type GenerationEvent } from '@waymage/domain';
import { type StorageService, storageKeys } from '@waymage/storage';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { env } from './config/env';
import type { EventPublisher } from './events';
import { resolveProvider } from './providers';
import { runProviderJob } from './run-provider-job';

/**
 * Pipeline de geração.
 *
 * ponytail: Fase 1 executa o trecho provider → storage → eventos. Moderação, compilação de
 * prompt, roteamento, avaliação, persistência de GenerationResult e captura de créditos
 * entram nas Fases 5 e 6 — cada um é um passo a mais neste mesmo pipeline, não uma
 * reescrita. Enquanto não existe tabela de jobs, o worker gera a partir do payload.
 */

export interface ProcessorDeps {
  storage: StorageService;
  events: EventPublisher;
  logger: Logger;
}

export async function processGenerationJob(
  job: Job<unknown>,
  { storage, events, logger }: ProcessorDeps,
): Promise<{ keys: string[] }> {
  // A fila é fronteira de confiança como qualquer outra: valida o que sai dela.
  const payload = generationJobPayloadSchema.parse(job.data);
  const log = logger.child({
    generationJobId: payload.generationJobId,
    workspaceId: payload.workspaceId,
    requestId: payload.requestId,
  });

  const emit = async (status: string, progress: number, message?: string): Promise<void> => {
    const event: GenerationEvent = {
      generationJobId: payload.generationJobId,
      status,
      progress,
      at: new Date().toISOString(),
      ...(message === undefined ? {} : { message }),
    };
    await events.publish(event);
  };

  await emit('SUBMITTING', 0.05);

  const provider = resolveProvider();
  log.info({ provider: provider.id }, 'Provedor selecionado');

  const status = await runProviderJob(
    provider,
    {
      requestId: payload.requestId,
      prompt: `cena de smoke ${payload.requestId}`,
      references: [],
      aspectRatio: '16:9',
      format: 'png',
      count: 4,
      mode: 'draft',
    },
    {
      timeoutMs: env.PROVIDER_TIMEOUT_MS,
      pollIntervalMs: 250,
      onProgress: (progress) => emit('PROCESSING', 0.05 + progress * 0.7),
    },
  );

  await emit('DOWNLOADING', 0.8);

  const keys = await Promise.all(
    status.images.map(async (image, index) => {
      const key = storageKeys.generationResult(
        payload.workspaceId,
        // Fase 1 ainda não tem projeto; a chave usa o job para manter o formato definitivo.
        payload.generationJobId,
        payload.generationJobId,
        index,
        'png',
      );
      await storage.put({ key, body: image.data, contentType: image.mimeType });
      return key;
    }),
  );

  await emit('COMPLETED', 1, `${keys.length} imagens armazenadas`);
  log.info({ count: keys.length, provider: provider.id }, 'Geração concluída');

  return { keys };
}
