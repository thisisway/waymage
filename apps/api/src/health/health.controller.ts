import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '../auth/auth.guard';
import { HealthService, type HealthReport } from './health.service';

/**
 * Health checks são públicos por necessidade: quem consulta é o orquestrador, que não tem
 * sessão. Sem `@Public()`, o guard global responde 401, o balanceador entende "fora do ar"
 * e o serviço entra em loop de restart.
 *
 * O que é exposto é deliberadamente pobre — nome da dependência, estado e latência. Nunca
 * host, credencial ou mensagem de erro do driver.
 */
@Public()
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
