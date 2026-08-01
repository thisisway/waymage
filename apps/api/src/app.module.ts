import { Module } from '@nestjs/common';
import { AssetsModule } from './assets/assets.module';
import { CredentialsModule } from './credentials/credentials.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { ExportsModule } from './exports/exports.module';
import { GenerationsModule } from './generations/generations.module';
import { HealthModule } from './health/health.module';
import { InfraModule } from './infra/infra.module';
import { ProjectsModule } from './projects/projects.module';
import { QueueModule } from './queue/queue.module';
import { ScenesModule } from './scenes/scenes.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

/**
 * Raiz da aplicação.
 *
 * Os "services" do blueprint entram aqui como módulos NestJS conforme as fases avançam —
 * não como processos separados (docs/DECISIONS.md D-002).
 */
@Module({
  imports: [
    InfraModule,
    AuditModule,
    BillingModule,
    AuthModule,
    WorkspacesModule,
    ProjectsModule,
    ScenesModule,
    AssetsModule,
    CredentialsModule,
    GenerationsModule,
    ExportsModule,
    QueueModule,
    HealthModule,
  ],
})
export class AppModule {}
