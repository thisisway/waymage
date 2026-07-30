import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

/**
 * Health precisa responder SEM sessão.
 *
 * Este teste existe porque a regressão já aconteceu: ao tornar o AuthGuard global, `/health`
 * passou a responder 401, e um balanceador leria isso como serviço fora do ar — loop de
 * restart em produção, com a aplicação perfeitamente saudável.
 */
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('health checks', () => {
  it('/health/live responde sem autenticação', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
  });

  it('/health responde sem autenticação e reporta as dependências', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);

    const report = JSON.parse(response.body) as {
      status: string;
      dependencies: { name: string; state: string }[];
    };
    expect(report.status).toBe('ok');
    expect(report.dependencies.map((d) => d.name).sort()).toEqual(['postgres', 'redis', 'storage']);
  });

  it('não vaza host, credencial ou detalhe de driver', async () => {
    const body = (await app.inject({ method: 'GET', url: '/health' })).body;
    for (const leak of ['postgresql://', 'minioadmin', 'password', 'waymage:waymage']) {
      expect(body).not.toContain(leak);
    }
  });
});
