import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { ScenesController } from './scenes.controller';
import { ScenesService } from './scenes.service';

@Module({
  // As referências do SceneSpec são validadas contra os assets do workspace.
  imports: [AssetsModule],
  controllers: [ScenesController],
  providers: [ScenesService],
})
export class ScenesModule {}
