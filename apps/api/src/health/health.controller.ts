import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { HealthService, type HealthReport } from './health.service';

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: o processo está de pé? Não toca em dependência nenhuma. */
  @Get('health/live')
  @HttpCode(HttpStatus.OK)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness: dá para atender request? Verifica Postgres, Redis e storage.
   * Responde 503 quando alguma dependência está fora — é o que o load balancer precisa.
   */
  @Get('health')
  async check(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthReport> {
    const report = await this.health.check();
    void reply.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
