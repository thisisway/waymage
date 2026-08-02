import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  // A fila entra aqui porque o health reporta a profundidade dela: sem isso, "parado na fila"
  // e "worker fora do ar" são indistinguíveis de fora.
  imports: [QueueModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
