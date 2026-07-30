import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

@Module({
  imports: [QueueModule],
  controllers: [AssetsController],
  providers: [AssetsService],
  // O módulo de cenas valida as referências do SceneSpec com este service.
  exports: [AssetsService],
})
export class AssetsModule {}
