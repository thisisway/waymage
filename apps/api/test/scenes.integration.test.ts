import fastifyCookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { COOKIE, CSRF_HEADER } from '../src/auth/cookies';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';

/**
 * Cenas, versões e autosave.
 *
 * O que este arquivo protege: a trava otimista (duas abas não podem sobrescrever uma à
 * outra em silêncio), a imutabilidade das versões e o isolamento por workspace nas rotas
 * novas. Nada disso é verificável sem banco de verdade.
 */

let app: NestFastifyApplication;

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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
) {
  const headers = { cookie: session.cookies, [CSRF_HEADER]: session.csrf };
  return payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload });
}

/** Cria usuário, workspace e um projeto — o mínimo para ter onde pendurar cenas. */
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
  expect(project.statusCode, project.body).toBe(201);

  return { ...session, projectId: (JSON.parse(project.body) as { id: string }).id };
}

async function createScene(session: Session, name = 'Cena de teste') {
  const response = await call(session, 'POST', `/projects/${session.projectId}/scenes`, { name });
  expect(response.statusCode, response.body).toBe(201);
  return JSON.parse(response.body) as { id: string; revision: number; sceneSpec: SceneSpecShape };
}

interface SceneSpecShape {
  version: string;
  subject: { description: string };
  output: { count: number; aspectRatio: string };
  [key: string]: unknown;
}

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  await app.register(fastifyCookie);
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('criação de cena', () => {
  let session: Session;
  beforeAll(async () => {
    session = await setup('scene-owner');
  }, 60_000);

  it('nasce com um SceneSpec válido, sem o usuário precisar montar nada', async () => {
    const scene = await createScene(session);
    expect(scene.sceneSpec.version).toBe('1.0');
    expect(scene.sceneSpec.output.count).toBe(4);
    expect(scene.revision).toBe(0);
  });

  it('recusa SceneSpec inválido antes de gravar', async () => {
    const response = await call(session, 'POST', `/projects/${session.projectId}/scenes`, {
      name: 'Inválida',
      sceneSpec: { version: '1.0', output: { count: 999 } },
    });

    expect(response.statusCode).toBe(400);
    expect((JSON.parse(response.body) as { code: string }).code).toBe('SCENE_SPEC_INVALID');
  });

  it('recusa cena em projeto de outro workspace', async () => {
    const outro = await setup('scene-outsider');
    const response = await call(outro, 'POST', `/projects/${session.projectId}/scenes`, {
      name: 'Invasão',
    });
    expect(response.statusCode).toBe(404);
  }, 60_000);
});

