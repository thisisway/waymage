import { Module } from '@nestjs/common';
import { AssetQueueService } from './asset-queue.service';
import { ExportQueueService } from './export-queue.service';
import { GenerationQueueService } from './generation-queue.service';

@Module({
  providers: [GenerationQueueService, AssetQueueService, ExportQueueService],
  exports: [GenerationQueueService, AssetQueueService, ExportQueueService],
})
export class QueueModule {}
