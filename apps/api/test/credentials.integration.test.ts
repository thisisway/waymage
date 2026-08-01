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
 * Chaves de API do usuário.
 *
 * O que está sob teste é uma promessa só, repetida de vários ângulos: **o valor entra e nunca
 * mais sai**. Se ele voltar por uma listagem, por uma resposta de gravação ou por um registro
 * de auditoria, a cifra em repouso não vale nada — bastaria pedir.
 */

let app: NestFastifyApplication;
let prisma: PrismaService;

const KEY = 'AIzaSyD-chave-de-teste-que-nao-existe-9876';

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

interface Session {
  cookies: string;
  csrf: string;
}

function call(session: Session, method: 'GET' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  const headers = { cookie: session.cookies, [CSRF_HEADER]: session.csrf };
  return payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload: payload as object });
}

async function setup(name: string): Promise<Session> {
  const registered = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      name,
      email: `${name}-${randomUUID().slice(0, 8)}@teste.local`,
      password: 'uma senha bem longa para teste',
    },
  });
  expect(registered.statusCode, registered.body).toBe(201);

  const { header, csrf } = parseCookies(registered.headers['set-cookie'] as string[] | undefined);
  return { cookies: header, csrf };
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

describe('credenciais de provedor', () => {
  it('guarda a chave cifrada e devolve só a dica', async () => {
    const session = await setup('cred');

    const saved = await call(session, 'PUT', '/provider-credentials/google-gemini', {
      secret: KEY,
    });
    expect(saved.statusCode, saved.body).toBe(200);

    const view = JSON.parse(saved.body) as { provider: string; hint: string };
    expect(view.provider).toBe('google-gemini');
    expect(view.hint).toBe('9876');
    // A resposta da própria gravação é o lugar mais fácil de vazar sem perceber.
    expect(saved.body).not.toContain(KEY);

    const listed = await call(session, 'GET', '/provider-credentials');
    expect(listed.body).not.toContain(KEY);
    expect(JSON.parse(listed.body)).toHaveLength(1);
  });

  it('não guarda o valor em claro no banco', async () => {
    const session = await setup('cred-db');
    await call(session, 'PUT', '/provider-credentials/google-gemini', { secret: KEY });

    const row = await prisma.providerCredential.findFirstOrThrow({
      where: { provider: 'google-gemini', revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { secretSealed: true, secretHint: true },
    });

    // O teste que importa: quem tiver um dump do banco não tem a chave.
    expect(row.secretSealed).not.toContain(KEY);
    expect(row.secretSealed).not.toContain('AIzaSy');
    expect(row.secretSealed.startsWith('v1.')).toBe(true);
    expect(row.secretHint).toBe('9876');
  });

  it('não existe rota que devolva a chave', async () => {
    const session = await setup('cred-leak');
    await call(session, 'PUT', '/provider-credentials/google-gemini', { secret: KEY });

    // Tentativas óbvias de recuperar o valor. Nenhuma pode responder com ele.
    for (const url of [
      '/provider-credentials',
      '/provider-credentials/google-gemini',
      '/provider-catalog',
    ]) {
      const response = await call(session, 'GET', url);
      expect(response.body, url).not.toContain(KEY);
    }
  });

  it('substituir revoga a anterior em vez de apagá-la', async () => {
    const session = await setup('cred-troca');
    await call(session, 'PUT', '/provider-credentials/google-gemini', { secret: KEY });
    await call(session, 'PUT', '/provider-credentials/google-gemini', {
      secret: 'AIzaSyD-outra-chave-de-teste-diferente-4321',
    });

    const listed = JSON.parse((await call(session, 'GET', '/provider-credentials')).body) as {
      hint: string;
    }[];

    // Uma ativa por provedor, e o histórico da anterior sobrevive: é ele que explica uma
    // cobrança de ontem quando a chave de hoje é outra.
    expect(listed).toHaveLength(1);
    expect(listed[0]?.hint).toBe('4321');

    const rows = await prisma.providerCredential.count({
      where: { provider: 'google-gemini', revokedAt: { not: null } },
    });
    expect(rows).toBeGreaterThan(0);
  });

  it('revoga', async () => {
    const session = await setup('cred-revoga');
    await call(session, 'PUT', '/provider-credentials/google-gemini', { secret: KEY });

    const removed = await call(session, 'DELETE', '/provider-credentials/google-gemini');
    expect(removed.statusCode).toBe(204);

    expect(JSON.parse((await call(session, 'GET', '/provider-credentials')).body)).toHaveLength(0);
  });

  it('recusa provedor desconhecido', async () => {
    const session = await setup('cred-desconhecido');

    const response = await call(session, 'PUT', '/provider-credentials/inventado', {
      secret: KEY,
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).code).toBe('UNKNOWN_PROVIDER');
  });

  it('avisa quando o formato da chave não bate com o provedor', async () => {
    const session = await setup('cred-formato');

    // Errar cedo com mensagem útil vale mais do que descobrir na primeira geração, quando a
    // mensagem vem do fornecedor e não diz o que fazer.
    const response = await call(session, 'PUT', '/provider-credentials/google-gemini', {
      secret: 'sk-isto-e-de-outro-fornecedor',
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).code).toBe('INVALID_KEY_FORMAT');
  });

  it('não enxerga credencial de outro workspace', async () => {
    const dono = await setup('cred-dono');
    const intruso = await setup('cred-intruso');
    await call(dono, 'PUT', '/provider-credentials/google-gemini', { secret: KEY });

    expect(JSON.parse((await call(intruso, 'GET', '/provider-credentials')).body)).toHaveLength(0);
    expect((await call(intruso, 'DELETE', '/provider-credentials/google-gemini')).statusCode).toBe(
      404,
    );
  });

  it('exige sessão', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/provider-credentials' });
    expect(anonymous.statusCode).toBe(401);
  });
});

