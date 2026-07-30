import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { QUEUE_ASSETS, type AssetJobPayload } from '@waymage/domain';
import { Queue } from 'bullmq';
import { RedisService } from '../infra/redis.service';

/** Produtor da fila de processamento de assets (miniatura, EXIF, análise). */
@Injectable()
export class AssetQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(AssetQueueService.name);
  private readonly queue: Queue<AssetJobPayload>;

  constructor(redis: RedisService) {
    this.queue = new Queue<AssetJobPayload>(QUEUE_ASSETS, {
      connection: redis.client,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }

  /** `jobId` = id do asset: confirmar o mesmo upload duas vezes não processa duas vezes. */
  async enqueue(payload: AssetJobPayload): Promise<void> {
    await this.queue.add(QUEUE_ASSETS, payload, { jobId: payload.assetId });
    this.logger.log({ assetId: payload.assetId }, 'Asset enfileirado para processamento');
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
