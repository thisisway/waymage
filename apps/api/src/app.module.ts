import { Module, type DynamicModule } from '@nestjs/common';
import { env } from './config/env';
import { DevController } from './dev/dev.controller';
import { HealthModule } from './health/health.module';
import { InfraModule } from './infra/infra.module';
import { QueueModule } from './queue/queue.module';

/**
 * Raiz da aplicação.
 *
 * Os "services" do blueprint (auth, projects, scenes, billing, generation) entram aqui como
 * módulos NestJS conforme as fases avançam — não como processos separados
 * (docs/DECISIONS.md D-002).
 */
@Module({
  imports: [InfraModule, QueueModule, HealthModule],
  controllers: devControllers(),
})
export class AppModule {}

/** Controllers de smoke só existem fora de produção. */
function devControllers(): NonNullable<DynamicModule['controllers']> {
  return env.NODE_ENV === 'production' ? [] : [DevController];
}
