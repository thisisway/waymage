import fastifyCookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WELCOME_CREDITS } from '@waymage/billing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { COOKIE, CSRF_HEADER } from '../src/auth/cookies';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { PrismaService } from '../src/infra/prisma.service';

/**
 * Créditos vistos pela API.
 *
 * A aritmética já é coberta em `@waymage/billing`; aqui o que importa é o acoplamento com a
 * geração: a reserva acontece antes de enfileirar, o cancelamento devolve, saldo insuficiente
 * bloqueia, e nada disso vaza entre workspaces.
 */

let app: NestFastifyApplication;
let prisma: PrismaService;

interface Session {
  cookies: string;
  csrf: string;
  workspaceId: string;
  projectId: string;
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

function call(
  session: Pick<Session, 'cookies' | 'csrf'>,
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
) {
  const headers = { cookie: session.cookies, [CSRF_HEADER]: session.csrf, ...extraHeaders };
  return payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload });
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
  const session = { cookies: header, csrf };

  const userId = (JSON.parse(registered.body) as { user: { id: string } }).user.id;
  const membership = await prisma.workspaceMember.findFirstOrThrow({
    where: { userId },
    select: { workspaceId: true },
  });

  const project = await call(session, 'POST', '/projects', { name: `Projeto de ${name}` });

  return {
    ...session,
    workspaceId: membership.workspaceId,
    projectId: (JSON.parse(project.body) as { id: string }).id,
  };
}

async function createScene(session: Session) {
  const response = await call(session, 'POST', `/projects/${session.projectId}/scenes`, {
    name: 'Cena',
  });
  return JSON.parse(response.body) as { id: string };
}

function generate(session: Session, sceneId: string) {
  return call(
    session,
    'POST',
    '/generation-jobs',
    { sceneId },
    { 'idempotency-key': randomUUID() },
  );
}

function wallet(session: Session) {
  return call(session, 'GET', '/billing/wallet').then(
    (r) => JSON.parse(r.body) as { balance: number; reserved: number },
  );
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

describe('carteira', () => {
  it('cadastro concede créditos de boas-vindas', async () => {
    const session = await setup('boas-vindas');

    // Sem isto, a primeira coisa depois do cadastro seria uma tela dizendo que não dá para gerar.
    expect(await wallet(session)).toEqual({ balance: WELCOME_CREDITS, reserved: 0 });
  }, 60_000);

  it('o extrato registra o bônus inicial', async () => {
    const session = await setup('extrato');
    const transactions = JSON.parse((await call(session, 'GET', '/billing/transactions')).body) as {
      type: string;
      amount: number;
      balanceAfter: number;
    }[];

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      type: 'BONUS',
      amount: WELCOME_CREDITS,
      balanceAfter: WELCOME_CREDITS,
    });
  }, 60_000);
});

describe('reserva ao gerar', () => {
  it('gerar move crédito do disponível para o reservado', async () => {
    const session = await setup('reserva');
    const scene = await createScene(session);

    const response = await generate(session, scene.id);
    expect(response.statusCode, response.body).toBe(202);

    const job = JSON.parse(response.body) as { estimatedCredits: number };
    const after = await wallet(session);

    expect(after.reserved).toBe(job.estimatedCredits);
    expect(after.balance).toBe(WELCOME_CREDITS - job.estimatedCredits);
    // O total não muda: reservar não é gastar.
    expect(after.balance + after.reserved).toBe(WELCOME_CREDITS);
  }, 60_000);

  it('a reserva é registrada no extrato, vinculada ao job', async () => {
    const session = await setup('reserva-extrato');
    const scene = await createScene(session);
    const job = JSON.parse((await generate(session, scene.id)).body) as { id: string };

    const transactions = JSON.parse((await call(session, 'GET', '/billing/transactions')).body) as {
      type: string;
      generationJobId: string | null;
    }[];

    const reservation = transactions.find((t) => t.type === 'RESERVATION');
    expect(reservation?.generationJobId).toBe(job.id);
  }, 60_000);

  it('cancelar devolve a reserva por inteiro', async () => {
    const session = await setup('cancelar-devolve');
    const scene = await createScene(session);
    const job = JSON.parse((await generate(session, scene.id)).body) as { id: string };

    await call(session, 'POST', `/generation-jobs/${job.id}/cancel`);

    // O usuário não recebeu imagem nenhuma: não pode pagar.
    expect(await wallet(session)).toEqual({ balance: WELCOME_CREDITS, reserved: 0 });
  }, 60_000);
});

describe('saldo insuficiente', () => {
  it('bloqueia a geração com 402 e não enfileira nada', async () => {
    const session = await setup('sem-saldo');
    const scene = await createScene(session);

    // Zera o saldo por fora, como se os créditos já tivessem sido gastos.
    await prisma.creditWallet.update({
      where: { workspaceId: session.workspaceId },
      data: { balance: 0 },
    });

    const response = await generate(session, scene.id);

    expect(response.statusCode).toBe(402);
    const error = JSON.parse(response.body) as {
      code: string;
      details: { required: number; available: number };
    };
    expect(error.code).toBe('GENERATION_INSUFFICIENT_CREDITS');
    expect(error.details.available).toBe(0);
    expect(error.details.required).toBeGreaterThan(0);

    // O job não pode ficar em QUEUED: o worker o pegaria e geraria de graça.
    const queued = await prisma.generationJob.count({
      where: { sceneId: scene.id, status: 'QUEUED' },
    });
    expect(queued).toBe(0);
  }, 60_000);

  it('gerações sucessivas esgotam o saldo e a seguinte é recusada', async () => {
    const session = await setup('esgotar');
    const scene = await createScene(session);

    // Cada geração custa 4 créditos (4 imagens em rascunho); 100 dão para 25.
    let recusadas = 0;
    for (let i = 0; i < 27; i++) {
      const response = await generate(session, scene.id);
      if (response.statusCode === 402) recusadas++;
    }

    expect(recusadas).toBe(2);

    const final = await wallet(session);
    expect(final.balance).toBe(0);
    expect(final.balance + final.reserved).toBe(WELCOME_CREDITS);
  }, 180_000);
});

describe('integridade e isolamento', () => {
  it('a soma do extrato bate com o saldo', async () => {
    const session = await setup('reconciliacao');
    const scene = await createScene(session);
    const job = JSON.parse((await generate(session, scene.id)).body) as { id: string };
    await call(session, 'POST', `/generation-jobs/${job.id}/cancel`);

    const result = JSON.parse((await call(session, 'GET', '/billing/reconcile')).body) as {
      consistent: boolean;
      ledgerSum: number;
      walletBalance: number;
    };

    // Divergir significaria que algum saldo mudou sem transação — o que a regra proíbe.
    expect(result.consistent).toBe(true);
    expect(result.ledgerSum).toBe(result.walletBalance);
  }, 60_000);

  it('a carteira de um workspace não aparece no outro', async () => {
    const alice = await setup('carteira-alice');
    const bob = await setup('carteira-bob');
    const scene = await createScene(alice);

    await generate(alice, scene.id);

    // Bob nunca gerou nada: seu saldo está intacto e o extrato só tem o próprio bônus.
    expect(await wallet(bob)).toEqual({ balance: WELCOME_CREDITS, reserved: 0 });

    const bobTransactions = JSON.parse((await call(bob, 'GET', '/billing/transactions')).body) as {
      type: string;
    }[];
    expect(bobTransactions.map((t) => t.type)).toEqual(['BONUS']);
  }, 120_000);
});
