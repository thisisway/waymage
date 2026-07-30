import fastifyCookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { COOKIE, CSRF_HEADER } from '../src/auth/cookies';
import { PrismaService } from '../src/infra/prisma.service';

/**
 * Aceite da Fase 2: nenhum usuário alcança recurso de outro workspace.
 *
 * Roda contra o Postgres e o Redis locais (`pnpm infra:up`). É teste de integração de
 * verdade e não mock: o risco que ele cobre — um `where` esquecendo `workspaceId` — só
 * aparece quando a query executa no banco.
 */

let app: NestFastifyApplication;
let prisma: PrismaService;

/** Sessão de um usuário: cookies e token CSRF prontos para uso nas requisições. */
interface Session {
  email: string;
  userId: string;
  workspaceId: string;
  cookies: string;
  csrf: string;
}

function parseCookies(raw: string[] | undefined): { header: string; csrf: string } {
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

async function register(name: string): Promise<Session> {
  const email = `${name}-${randomUUID().slice(0, 8)}@teste.local`;
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name, email, password: 'uma senha bem longa para teste' },
  });

  expect(response.statusCode, response.body).toBe(201);
  const { header, csrf } = parseCookies(response.headers['set-cookie'] as string[] | undefined);
  const userId = (JSON.parse(response.body) as { user: { id: string } }).user.id;

  const membership = await prisma.workspaceMember.findFirstOrThrow({
    where: { userId },
    select: { workspaceId: true },
  });

  return { email, userId, workspaceId: membership.workspaceId, cookies: header, csrf };
}

function request(
  session: Session,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
) {
  const headers = { cookie: session.cookies, [CSRF_HEADER]: session.csrf };
  return payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload });
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

describe('isolamento entre workspaces', () => {
  let alice: Session;
  let bob: Session;
  let aliceProjectId: string;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([register('alice'), register('bob')]);

    const created = await request(alice, 'POST', '/projects', { name: 'Campanha da Alice' });
    expect(created.statusCode, created.body).toBe(201);
    aliceProjectId = (JSON.parse(created.body) as { id: string }).id;
  }, 60_000);

  it('cada registro cria um workspace próprio', () => {
    expect(alice.workspaceId).not.toBe(bob.workspaceId);
  });

  it('a lista de projetos só mostra os do próprio workspace', async () => {
    const mine = JSON.parse((await request(alice, 'GET', '/projects')).body) as { id: string }[];
    const theirs = JSON.parse((await request(bob, 'GET', '/projects')).body) as { id: string }[];

    expect(mine.map((p) => p.id)).toContain(aliceProjectId);
    expect(theirs.map((p) => p.id)).not.toContain(aliceProjectId);
    expect(theirs).toHaveLength(0);
  });

  // O aceite da fase, endpoint por endpoint.
  const forbidden = [
    { method: 'GET', label: 'ler' },
    { method: 'PATCH', label: 'alterar', payload: { name: 'invadido' } },
    { method: 'DELETE', label: 'apagar' },
  ] as const;

  for (const { method, label, payload } of forbidden as readonly {
    method: 'GET' | 'PATCH' | 'DELETE';
    label: string;
    payload?: Record<string, unknown>;
  }[]) {
    it(`bob não consegue ${label} um projeto da alice — e recebe 404, não 403`, async () => {
      const response = await request(bob, method, `/projects/${aliceProjectId}`, payload);

      // 403 confirmaria que o id existe em algum lugar. 404 não conta nada.
      expect(response.statusCode).toBe(404);
      expect((JSON.parse(response.body) as { code: string }).code).toBe('RESOURCE_NOT_FOUND');
    });
  }

  it('o projeto da alice continua intacto depois das tentativas', async () => {
    const response = await request(alice, 'GET', `/projects/${aliceProjectId}`);
    expect(response.statusCode).toBe(200);
    expect((JSON.parse(response.body) as { name: string }).name).toBe('Campanha da Alice');
  });

  it('bob não enxerga os membros do workspace da alice', async () => {
    const members = JSON.parse((await request(bob, 'GET', '/workspaces/current/members')).body) as {
      user: { email: string };
    }[];
    expect(members.map((m) => m.user.email)).not.toContain(alice.email);
    expect(members).toHaveLength(1);
  });
});

describe('autenticação', () => {
  it('recusa acesso sem sessão', async () => {
    const response = await app.inject({ method: 'GET', url: '/projects' });
    expect(response.statusCode).toBe(401);
    expect((JSON.parse(response.body) as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('recusa access token forjado', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/projects',
      headers: { cookie: `${COOKIE.access}=nao.e.um.jwt.valido` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('recusa mutação sem token CSRF, mesmo com sessão válida', async () => {
    const session = await register('carol');
    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { cookie: session.cookies },
      payload: { name: 'sem csrf' },
    });

    expect(response.statusCode).toBe(403);
    expect((JSON.parse(response.body) as { code: string }).code).toBe('CSRF_TOKEN_INVALID');
  }, 60_000);

  it('recusa CSRF que não bate com o cookie', async () => {
    const session = await register('dave');
    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { cookie: session.cookies, [CSRF_HEADER]: 'valor-inventado' },
      payload: { name: 'csrf errado' },
    });
    expect(response.statusCode).toBe(403);
  }, 60_000);

  it('responde igual para e-mail inexistente e senha errada', async () => {
    const session = await register('erin');

    const [semUsuario, senhaErrada] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'ninguem@teste.local', password: 'uma senha bem longa para teste' },
      }),
      app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: session.email, password: 'uma senha bem longa errada!' },
      }),
    ]);

    // Corpo e status idênticos: nada distingue os dois casos para quem está enumerando.
    expect(semUsuario.statusCode).toBe(401);
    expect(senhaErrada.statusCode).toBe(401);
    const strip = (body: string) => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      delete parsed['requestId'];
      return parsed;
    };
    expect(strip(semUsuario.body)).toEqual(strip(senhaErrada.body));
  }, 120_000);

  it('nunca devolve o hash da senha', async () => {
    const session = await register('frank');
    const response = await request(session, 'GET', '/auth/me');
    expect(response.body).not.toContain('scrypt');
    expect(response.body).not.toContain('passwordHash');
  }, 60_000);
});

describe('rotação de refresh token', () => {
  it('troca o refresh a cada uso e revoga a família ao detectar reuso', async () => {
    const session = await register('grace');
    // /auth/refresh exige CSRF (ele se autoriza por cookie), então vão os dois cookies.
    const originalCookies = session.cookies;

    const first = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: originalCookies, [CSRF_HEADER]: session.csrf },
    });
    expect(first.statusCode, first.body).toBe(200);

    // Reapresenta o token antigo: é o sinal de que o cookie foi copiado.
    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: originalCookies, [CSRF_HEADER]: session.csrf },
    });
    expect(reuse.statusCode).toBe(401);

    // E a família inteira cai junto: o token novo também deixa de valer.
    const rotated = parseCookies(first.headers['set-cookie'] as string[] | undefined);
    const afterRevocation = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: rotated.header, [CSRF_HEADER]: rotated.csrf },
    });
    expect(afterRevocation.statusCode).toBe(401);
  }, 120_000);
});