/**
 * O token CSRF precisa chegar ao cliente pelo CORPO, não só pelo cookie.
 *
 * A regressão já aconteceu em produção: web e API em subdomínios diferentes, e
 * `document.cookie` da página não enxerga o cookie da API. O browser continuava enviando o
 * cookie — só a LEITURA não acontecia —, então toda mutação voltava 403 e a criação de
 * projeto falhava sem dizer por quê.
 *
 * Em desenvolvimento não aparecia: `localhost:3000` e `localhost:3333` compartilham o host,
 * porque cookie ignora porta.
 */
describe('token CSRF no corpo', () => {
  it('vem no cadastro, no login e na sessão', async () => {
    const email = `csrf-${randomUUID().slice(0, 8)}@teste.local`;
    const password = 'uma senha bem longa para teste';

    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'CSRF', email, password },
    });
    const fromRegister = (JSON.parse(registered.body) as { csrfToken?: string }).csrfToken;
    expect(fromRegister, 'cadastro').toBeTruthy();

    const loggedIn = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    const { header, csrf } = parseCookies(loggedIn.headers['set-cookie'] as string[] | undefined);
    const fromLogin = (JSON.parse(loggedIn.body) as { csrfToken?: string }).csrfToken;

    expect(fromLogin, 'login').toBeTruthy();
    // O que veio no corpo tem de ser o MESMO do cookie: o servidor compara os dois, e valores
    // diferentes recusariam toda mutação.
    expect(fromLogin).toBe(csrf);

    // Depois de um recarregamento a memória do cliente está vazia, e é por aqui que ele
    // recupera o token — sem precisar ler cookie de outro host.
    const session = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: header },
    });
    expect((JSON.parse(session.body) as { csrfToken?: string }).csrfToken).toBe(csrf);
  });

  it('o token do corpo autoriza uma mutação', async () => {
    const email = `csrf-uso-${randomUUID().slice(0, 8)}@teste.local`;
    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'CSRF', email, password: 'uma senha bem longa para teste' },
    });

    const { header } = parseCookies(registered.headers['set-cookie'] as string[] | undefined);
    const token = (JSON.parse(registered.body) as { csrfToken: string }).csrfToken;

    // Só o que o cliente consegue obter sem ler cookie: o corpo da resposta.
    const created = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { cookie: header, [CSRF_HEADER]: token },
      payload: { name: 'Projeto pelo token do corpo' },
    });

    expect(created.statusCode, created.body).toBe(201);
  });
});
