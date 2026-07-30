import { QUEUE_GENERATION } from '@waymage/domain';
import { StorageService } from '@waymage/storage';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { env } from './config/env';
import { EventPublisher } from './events';
import { processGenerationJob } from './processor';
import { providerRegistry } from './providers';

const logger = pino({ level: env.LOG_LEVEL, base: { service: 'worker-generation' } });

// `maxRetriesPerRequest: null` é requisito do BullMQ para comandos bloqueantes.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const publisher = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const storage = new StorageService({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

const events = new EventPublisher(publisher, env.NODE_ENV !== 'production');

const worker = new Worker(
  QUEUE_GENERATION,
  (job) => processGenerationJob(job, { storage, events, logger }),
  { connection, concurrency: env.WORKER_CONCURRENCY },
);

worker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, attempt: job?.attemptsMade, err: error }, 'Job falhou');
});

worker.on('ready', () => {
  logger.info(
    {
      queue: QUEUE_GENERATION,
      concurrency: env.WORKER_CONCURRENCY,
      providers: providerRegistry.ids(),
    },
    'Worker pronto',
  );
});

/**
 * Encerramento gracioso: `worker.close()` espera os jobs em voo terminarem em vez de
 * abandoná-los no meio — job interrompido depois de submeter ao provedor é crédito
 * consumido sem resultado entregue.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Encerrando worker');
  await worker.close();
  storage.destroy();
  await Promise.all([connection.quit(), publisher.quit()]);
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal));
}
