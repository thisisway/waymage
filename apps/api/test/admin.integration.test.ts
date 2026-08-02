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
 * Painel da plataforma.
 *
 * É a única parte do sistema que atravessa o isolamento entre workspaces. O que está sob teste,
 * antes de qualquer funcionalidade, é **quem não entra** — e o que o painel nunca devolve.
 */

let app: NestFastifyApplication;
let prisma: PrismaService;

interface Session {
  cookies: string;
  csrf: string;
  userId: string;
  workspaceId: string;
}

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

function call(
  session: Session,
  method: 'GET' | 'PATCH' | 'PUT' | 'POST',
  url: string,
  payload?: unknown,
) {
  const headers = { cookie: session.cookies, [CSRF_HEADER]: session.csrf };
  return payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload: payload as object });
}

async function setup(name: string, platformAdmin = false): Promise<Session> {
  const email = `${name}-${randomUUID().slice(0, 8)}@teste.local`;
  const registered = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name, email, password: 'uma senha bem longa para teste' },
  });
  expect(registered.statusCode, registered.body).toBe(201);

  const { header, csrf } = parseCookies(registered.headers['set-cookie'] as string[] | undefined);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, memberships: { select: { workspaceId: true }, take: 1 } },
  });

  if (platformAdmin) {
    // Conceder é um UPDATE explícito, fora do alcance de qualquer rota — inclusive nos testes.
    await prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin: true } });
  }

  return {
    cookies: header,
    csrf,
    userId: user.id,
    workspaceId: user.memberships[0]?.workspaceId ?? '',
  };
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

describe('painel da plataforma', () => {
  it('usuário comum não entra', async () => {
    const comum = await setup('admin-comum');

    for (const url of ['/admin/overview', '/admin/workspaces']) {
      const response = await call(comum, 'GET', url);
      expect(response.statusCode, url).toBe(403);
      // Mesma mensagem de papel insuficiente: confirmar que a rota existe já entregaria
      // informação a quem estiver sondando.
      expect(JSON.parse(response.body).code).toBe('INSUFFICIENT_ROLE');
    }
  }, 60_000);

  it('ninguém nasce administrador', async () => {
    const novo = await setup('admin-nasce');
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: novo.userId },
      select: { isPlatformAdmin: true },
    });

    expect(user.isPlatformAdmin).toBe(false);
  }, 60_000);

  it('administrador enxerga workspaces de outras pessoas', async () => {
    const alheio = await setup('admin-alheio');
    const admin = await setup('admin-super', true);

    const listed = JSON.parse((await call(admin, 'GET', '/admin/workspaces')).body) as {
      id: string;
    }[];

    // O oposto de todo o resto do sistema, e de propósito.
    expect(listed.some((row) => row.id === alheio.workspaceId)).toBe(true);
  }, 60_000);

  it('nunca devolve valor nem dica de credencial', async () => {
    const dono = await setup('admin-cred');
    await call(dono, 'PUT', '/provider-credentials/google-gemini', {
      secret: 'AIzaSyD-segredo-que-nunca-pode-aparecer',
    });

    const admin = await setup('admin-cred-super', true);
    const body = (await call(admin, 'GET', '/admin/workspaces')).body;

    // O painel diz que existe chave, nunca qual. Nem os quatro últimos caracteres.
    expect(body).toContain('google-gemini');
    expect(body).not.toContain('AIzaSy');
    expect(body).not.toContain('arec');
  }, 60_000);

  it('não devolve conteúdo de projeto', async () => {
    const dono = await setup('admin-conteudo');
    await call(dono, 'POST', '/projects', { name: 'Nome que revela a campanha do cliente' });

    const admin = await setup('admin-conteudo-super', true);
    const body = (await call(admin, 'GET', '/admin/workspaces')).body;

    // Saber quem usou e quanto é operação; ver o que a pessoa criou é outra coisa.
    expect(body).not.toContain('revela a campanha');
  }, 60_000);

  it('ativa uma assinatura e registra no workspace afetado', async () => {
    const alvo = await setup('admin-ativar');
    const admin = await setup('admin-ativar-super', true);
    const until = new Date(Date.now() + 30 * 86_400_000);

    const response = await call(
      admin,
      'PATCH',
      `/admin/workspaces/${alvo.workspaceId}/subscription`,
      { status: 'ACTIVE', until: until.toISOString() },
    );

    expect(response.statusCode, response.body).toBe(200);
    expect(JSON.parse(response.body).subscription.status).toBe('ACTIVE');

    // A interferência aparece para quem foi afetado, não só para quem a fez.
    const audit = await prisma.auditLog.findFirst({
      where: { workspaceId: alvo.workspaceId, action: 'admin.subscription.set' },
      select: { actorUserId: true },
    });
    expect(audit?.actorUserId).toBe(admin.userId);
  }, 60_000);

  it('destrava quem estava com a avaliação vencida', async () => {
    const alvo = await setup('admin-destrava');
    await prisma.workspace.update({
      where: { id: alvo.workspaceId },
      data: { trialEndsAt: new Date(Date.now() - 86_400_000) },
    });

    const admin = await setup('admin-destrava-super', true);
    await call(admin, 'PATCH', `/admin/workspaces/${alvo.workspaceId}/subscription`, {
      status: 'ACTIVE',
      until: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });

    // É o que substitui o UPDATE manual no banco: o efeito precisa ser imediato para quem
    // estava bloqueado.
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: alvo.workspaceId },
      select: { subscriptionStatus: true },
    });
    expect(workspace.subscriptionStatus).toBe('ACTIVE');
  }, 60_000);
});