describe('autosave com trava otimista', () => {
  let session: Session;
  beforeAll(async () => {
    session = await setup('autosave');
  }, 60_000);

  it('grava e incrementa a revisão', async () => {
    const scene = await createScene(session);

    const saved = await call(session, 'PATCH', `/scenes/${scene.id}`, {
      revision: scene.revision,
      sceneSpec: {
        ...scene.sceneSpec,
        subject: { ...scene.sceneSpec.subject, description: 'psicanalista' },
      },
    });

    expect(saved.statusCode, saved.body).toBe(200);
    const updated = JSON.parse(saved.body) as { revision: number; sceneSpec: SceneSpecShape };
    expect(updated.revision).toBe(scene.revision + 1);
    expect(updated.sceneSpec.subject.description).toBe('psicanalista');
  });

  it('persiste entre leituras — recarregar não perde o trabalho', async () => {
    const scene = await createScene(session, 'Persistência');
    await call(session, 'PATCH', `/scenes/${scene.id}`, {
      revision: scene.revision,
      name: 'Renomeada',
    });

    const reloaded = JSON.parse((await call(session, 'GET', `/scenes/${scene.id}`)).body) as {
      name: string;
    };
    expect(reloaded.name).toBe('Renomeada');
  });

  it('recusa a segunda aba que salva com revisão velha', async () => {
    const scene = await createScene(session, 'Conflito');

    // Duas abas leram a mesma revisão. A primeira salva e vence.
    const first = await call(session, 'PATCH', `/scenes/${scene.id}`, {
      revision: scene.revision,
      name: 'Primeira aba',
    });
    expect(first.statusCode).toBe(200);

    // A segunda ainda acha que está na revisão antiga.
    const second = await call(session, 'PATCH', `/scenes/${scene.id}`, {
      revision: scene.revision,
      name: 'Segunda aba',
    });

    expect(second.statusCode).toBe(409);
    const error = JSON.parse(second.body) as {
      code: string;
      details: { currentRevision: number; yourRevision: number };
    };
    expect(error.code).toBe('SCENE_REVISION_CONFLICT');
    // O editor precisa saber o estado atual para resolver o conflito sem perder nada.
    expect(error.details.currentRevision).toBe(scene.revision + 1);
    expect(error.details.yourRevision).toBe(scene.revision);

    // E o valor da primeira aba continua de pé — o conflito não escreveu nada.
    const current = JSON.parse((await call(session, 'GET', `/scenes/${scene.id}`)).body) as {
      name: string;
    };
    expect(current.name).toBe('Primeira aba');
  });

  it('não grava SceneSpec inválido', async () => {
    const scene = await createScene(session, 'Validação');
    const response = await call(session, 'PATCH', `/scenes/${scene.id}`, {
      revision: scene.revision,
      sceneSpec: { ...scene.sceneSpec, camera: { shot: 'plano_inexistente' } },
    });

    expect(response.statusCode).toBe(400);
    // Revisão intacta: nada foi gravado.
    const current = JSON.parse((await call(session, 'GET', `/scenes/${scene.id}`)).body) as {
      revision: number;
    };
    expect(current.revision).toBe(scene.revision);
  });

  it('devolve os conflitos do SceneSpec para validação inline', async () => {
    const scene = await createScene(session, 'Conflitos');
    const saved = await call(session, 'PATCH', `/scenes/${scene.id}`, {
      revision: scene.revision,
      sceneSpec: {
        ...scene.sceneSpec,
        composition: { subjectPosition: 'left', negativeSpace: 'left' },
      },
    });

    const updated = JSON.parse(saved.body) as { issues: { code: string; level: string }[] };
    expect(updated.issues.map((i) => i.code)).toContain('NEGATIVE_SPACE_CONFLICT');
  });
});

describe('versões imutáveis', () => {
  let session: Session;
  beforeAll(async () => {
    session = await setup('versoes');
  }, 60_000);

  it('snapshot congela o rascunho e não muda quando o rascunho muda', async () => {
    const scene = await createScene(session, 'Versionada');

    await call(session, 'PATCH', `/scenes/${scene.id}`, {
      revision: 0,
      sceneSpec: {
        ...scene.sceneSpec,
        subject: { ...scene.sceneSpec.subject, description: 'antes' },
      },
    });

    const snapshot = await call(session, 'POST', `/scenes/${scene.id}/versions`, {
      changeSummary: 'primeira versão',
    });
    expect(snapshot.statusCode, snapshot.body).toBe(201);
    const version = JSON.parse(snapshot.body) as {
      id: string;
      versionNumber: number;
      sceneSpec: SceneSpecShape;
    };
    expect(version.versionNumber).toBe(1);
    expect(version.sceneSpec.subject.description).toBe('antes');

    // O rascunho segue evoluindo...
    await call(session, 'PATCH', `/scenes/${scene.id}`, {
      revision: 1,
      sceneSpec: {
        ...scene.sceneSpec,
        subject: { ...scene.sceneSpec.subject, description: 'depois' },
      },
    });

    // ...e a versão continua exatamente como foi congelada.
    const stored = JSON.parse(
      (await call(session, 'GET', `/scene-versions/${version.id}`)).body,
    ) as { sceneSpec: SceneSpecShape };
    expect(stored.sceneSpec.subject.description).toBe('antes');
  });

  it('numera versões em sequência e liga cada uma à anterior', async () => {
    const scene = await createScene(session, 'Linhagem');
    await call(session, 'POST', `/scenes/${scene.id}/versions`, {});
    await call(session, 'POST', `/scenes/${scene.id}/versions`, {});

    const versions = JSON.parse(
      (await call(session, 'GET', `/scenes/${scene.id}/versions`)).body,
    ) as { versionNumber: number; parentVersionId: string | null; id: string }[];

    expect(versions.map((v) => v.versionNumber)).toEqual([2, 1]);
    // A v2 aponta para a v1: é o que permite reconstruir a linha do tempo.
    expect(versions[0]?.parentVersionId).toBe(versions[1]?.id);
    expect(versions[1]?.parentVersionId).toBeNull();
  });

  it('duplicar uma versão cria cena nova sem tocar na original', async () => {
    const scene = await createScene(session, 'Original');
    const version = JSON.parse(
      (await call(session, 'POST', `/scenes/${scene.id}/versions`, {})).body,
    ) as { id: string };

    const copy = await call(session, 'POST', `/scene-versions/${version.id}/duplicate`);
    expect(copy.statusCode, copy.body).toBe(201);

    const duplicated = JSON.parse(copy.body) as { id: string; name: string };
    expect(duplicated.id).not.toBe(scene.id);
    expect(duplicated.name).toContain('Original');

    const original = JSON.parse((await call(session, 'GET', `/scenes/${scene.id}`)).body) as {
      name: string;
    };
    expect(original.name).toBe('Original');
  });
});

