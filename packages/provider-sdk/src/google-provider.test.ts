import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from './errors';
import { GOOGLE_MODELS, GoogleImageProvider } from './google-provider';
import { encodePng } from './png';
import type { ProviderGenerationRequest } from './types';

/**
 * O adapter é exercitado contra um `fetch` de mentira.
 *
 * Nenhum teste aqui chama o Google: um teste que precisa de chave paga não roda em CI, e
 * cobrar do usuário para verificar o nosso código seria o pior arranjo possível. O que está
 * sob teste é a tradução — o que enviamos, o que lemos da resposta, e como classificamos
 * cada falha.
 */

const PNG = encodePng(64, 32, () => [10, 20, 30] as const);

function ok(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function imageResponse(): Response {
  return ok({
    steps: [
      {
        type: 'model_output',
        content: [{ type: 'image', mime_type: 'image/png', data: PNG.toString('base64') }],
      },
    ],
  });
}

function request(overrides: Partial<ProviderGenerationRequest> = {}): ProviderGenerationRequest {
  return {
    requestId: 'r',
    prompt: 'uma xícara de café',
    references: [],
    aspectRatio: '1:1',
    format: 'png',
    count: 1,
    mode: 'draft',
    ...overrides,
  };
}

/** Espera o job sair de `running`. */
async function settle(provider: GoogleImageProvider, id: string) {
  for (let i = 0; i < 50; i++) {
    const status = await provider.getStatus(id);
    if (status.state !== 'running') return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('job não terminou');
}

describe('GoogleImageProvider', () => {
  it('manda a chave no header, nunca na URL', async () => {
    const fetchImpl = vi.fn(async () => imageResponse());
    const provider = new GoogleImageProvider({ apiKey: 'AIzaSy-secreta', fetchImpl });

    const handle = await provider.generate(request());
    await settle(provider, handle.providerJobId);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    // Chave em query string vaza em log de proxy e em histórico de navegador.
    expect(url).not.toContain('AIzaSy');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIzaSy-secreta');
  });

  it('envia prompt, proporção e formato', async () => {
    const fetchImpl = vi.fn(async () => imageResponse());
    const provider = new GoogleImageProvider({ apiKey: 'k', fetchImpl });

    const handle = await provider.generate(request({ aspectRatio: '16:9', format: 'webp' }));
    await settle(provider, handle.providerJobId);

    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    ) as {
      model: string;
      input: { type: string; text?: string }[];
      response_format: Record<string, string>;
    };

    expect(body.model).toBe(GOOGLE_MODELS.flash.name);
    expect(body.input[0]).toEqual({ type: 'text', text: 'uma xícara de café' });
    expect(body.response_format.aspect_ratio).toBe('16:9');
    // JPEG mesmo com a cena pedindo WEBP: a API recusa qualquer outro valor, e a conversão
    // para o formato escolhido acontece na exportação. Mandar `image/png` daqui derrubou a
    // primeira geração real com HTTP 400.
    expect(body.response_format.mime_type).toBe('image/jpeg');
  });

  it('uma requisição por imagem pedida', async () => {
    const fetchImpl = vi.fn(async () => imageResponse());
    const provider = new GoogleImageProvider({ apiKey: 'k', fetchImpl });

    const handle = await provider.generate(request({ count: 3 }));
    const status = await settle(provider, handle.providerJobId);

    // A API devolve uma imagem por chamada. Cada uma é uma cobrança na conta do usuário —
    // por isso o teto de saídas é baixo.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(status.images).toHaveLength(3);
  });

  it('lê a imagem e as dimensões da resposta', async () => {
    const provider = new GoogleImageProvider({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => imageResponse()),
    });

    const handle = await provider.generate(request());
    const status = await settle(provider, handle.providerJobId);

    expect(status.state).toBe('succeeded');
    expect(status.images[0]?.data.length).toBe(PNG.length);
    expect(status.images[0]?.width).toBe(64);
    expect(status.images[0]?.height).toBe(32);
  });

  it('trata 200 sem imagem como recusa de conteúdo', async () => {
    const provider = new GoogleImageProvider({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => ok({ steps: [{ content: [{ type: 'text' }] }] })),
    });

    const handle = await provider.generate(request());
    const status = await settle(provider, handle.providerJobId);

    // Sucesso sem imagem é o formato em que o fornecedor devolve uma recusa. Tratar como
    // êxito entregaria um job concluído com zero resultados.
    expect(status.state).toBe('failed');
    expect(status.errorCode).toBe('NO_IMAGE_RETURNED');
  });

  it('classifica as falhas pelo que o orquestrador precisa decidir', async () => {
    const cases: [number, string, boolean][] = [
      // status, código esperado, vale tentar outro provedor
      [401, 'GOOGLE_AUTH_FAILED', false],
      [429, 'GOOGLE_RATE_LIMITED', true],
      [503, 'GOOGLE_UNAVAILABLE', true],
      [400, 'GOOGLE_REJECTED_REQUEST', false],
    ];

    for (const [status, code, failover] of cases) {
      const provider = new GoogleImageProvider({
        apiKey: 'k',
        fetchImpl: vi.fn(async () => new Response('erro', { status })),
      });

      const handle = await provider.generate(request());
      const result = await settle(provider, handle.providerJobId);

      expect(result.errorCode, String(status)).toBe(code);

      // Chave inválida não melhora com retry nem trocando de fornecedor: insistir só gasta
      // tempo de quem já tem um problema na conta para resolver.
      const error = new ProviderError(
        status === 401
          ? 'auth'
          : status === 429
            ? 'quota'
            : status >= 500
              ? 'unavailable'
              : 'invalid_request',
        code,
        '',
      );
      expect(error.shouldTryNextProvider, String(status)).toBe(failover);
    }
  });

  it('não vaza a chave na mensagem de erro', async () => {
    const provider = new GoogleImageProvider({
      apiKey: 'AIzaSy-nao-pode-aparecer',
      fetchImpl: vi.fn(async () => new Response('detalhe do fornecedor', { status: 400 })),
    });

    const handle = await provider.generate(request());
    const status = await settle(provider, handle.providerJobId);

    expect(status.errorMessage).not.toContain('AIzaSy');
  });

  it('recusa mais saídas do que o teto', async () => {
    const provider = new GoogleImageProvider({ apiKey: 'k', fetchImpl: vi.fn() });

    await expect(provider.generate(request({ count: 9 }))).rejects.toBeInstanceOf(ProviderError);
    // Recusa na submissão, sem gastar chamada: descobrir isso depois seria pagar para errar.
    expect(vi.mocked(provider['fetchImpl'] as never)).toBeDefined();
  });

  it('a edição manda a original, a máscara e o que cada uma significa', async () => {
    const fetchImpl = vi.fn(async (input: unknown, _init?: unknown) =>
      String(input).startsWith('https://storage')
        ? new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
        : imageResponse(),
    );
    const provider = new GoogleImageProvider({ apiKey: 'k', fetchImpl });

    const handle = await provider.edit({
      ...request({ mode: 'edit' }),
      baseImageUrl: 'https://storage.test/base.png',
      maskUrl: 'https://storage.test/mask.png',
    });
    await settle(provider, handle.providerJobId);

    const call = fetchImpl.mock.calls.find(([url]) =>
      String(url).includes('generativelanguage'),
    ) as [unknown, RequestInit] | undefined;
    const body = JSON.parse(String(call?.[1].body)) as {
      input: { type: string; text?: string }[];
    };

    const texts = body.input.filter((part) => part.type === 'text').map((part) => part.text);
    // Sem dizer o que a máscara é, o modelo a trata como mais uma referência de estilo.
    expect(texts.join(' ')).toContain('original');
    expect(texts.join(' ')).toContain('máscara');
    expect(body.input.filter((part) => part.type === 'image')).toHaveLength(2);
  });

  it('a máscara invertida muda a instrução, não a imagem', async () => {
    const fetchImpl = vi.fn(async (input: unknown, _init?: unknown) =>
      String(input).startsWith('https://storage')
        ? new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
        : imageResponse(),
    );
    const provider = new GoogleImageProvider({ apiKey: 'k', fetchImpl });

    const handle = await provider.edit({
      ...request({ mode: 'edit' }),
      baseImageUrl: 'https://storage.test/base.png',
      maskUrl: 'https://storage.test/mask.png',
      maskInverted: true,
    });
    await settle(provider, handle.providerJobId);

    const call = fetchImpl.mock.calls.find(([url]) =>
      String(url).includes('generativelanguage'),
    ) as [unknown, RequestInit] | undefined;
    const body = JSON.parse(String(call?.[1].body)) as {
      input: { type: string; text?: string }[];
    };

    expect(body.input.some((part) => part.text?.includes('preserve o que está em branco'))).toBe(
      true,
    );
  });

  it('custo é relativo, não preço', async () => {
    const barato = new GoogleImageProvider({ apiKey: 'k', model: GOOGLE_MODELS.flashLite });
    const caro = new GoogleImageProvider({ apiKey: 'k', model: GOOGLE_MODELS.pro });

    const a = await barato.estimateCost(request());
    const b = await caro.estimateCost(request());

    expect(b.credits).toBeGreaterThan(a.credits);
    // Zero, e não um palpite: exibir uma previsão de fatura inventada seria pior que não
    // exibir nenhuma.
    expect(a.externalCostCents).toBe(0);
  });
});

describe('dimensões', () => {
  it('lê o tamanho de um JPEG', async () => {
    // A API só devolve JPEG, então este é o caminho normal — não o excepcional. Um leitor que
    // só entendesse PNG deixaria toda geração real com dimensão zero.
    const jpeg = await sharp({
      create: { width: 640, height: 360, channels: 3, background: '#334455' },
    })
      .jpeg()
      .toBuffer();

    const provider = new GoogleImageProvider({
      apiKey: 'k',
      fetchImpl: vi.fn(async () =>
        ok({
          steps: [
            {
              content: [{ type: 'image', mime_type: 'image/jpeg', data: jpeg.toString('base64') }],
            },
          ],
        }),
      ),
    });

    const handle = await provider.generate(request());
    const status = await settle(provider, handle.providerJobId);

    expect(status.images[0]?.width).toBe(640);
    expect(status.images[0]?.height).toBe(360);
  });
});
