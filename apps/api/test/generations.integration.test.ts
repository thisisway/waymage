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
 * Criação de geração.
 *
 * Cobre a parte que a API decide sozinha: idempotência, snapshot automático, bloqueio por
 * conflito e isolamento. O pipeline do worker é exercitado à parte — aqui o job fica em
 * `QUEUED`, porque não há worker rodando durante o teste.
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
  method: 'GET' | 'POST' | 'PATCH',
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

async function createScene(session: Session, name = 'Cena') {
  const response = await call(session, 'POST', `/projects/${session.projectId}/scenes`, { name });
  expect(response.statusCode, response.body).toBe(201);
  return JSON.parse(response.body) as {
    id: string;
    revision: number;
    sceneSpec: Record<string, unknown>;
  };
}

function generate(session: Session, sceneId: string, idempotencyKey = randomUUID()) {
  return call(
    session,
    'POST',
    '/generation-jobs',
    { sceneId },
    { 'idempotency-key': idempotencyKey },
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

describe('estimativa', () => {
  it('devolve custo, provedor, resumo e prompt antes de gerar', async () => {
    const session = await setup('estimativa');
    const scene = await createScene(session);

    const response = await call(session, 'POST', '/generation-jobs/estimate', {
      sceneId: scene.id,
    });
    expect(response.statusCode, response.body).toBe(200);

    const estimate = JSON.parse(response.body) as {
      provider: string;
      credits: number;
      count: number;
      prompt: string;
      summary: string;
      canGenerate: boolean;
      alternatives: { provider: string; eligible: boolean; credits: number; score: number }[];
    };

    expect(estimate.provider).toBe('fake-rapido');
    expect(estimate.credits).toBeGreaterThan(0);
    expect(estimate.count).toBe(4);
    expect(estimate.prompt.length).toBeGreaterThan(50);
    expect(estimate.summary).toContain('4 imagens');
    expect(estimate.canGenerate).toBe(true);

    // A alternativa descartada aparece com o motivo: "por que não usou o melhor" é a
    // primeira pergunta de quem vê o número, e responder depois exigiria reproduzir a
    // decisão de roteamento fora do sistema.
    expect(estimate.alternatives.length).toBeGreaterThan(1);
    expect(estimate.alternatives[0]?.provider).toBe(estimate.provider);
    expect(estimate.alternatives[0]?.credits).toBe(estimate.credits);
    // Ordenada por pontuação, do melhor para o pior.
    const scores = estimate.alternatives.filter((a) => a.eligible).map((a) => a.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  }, 60_000);

  it('marca canGenerate como falso quando a cena tem erro bloqueante', async () => {
    const session = await setup('estimativa-bloqueada');
    const scene = await createScene(session);

    // Espaço negativo em cima do sujeito é erro, não aviso.
    await call(session, 'PATCH', `/scenes/${scene.id}`, {
      revision: scene.revision,
      sceneSpec: {
        ...scene.sceneSpec,
        composition: { subjectPosition: 'left', negativeSpace: 'left' },
      },
    });

    const estimate = JSON.parse(
      (await call(session, 'POST', '/generation-jobs/estimate', { sceneId: scene.id })).body,
    ) as { canGenerate: boolean; issues: { code: string }[] };

    expect(estimate.canGenerate).toBe(false);
    expect(estimate.issues.map((i) => i.code)).toContain('NEGATIVE_SPACE_CONFLICT');
  }, 60_000);
});

describe('criação da geração', () => {
  it('enfileira e aponta para uma SceneVersion imutável criada na hora', async () => {
    const session = await setup('criar-geracao');
    const scene = await createScene(session);

    const response = await generate(session, scene.id);
    expect(response.statusCode, response.body).toBe(202);

    const job = JSON.parse(response.body) as {
      id: string;
      status: string;
      sceneVersionId: string;
      requestedCount: number;
      estimatedCredits: number;
    };

    expect(job.status).toBe('QUEUED');
    expect(job.requestedCount).toBe(4);
    expect(job.estimatedCredits).toBeGreaterThan(0);

    // O snapshot é o que garante que editar a cena depois não muda o que gerou a imagem.
    const version = await prisma.sceneVersion.findUniqueOrThrow({
      where: { id: job.sceneVersionId },
      select: { sceneId: true, changeSummary: true },
    });
    expect(version.sceneId).toBe(scene.id);
    expect(version.changeSummary).toContain('snapshot automático');
  }, 60_000);

  it('a mesma idempotency key devolve o mesmo job, não cria outro', async () => {
    const session = await setup('idempotencia');
    const scene = await createScene(session);
    const key = randomUUID();

    const first = JSON.parse((await generate(session, scene.id, key)).body) as { id: string };
    const second = JSON.parse((await generate(session, scene.id, key)).body) as { id: string };

    // Duplo clique ou retry de rede não pode virar duas cobranças.
    expect(second.id).toBe(first.id);
    expect(await prisma.generationJob.count({ where: { sceneId: scene.id } })).toBe(1);
  }, 60_000);

  it('chaves diferentes criam jobs diferentes', async () => {
    const session = await setup('chaves-distintas');
    const scene = await createScene(session);

    const first = JSON.parse((await generate(session, scene.id)).body) as { id: string };
    const second = JSON.parse((await generate(session, scene.id)).body) as { id: string };

    expect(second.id).not.toBe(first.id);
  }, 60_000);

  it('recusa gerar cena com erro bloqueante', async () => {
    const session = await setup('bloqueada');
    const scene = await createScene(session);

    await call(session, 'PATCH', `/scenes/${scene.id}`, {
      revision: scene.revision,
      sceneSpec: {
        ...scene.sceneSpec,
        output: { format: 'jpeg', transparentBackground: true },
      },
    });

    const response = await generate(session, scene.id);
    expect(response.statusCode).toBe(400);
    expect((JSON.parse(response.body) as { code: string }).code).toBe('SCENE_HAS_BLOCKING_ISSUES');

    // E nada foi enfileirado.
    expect(await prisma.generationJob.count({ where: { sceneId: scene.id } })).toBe(0);
  }, 60_000);
});

describe('cancelamento', () => {
  it('cancela job que ainda não terminou', async () => {
    const session = await setup('cancelar');
    const scene = await createScene(session);
    const job = JSON.parse((await generate(session, scene.id)).body) as { id: string };

    const cancelled = await call(session, 'POST', `/generation-jobs/${job.id}/cancel`);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect((JSON.parse(cancelled.body) as { status: string }).status).toBe('CANCELLED');
  }, 60_000);

  it('recusa cancelar job já finalizado', async () => {
    const session = await setup('cancelar-duas-vezes');
    const scene = await createScene(session);
    const job = JSON.parse((await generate(session, scene.id)).body) as { id: string };

    await call(session, 'POST', `/generation-jobs/${job.id}/cancel`);
    const second = await call(session, 'POST', `/generation-jobs/${job.id}/cancel`);

    expect(second.statusCode).toBe(409);
    expect((JSON.parse(second.body) as { code: string }).code).toBe('GENERATION_ALREADY_FINISHED');
  }, 60_000);
});

describe('isolamento', () => {
  it('não alcança geração, eventos nem cancelamento de outro workspace', async () => {
    const dono = await setup('dono-geracao');
    const intruso = await setup('intruso-geracao');

    const scene = await createScene(dono);
    const job = JSON.parse((await generate(dono, scene.id)).body) as { id: string };

    for (const response of await Promise.all([
      call(intruso, 'GET', `/generation-jobs/${job.id}`),
      call(intruso, 'POST', `/generation-jobs/${job.id}/cancel`),
      call(intruso, 'GET', `/scenes/${scene.id}/generation-jobs`),
      // O stream SSE confirma o tenancy antes de abrir: sem isso bastaria adivinhar o UUID.
      call(intruso, 'GET', `/generation-jobs/${job.id}/events`),
    ])) {
      expect(response.statusCode).toBe(404);
    }
  }, 120_000);

  it('não gera em cena de outro workspace', async () => {
    const dono = await setup('dono-cena-gen');
    const intruso = await setup('intruso-cena-gen');
    const scene = await createScene(dono);

    expect((await generate(intruso, scene.id)).statusCode).toBe(404);
  }, 120_000);
});
