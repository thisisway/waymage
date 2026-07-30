import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [QueueModule],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
