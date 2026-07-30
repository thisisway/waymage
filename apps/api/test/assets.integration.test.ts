import fastifyCookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { COOKIE, CSRF_HEADER } from '../src/auth/cookies';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { AppStorageService } from '../src/infra/storage.service';

/**
 * Upload de referências.
 *
 * O teste que mais importa aqui é o do arquivo disfarçado: pedir URL assinada declarando
 * `image/png` e enviar um HTML com script. Se isso passar, o arquivo volta ao browser
 * depois — e nenhum mock pega esse caso, porque ele depende do que realmente chegou ao
 * bucket.
 */

let app: NestFastifyApplication;
let storage: AppStorageService;

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
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
) {
  const headers = { cookie: session.cookies, [CSRF_HEADER]: session.csrf };
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

/** PNG 1×1 real, para o sharp ter algo decodificável de verdade. */
const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Pede a URL assinada e coloca `content` no bucket sob a chave reservada.
 *
 * O PUT é feito pelo storage e não pela URL HTTP porque `app.inject` não faz rede — o que
 * está sob teste é a validação do `complete`, não o transporte.
 */
async function upload(session: Session, content: Buffer, declaredType = 'image/png') {
  const ticket = await call(session, 'POST', '/assets/upload-url', {
    projectId: session.projectId,
    filename: 'referencia.png',
    contentType: declaredType,
    sizeBytes: content.length,
  });
  expect(ticket.statusCode, ticket.body).toBe(200);

  const { assetId } = JSON.parse(ticket.body) as { assetId: string };

  const key = await keyOf(assetId);
  await storage.put({ key, body: content, contentType: declaredType });

  return { assetId, complete: () => call(session, 'POST', '/assets/complete', { assetId }) };
}

async function keyOf(assetId: string): Promise<string> {
  const { PrismaService } = await import('../src/infra/prisma.service');
  const prisma = app.get(PrismaService);
  const asset = await prisma.asset.findUniqueOrThrow({
    where: { id: assetId },
    select: { storageKey: true },
  });
  return asset.storageKey;
}

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  await app.register(fastifyCookie);
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  storage = app.get(AppStorageService);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('upload assinado', () => {
  let session: Session;
  beforeAll(async () => {
    session = await setup('uploader');
  }, 60_000);

  it('devolve URL de PUT com expiração curta', async () => {
    const response = await call(session, 'POST', '/assets/upload-url', {
      projectId: session.projectId,
      filename: 'foto.png',
      contentType: 'image/png',
      sizeBytes: 1024,
    });

    expect(response.statusCode).toBe(200);
    const ticket = JSON.parse(response.body) as {
      uploadUrl: string;
      expiresInSeconds: number;
      assetId: string;
    };

    expect(ticket.uploadUrl).toContain('X-Amz-Signature');
    expect(ticket.expiresInSeconds).toBeLessThanOrEqual(15 * 60);
    // A chave é derivada de ids nossos e começa pelo workspace.
    expect(await keyOf(ticket.assetId)).toMatch(/^workspaces\/[0-9a-f-]+\/projects\//);
  });

  it('recusa tipo fora da lista de permitidos', async () => {
    for (const contentType of ['image/svg+xml', 'application/pdf', 'text/html']) {
      const response = await call(session, 'POST', '/assets/upload-url', {
        projectId: session.projectId,
        filename: 'x',
        contentType,
        sizeBytes: 100,
      });
      expect(response.statusCode, contentType).toBe(400);
    }
  });

  it('recusa arquivo acima do teto', async () => {
    const response = await call(session, 'POST', '/assets/upload-url', {
      projectId: session.projectId,
      filename: 'gigante.png',
      contentType: 'image/png',
      sizeBytes: 500 * 1024 * 1024,
    });
    expect(response.statusCode).toBe(400);
  });

  it('recusa upload em projeto de outro workspace', async () => {
    const intruso = await setup('intruso-upload');
    const response = await call(intruso, 'POST', '/assets/upload-url', {
      projectId: session.projectId,
      filename: 'x.png',
      contentType: 'image/png',
      sizeBytes: 100,
    });
    expect(response.statusCode).toBe(404);
  }, 60_000);
});

describe('confirmação valida o conteúdo real', () => {
  let session: Session;
  beforeAll(async () => {
    session = await setup('validacao');
  }, 60_000);

  it('aceita um PNG de verdade', async () => {
    const { complete } = await upload(session, REAL_PNG);
    const response = await complete();

    expect(response.statusCode, response.body).toBe(200);
    const asset = JSON.parse(response.body) as { status: string; mimeType: string };
    expect(asset.status).toBe('PROCESSING');
    expect(asset.mimeType).toBe('image/png');
  });

  it('bloqueia HTML com script declarado como PNG', async () => {
    const malicioso = Buffer.from('<!DOCTYPE html><script>alert(document.cookie)</script>');
    const { assetId, complete } = await upload(session, malicioso);

    const response = await complete();
    expect(response.statusCode).toBe(400);
    expect((JSON.parse(response.body) as { code: string }).code).toBe('UNSUPPORTED_FILE_TYPE');

    // E os bytes somem do bucket: arquivo não identificado não fica guardado.
    await expect(storage.getObject(await keyOf(assetId))).rejects.toThrow();
  });

  it('bloqueia executável renomeado', async () => {
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(64)]);
    const { complete } = await upload(session, exe);
    expect((await complete()).statusCode).toBe(400);
  });

  it('corrige o tipo quando o declarado difere do real', async () => {
    // Declara JPEG, envia PNG: prevalece o conteúdo.
    const { complete } = await upload(session, REAL_PNG, 'image/jpeg');
    const asset = JSON.parse((await complete()).body) as { mimeType: string };
    expect(asset.mimeType).toBe('image/png');
  });

  it('recusa confirmar duas vezes o mesmo upload', async () => {
    const { complete } = await upload(session, REAL_PNG);
    expect((await complete()).statusCode).toBe(200);

    const second = await complete();
    expect(second.statusCode).toBe(409);
    expect((JSON.parse(second.body) as { code: string }).code).toBe('ASSET_ALREADY_COMPLETED');
  });

  it('recusa confirmar upload que nunca chegou ao bucket', async () => {
    const ticket = await call(session, 'POST', '/assets/upload-url', {
      projectId: session.projectId,
      filename: 'fantasma.png',
      contentType: 'image/png',
      sizeBytes: 100,
    });
    const { assetId } = JSON.parse(ticket.body) as { assetId: string };

    const response = await call(session, 'POST', '/assets/complete', { assetId });
    expect(response.statusCode).toBe(400);
    expect((JSON.parse(response.body) as { code: string }).code).toBe('UPLOAD_NOT_FOUND');
  });
});

