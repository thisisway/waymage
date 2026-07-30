import 'reflect-metadata';

import fastifyCookie from '@fastify/cookie';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { registerRateLimit } from './common/rate-limit';
import { env } from './config/env';
import { RedisService } from './infra/redis.service';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    logger: { level: env.LOG_LEVEL },
    // requestId em todo request e em todo log — é o fio que liga request, job e geração.
    genReqId: (req: FastifyRequest['raw']) =>
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    requestIdHeader: 'x-request-id',
    // Limite defensivo; uploads não passam pela API, vão direto ao storage por URL assinada.
    bodyLimit: 1024 * 1024,
    // Confia no proxy para obter o IP real — necessário para o rate limit funcionar atrás
    // do reverse proxy do EasyPanel. Sem isso, todo request vem do IP do proxy.
    trustProxy: env.TRUST_PROXY,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  // Cookies precisam estar disponíveis antes de qualquer guard rodar.
  await app.register(fastifyCookie);

  app.useGlobalFilters(new HttpExceptionFilter());
  registerRateLimit(app.getHttpAdapter().getInstance(), app.get(RedisService).client);

  // Sessão por cookie exige origem explícita: `origin: true` com credenciais aceitaria
  // qualquer site e anularia a proteção do SameSite.
  app.enableCors({ origin: env.APP_URL, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.API_PORT, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`API em http://localhost:${env.API_PORT} (${env.NODE_ENV})`);
  logger.log(`Health: http://localhost:${env.API_PORT}/health`);
}

void bootstrap().catch((error: unknown) => {
  // O logger do Nest ainda não existe neste ponto.
  console.error('Falha ao iniciar a API:', error);
  process.exit(1);
});
