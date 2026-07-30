import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    logger: { level: env.LOG_LEVEL },
    // requestId em todo request e em todo log — é o fio que liga request, job e geração.
    genReqId: (req: FastifyRequest['raw']) =>
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    requestIdHeader: 'x-request-id',
    // Limite defensivo; uploads não passam pela API, vão direto ao storage por URL assinada.
    bodyLimit: 1024 * 1024,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  app.useGlobalFilters(new HttpExceptionFilter());

  // Sessão será por cookie (D-009), então a origem precisa ser explícita e com credenciais.
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
