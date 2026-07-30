import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { QUEUE_GENERATION, type GenerationJobPayload } from '@waymage/domain';
import { Queue } from 'bullmq';
import { RedisService } from '../infra/redis.service';

/**
 * Produtor da fila de geração.
 *
 * A fila carrega apenas referências (ids), nunca estado: o worker lê o job no banco. Isso
 * evita que um payload antigo, preso na fila durante um deploy, reprocesse dados obsoletos.
 */
@Injectable()
export class GenerationQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(GenerationQueueService.name);
  private readonly queue: Queue<GenerationJobPayload>;

  constructor(redis: RedisService) {
    this.queue = new Queue<GenerationJobPayload>(QUEUE_GENERATION, {
      connection: redis.client,
      defaultJobOptions: {
        // Teto baixo de tentativas: cada retry pode custar dinheiro real quando houver
        // provedor de verdade. Falha persistente é problema para o operador, não para o loop.
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }

  /**
   * Enfileira uma geração. `jobId` do BullMQ = id do GenerationJob, o que torna o enqueue
   * idempotente: reenviar a mesma criação não duplica execução.
   */
  async enqueue(payload: GenerationJobPayload): Promise<void> {
    await this.queue.add(QUEUE_GENERATION, payload, { jobId: payload.generationJobId });
    this.logger.log(
      { generationJobId: payload.generationJobId, requestId: payload.requestId },
      'Geração enfileirada',
    );
  }

  async counts(): Promise<Record<string, number>> {
    return this.queue.getJobCounts();
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