describe('isolamento das rotas de cena', () => {
  it('não alcança cena, versão nem lista de outro workspace', async () => {
    const dono = await setup('dono-cena');
    const intruso = await setup('intruso-cena');

    const scene = await createScene(dono, 'Confidencial');
    const version = JSON.parse(
      (await call(dono, 'POST', `/scenes/${scene.id}/versions`, {})).body,
    ) as { id: string };

    // Todas as rotas novas respondem 404 — nunca 403, que confirmaria a existência.
    const attempts = [
      call(intruso, 'GET', `/scenes/${scene.id}`),
      call(intruso, 'PATCH', `/scenes/${scene.id}`, { revision: 0, name: 'invadido' }),
      call(intruso, 'DELETE', `/scenes/${scene.id}`),
      call(intruso, 'GET', `/scenes/${scene.id}/versions`),
      call(intruso, 'POST', `/scenes/${scene.id}/versions`, {}),
      call(intruso, 'GET', `/scene-versions/${version.id}`),
      call(intruso, 'POST', `/scene-versions/${version.id}/duplicate`),
      call(intruso, 'GET', `/projects/${dono.projectId}/scenes`),
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.statusCode).toBe(404);
    }

    // E a cena do dono continua intacta.
    const intact = JSON.parse((await call(dono, 'GET', `/scenes/${scene.id}`)).body) as {
      name: string;
    };
    expect(intact.name).toBe('Confidencial');
  }, 120_000);
});

describe('projeto nasce com a primeira cena', () => {
  it('cria a cena junto e devolve o id dela', async () => {
    const session = await setup('primeira-cena');

    const created = await call(session, 'POST', '/projects', { name: 'Campanha de verão' });
    const project = JSON.parse(created.body) as { id: string; firstSceneId?: string };

    // Sem isto a tela cairia numa lista vazia com outro formulário de nome — dois batismos
    // antes de qualquer coisa acontecer.
    expect(project.firstSceneId).toBeTruthy();

    const scenes = JSON.parse(
      (await call(session, 'GET', `/projects/${project.id}/scenes`)).body,
    ) as { id: string; name: string }[];

    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.id).toBe(project.firstSceneId);
    // O nome do projeto, não "Cena 1": o projeto quase sempre tem uma cena só.
    expect(scenes[0]?.name).toBe('Campanha de verão');
  }, 60_000);

  it('a cena nasce com um SceneSpec válido e editável', async () => {
    const session = await setup('primeira-cena-spec');
    const created = JSON.parse(
      (await call(session, 'POST', '/projects', { name: 'Outra' })).body,
    ) as { firstSceneId: string };

    const scene = JSON.parse(
      (await call(session, 'GET', `/scenes/${created.firstSceneId}`)).body,
    ) as {
      sceneSpec: { version: string };
      revision: number;
    };

    expect(scene.sceneSpec.version).toBe('1.0');
    // Editável de imediato: o autosave usa `revision` como compare-and-swap.
    expect(scene.revision).toBe(0);
  }, 60_000);
});
