import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ScenesModule } from '../scenes/scenes.module';
import { GenerationEventsService } from './generation-events.service';
import { GenerationsController } from './generations.controller';
import { GenerationsService } from './generations.service';

@Module({
  // O snapshot antes de gerar é feito pelo ScenesService.
  imports: [ScenesModule, QueueModule],
  controllers: [GenerationsController],
  providers: [GenerationsService, GenerationEventsService],
})
export class GenerationsModule {}
