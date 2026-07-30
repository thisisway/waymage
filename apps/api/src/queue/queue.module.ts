import { Module } from '@nestjs/common';
import { AssetQueueService } from './asset-queue.service';
import { GenerationQueueService } from './generation-queue.service';

@Module({
  providers: [GenerationQueueService, AssetQueueService],
  exports: [GenerationQueueService, AssetQueueService],
})
export class QueueModule {}
