import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { QUEUE_EXPORTS, type ExportJobPayload } from '@waymage/domain';
import { Queue } from 'bullmq';
import { RedisService } from '../infra/redis.service';

@Injectable()
export class ExportQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(ExportQueueService.name);
  private readonly queue: Queue<ExportJobPayload>;

  constructor(redis: RedisService) {
    this.queue = new Queue<ExportJobPayload>(QUEUE_EXPORTS, {
      connection: redis.client,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 24 * 3600, count: 500 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }

  /** `jobId` = id do export: reenviar o mesmo pedido não converte duas vezes. */
  async enqueue(payload: ExportJobPayload): Promise<void> {
    await this.queue.add(QUEUE_EXPORTS, payload, { jobId: payload.exportJobId });
    this.logger.log({ exportJobId: payload.exportJobId }, 'Exportação enfileirada');
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
