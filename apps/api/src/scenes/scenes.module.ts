import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { ScenesController } from './scenes.controller';
import { ScenesService } from './scenes.service';

@Module({
  // As referências do SceneSpec são validadas contra os assets do workspace.
  imports: [AssetsModule],
  controllers: [ScenesController],
  providers: [ScenesService],
  // O módulo de gerações cria o snapshot da cena antes de enfileirar.
  exports: [ScenesService],
})
export class ScenesModule {}