describe('referências no SceneSpec', () => {
  it('recusa referência a asset de outro workspace', async () => {
    const dono = await setup('dono-asset');
    const intruso = await setup('intruso-asset');

    const { assetId, complete } = await upload(dono, REAL_PNG);
    await complete();

    // O intruso conhece o UUID e tenta usá-lo dentro do JSON, onde os guards não olham.
    const scene = await call(intruso, 'POST', `/projects/${intruso.projectId}/scenes`, {
      name: 'Cena com referência alheia',
    });
    const created = JSON.parse(scene.body) as { id: string; revision: number; sceneSpec: object };

    const response = await call(intruso, 'POST', `/projects/${intruso.projectId}/scenes`, {
      name: 'Tentativa',
      sceneSpec: {
        ...created.sceneSpec,
        references: [{ assetId, role: 'identity', weight: 0.9 }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect((JSON.parse(response.body) as { code: string }).code).toBe('REFERENCE_ASSET_NOT_FOUND');
  }, 120_000);

  it('aceita referência a asset do próprio workspace', async () => {
    const session = await setup('referencia-propria');
    const { assetId, complete } = await upload(session, REAL_PNG);
    await complete();

    const scene = await call(session, 'POST', `/projects/${session.projectId}/scenes`, {
      name: 'Base',
    });
    const created = JSON.parse(scene.body) as { id: string; revision: number; sceneSpec: object };

    const saved = await call(session, 'POST', `/projects/${session.projectId}/scenes`, {
      name: 'Com referência',
      sceneSpec: {
        ...created.sceneSpec,
        references: [{ assetId, role: 'identity', weight: 0.95, preserve: ['face'] }],
      },
    });

    expect(saved.statusCode, saved.body).toBe(201);
    const result = JSON.parse(saved.body) as {
      sceneSpec: { references: { assetId: string; role: string; weight: number }[] };
    };
    expect(result.sceneSpec.references[0]).toMatchObject({
      assetId,
      role: 'identity',
      weight: 0.95,
    });
  }, 120_000);
});

describe('isolamento e exclusão', () => {
  it('não lista nem lê asset de outro workspace', async () => {
    const dono = await setup('dono-lista');
    const intruso = await setup('intruso-lista');

    const { assetId, complete } = await upload(dono, REAL_PNG);
    await complete();

    expect((await call(intruso, 'GET', `/assets/${assetId}`)).statusCode).toBe(404);
    expect((await call(intruso, 'DELETE', `/assets/${assetId}`)).statusCode).toBe(404);
    expect((await call(intruso, 'GET', `/projects/${dono.projectId}/assets`)).statusCode).toBe(404);

    const minha = JSON.parse(
      (await call(dono, 'GET', `/projects/${dono.projectId}/assets`)).body,
    ) as {
      id: string;
    }[];
    expect(minha.map((a) => a.id)).toContain(assetId);
  }, 120_000);

  it('excluir apaga os bytes do bucket', async () => {
    const session = await setup('exclusao');
    const { assetId, complete } = await upload(session, REAL_PNG);
    await complete();

    const key = await keyOf(assetId);
    await expect(storage.getObject(key)).resolves.toBeInstanceOf(Buffer);

    expect((await call(session, 'DELETE', `/assets/${assetId}`)).statusCode).toBe(204);

    // Os bytes, que são o dado pessoal, somem de verdade.
    await expect(storage.getObject(key)).rejects.toThrow();
    expect((await call(session, 'GET', `/assets/${assetId}`)).statusCode).toBe(404);
  }, 120_000);
});
