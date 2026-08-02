import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { corsOptions } from '../src/common/cors';

/**
 * Health precisa responder SEM sessão.
 *
 * Este teste existe porque a regressão já aconteceu: ao tornar o AuthGuard global, `/health`
 * passou a responder 401, e um balanceador leria isso como serviço fora do ar — loop de
 * restart em produção, com a aplicação perfeitamente saudável.
 */
let app: NestFastifyApplication;

const WEB_ORIGIN = 'https://app.exemplo.test';

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  app.enableCors(corsOptions(WEB_ORIGIN));
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

/**
 * Preflight.
 *
 * Este bloco existe porque a regressão já aconteceu, e nenhum outro teste podia pegá-la:
 * `app.inject()` chamando `PATCH` direto nunca dispara preflight, então o autosave passava
 * verde aqui e falhava no browser. O que se testa aqui é o preflight em si.
 */
describe('CORS', () => {
  async function preflight(method: string, origin = WEB_ORIGIN) {
    return app.inject({
      method: 'OPTIONS',
      url: '/scenes/00000000-0000-0000-0000-000000000000',
      headers: { origin, 'access-control-request-method': method },
    });
  }

  it('permite todos os métodos padrão, não só os de hoje', async () => {
    // `PATCH` é o autosave e `DELETE` é a exclusão de referência — o padrão do @fastify/cors
    // deixaria os dois de fora. `PUT` entrou na lista depois, com o cadastro de chave, e a
    // falta dele quebrou em produção: por isso a asserção cobre o conjunto inteiro, e não o
    // que a aplicação usa no momento em que este teste foi escrito.
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const allowed = (await preflight(method)).headers['access-control-allow-methods'];
      expect(String(allowed), method).toContain(method);
    }
  });

  it('responde só à origem configurada, com credenciais', async () => {
    const response = await preflight('POST');

    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    // Sem isto o browser descarta o cookie de sessão na resposta.
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('não autoriza origem desconhecida', async () => {
    const response = await preflight('POST', 'https://site-qualquer.test');

    // Origem alheia não pode receber eco: com credenciais, isso entregaria a sessão do
    // usuário a qualquer página que ele visitasse.
    expect(response.headers['access-control-allow-origin']).not.toBe('https://site-qualquer.test');
  });
});
