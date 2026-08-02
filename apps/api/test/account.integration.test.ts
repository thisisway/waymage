import fastifyCookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { COOKIE, CSRF_HEADER } from '../src/auth/cookies';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { PrismaService } from '../src/infra/prisma.service';

/**
 * Exclusão de conta.
 *
 * O produto guarda imagens que podem ser de pessoas reais e chaves de API de terceiros. O que
 * está sob teste é que "excluir" apaga mesmo — não marca uma coluna e segue guardando.
 */

let app: NestFastifyApplication;
let prisma: PrismaService;

const PASSWORD = 'uma senha bem longa para teste';

function parseCookies(raw: string[] | undefined) {
  const jar = new Map<string, string>();
  for (const entry of raw ?? []) {
    const [pair] = entry.split(';');
    const index = pair?.indexOf('=') ?? -1;
    if (pair && index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return {
    header: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    csrf: jar.get(COOKIE.csrf) ?? '',
  };
}

interface Session {
  cookies: string;
  csrf: string;
  email: string;
}

function call(
  session: Session,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  const headers = { cookie: session.cookies, [CSRF_HEADER]: session.csrf };
  return payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload: payload as object });
}

async function setup(name: string): Promise<Session> {
  const email = `${name}-${randomUUID().slice(0, 8)}@teste.local`;
  const registered = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name, email, password: PASSWORD },
  });
  expect(registered.statusCode, registered.body).toBe(201);

  const { header, csrf } = parseCookies(registered.headers['set-cookie'] as string[] | undefined);
  return { cookies: header, csrf, email };
}

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  await app.register(fastifyCookie);
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  prisma = app.get(PrismaService);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('exclusão de conta', () => {
  it('apaga workspace, projetos e credenciais de verdade', async () => {
    const session = await setup('excluir');
    const project = JSON.parse(
      (await call(session, 'POST', '/projects', { name: 'Some junto' })).body,
    ) as { id: string };

    await call(session, 'PUT', '/provider-credentials/google-gemini', {
      secret: 'AIzaSyD-chave-que-precisa-sumir-0000',
    });

    const workspaceId = (
      await prisma.project.findUniqueOrThrow({
        where: { id: project.id },
        select: { workspaceId: true },
      })
    ).workspaceId;

    expect((await call(session, 'DELETE', '/account', { password: PASSWORD })).statusCode).toBe(
      204,
    );

    // Nada de `deletedAt`: apagado lógico serve para desfazer clique errado, e é exatamente o
    // que não pode acontecer com um pedido de exclusão.
    expect(await prisma.workspace.findUnique({ where: { id: workspaceId } })).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: project.id } })).toBeNull();
    expect(await prisma.providerCredential.count({ where: { workspaceId } })).toBe(0);
    expect(await prisma.user.findUnique({ where: { email: session.email } })).toBeNull();
  }, 60_000);

  it('exige a senha, mesmo com sessão válida', async () => {
    const session = await setup('excluir-senha');

    // Sessão aberta num computador emprestado não deveria bastar para destruir o trabalho de
    // alguém.
    const response = await call(session, 'DELETE', '/account', { password: 'senha errada' });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).code).toBe('INVALID_PASSWORD');
    expect(await prisma.user.findUnique({ where: { email: session.email } })).not.toBeNull();
  }, 60_000);

  it('derruba a sessão junto', async () => {
    const session = await setup('excluir-sessao');
    const response = await call(session, 'DELETE', '/account', { password: PASSWORD });

    const cleared = (response.headers['set-cookie'] as string[] | undefined) ?? [];
    // Deixar a sessão de pé apontaria para uma conta que não existe, e o request seguinte
    // voltaria 401 sem explicar por quê.
    expect(cleared.join(' ')).toContain(COOKIE.access);
    expect(cleared.join(' ')).toContain(COOKIE.refresh);
  }, 60_000);

  it('recusa quem não está autenticado', async () => {
    const anonymous = await app.inject({
      method: 'DELETE',
      url: '/account',
      payload: { password: PASSWORD },
    });

    // 403 e não 401: o CSRF é verificado ANTES da sessão, de propósito. Requisição forjada é
    // recusada sem que o servidor faça trabalho nenhum — inclusive sem consultar usuário.
    expect(anonymous.statusCode).toBe(403);
    expect(JSON.parse(anonymous.body).code).toBe('CSRF_TOKEN_INVALID');
  }, 60_000);
});
