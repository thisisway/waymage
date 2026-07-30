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
 * Variação, refinamento e exportação.
 *
 * O worker não roda durante o teste, então as gerações ficam em `QUEUED` — o que está sob
 * teste é a decisão da API: reusar a versão da cena, registrar a linhagem, ajustar qualidade
 * e contagem, e não deixar nada escapar entre workspaces.
 */

let app: NestFastifyApplication;
let prisma: PrismaService;

interface Session {
  cookies: string;
  csrf: string;
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
  const project = await call(session, 'POST', '/projects', { name: `Projeto de ${name}` });

  return { ...session, projectId: (JSON.parse(project.body) as { id: string }).id };
}

/**
 * Cria um job com um resultado, como o worker faria.
 *
 * Passar pelo pipeline real exigiria worker rodando; o que interessa aqui é ter um
 * `GenerationResult` válido do qual derivar.
 */
async function seedResult(
  session: Session,
): Promise<{ resultId: string; jobId: string; sceneId: string }> {
  const scene = JSON.parse(
    (await call(session, 'POST', `/projects/${session.projectId}/scenes`, { name: 'Cena' })).body,
  ) as { id: string };

  const job = JSON.parse(
    (
      await call(
        session,
        'POST',
        '/generation-jobs',
        { sceneId: scene.id },
        { 'idempotency-key': randomUUID() },
      )
    ).body,
  ) as { id: string };

  const full = await prisma.generationJob.findUniqueOrThrow({
    where: { id: job.id },
    select: { workspaceId: true, projectId: true },
  });

  const asset = await prisma.asset.create({
    data: {
      workspaceId: full.workspaceId,
      projectId: full.projectId,
      kind: 'GENERATED',
      status: 'READY',
      storageKey: `workspaces/${full.workspaceId}/projects/${full.projectId}/generations/${job.id}/0.png`,
      mimeType: 'image/png',
      width: 512,
      height: 512,
    },
    select: { id: true },
  });

  const result = await prisma.generationResult.create({
    data: {
      workspaceId: full.workspaceId,
      generationJobId: job.id,
      assetId: asset.id,
      width: 512,
      height: 512,
      format: 'png',
      seed: BigInt(4242),
    },
    select: { id: true },
  });

  return { resultId: result.id, jobId: job.id, sceneId: scene.id };
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

describe('variação', () => {
  it('reusa a versão da cena e registra de qual resultado nasceu', async () => {
    const session = await setup('variacao');
    const { resultId, jobId } = await seedResult(session);

    const response = await call(session, 'POST', `/generation-results/${resultId}/variation`);
    expect(response.statusCode, response.body).toBe(202);

    const variation = JSON.parse(response.body) as {
      id: string;
      operationType: string;
      sourceResultId: string;
      sceneVersionId: string;
      requestedCount: number;
    };

    const original = await prisma.generationJob.findUniqueOrThrow({
      where: { id: jobId },
      select: { sceneVersionId: true },
    });

    expect(variation.operationType).toBe('VARIATION');
    expect(variation.sourceResultId).toBe(resultId);
    // Mesma versão: variar é explorar outra saída da MESMA especificação. Tirar snapshot novo
    // misturaria edições feitas depois e a comparação deixaria de ser honesta.
    expect(variation.sceneVersionId).toBe(original.sceneVersionId);
    expect(variation.requestedCount).toBe(4);
  }, 60_000);

  it('reserva créditos como qualquer geração', async () => {
    const session = await setup('variacao-credito');
    const { resultId } = await seedResult(session);

    const before = JSON.parse((await call(session, 'GET', '/billing/wallet')).body) as {
      balance: number;
    };
    await call(session, 'POST', `/generation-results/${resultId}/variation`);
    const after = JSON.parse((await call(session, 'GET', '/billing/wallet')).body) as {
      balance: number;
      reserved: number;
    };

    expect(after.balance).toBeLessThan(before.balance);
    expect(after.reserved).toBeGreaterThan(0);
  }, 60_000);

  it('a mesma idempotency key não cria duas variações', async () => {
    const session = await setup('variacao-idem');
    const { resultId } = await seedResult(session);
    const key = randomUUID();

    const first = JSON.parse(
      (
        await call(session, 'POST', `/generation-results/${resultId}/variation`, undefined, {
          'idempotency-key': key,
        })
      ).body,
    ) as { id: string };
    const second = JSON.parse(
      (
        await call(session, 'POST', `/generation-results/${resultId}/variation`, undefined, {
          'idempotency-key': key,
        })
      ).body,
    ) as { id: string };

    expect(second.id).toBe(first.id);
  }, 60_000);
});

describe('refinamento', () => {
  it('gera uma imagem só, em qualidade final', async () => {
    const session = await setup('refino');
    const { resultId } = await seedResult(session);

    const refine = JSON.parse(
      (await call(session, 'POST', `/generation-results/${resultId}/refine`)).body,
    ) as { operationType: string; requestedCount: number; estimatedCredits: number };

    expect(refine.operationType).toBe('REFINE');
    // O usuário já escolheu a saída; renderizar quatro vezes em qualidade final seria
    // desperdício de crédito.
    expect(refine.requestedCount).toBe(1);
    expect(refine.estimatedCredits).toBeGreaterThan(0);
  }, 60_000);
});

describe('exportação', () => {
  it('cria o pedido e devolve status inicial', async () => {
    const session = await setup('exportar');
    const { resultId } = await seedResult(session);

    const response = await call(session, 'POST', '/exports', {
      resultIds: [resultId],
      format: 'jpeg',
    });

    expect(response.statusCode, response.body).toBe(202);
    const job = JSON.parse(response.body) as {
      id: string;
      status: string;
      format: string;
      resultIds: string[];
      files: unknown[];
      expiresAt: string;
    };

    expect(job.status).toBe('QUEUED');
    expect(job.format).toBe('jpeg');
    expect(job.resultIds).toEqual([resultId]);
    // Ainda não há arquivo: o worker é quem converte.
    expect(job.files).toHaveLength(0);
    // Export é derivado e reconstruível; não fica guardado para sempre.
    expect(new Date(job.expiresAt).getTime()).toBeGreaterThan(Date.now());
  }, 60_000);

  it('recusa formato fora dos suportados', async () => {
    const session = await setup('exportar-formato');
    const { resultId } = await seedResult(session);

    const response = await call(session, 'POST', '/exports', {
      resultIds: [resultId],
      format: 'tiff',
    });
    expect(response.statusCode).toBe(400);
  }, 60_000);

  it('recusa exportar resultado de outro workspace', async () => {
    const dono = await setup('dono-export');
    const intruso = await setup('intruso-export');
    const { resultId } = await seedResult(dono);

    // Sem esta checagem, bastaria listar UUIDs alheios para baixar imagens de outra conta.
    const response = await call(intruso, 'POST', '/exports', {
      resultIds: [resultId],
      format: 'png',
    });
    expect(response.statusCode).toBe(404);
  }, 120_000);
});

describe('isolamento das derivações', () => {
  it('não varia, refina nem lê resultado de outro workspace', async () => {
    const dono = await setup('dono-derivar');
    const intruso = await setup('intruso-derivar');
    const { resultId } = await seedResult(dono);

    for (const response of await Promise.all([
      call(intruso, 'POST', `/generation-results/${resultId}/variation`),
      call(intruso, 'POST', `/generation-results/${resultId}/refine`),
      call(intruso, 'POST', `/generation-results/${resultId}/select`),
    ])) {
      expect(response.statusCode).toBe(404);
    }
  }, 120_000);
});
