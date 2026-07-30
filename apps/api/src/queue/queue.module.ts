import { Module } from '@nestjs/common';
import { GenerationQueueService } from './generation-queue.service';

@Module({
  providers: [GenerationQueueService],
  exports: [GenerationQueueService],
})
export class QueueModule {}
