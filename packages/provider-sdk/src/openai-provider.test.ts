import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from './errors';
import { OPENAI_MODELS, OpenAIImageProvider } from './openai-provider';
import { encodePng } from './png';
import type { ProviderGenerationRequest } from './types';

/**
 * Exercitado contra um `fetch` de mentira, como o adapter do Google.
 *
 * Nenhuma chamada real: um teste que precisa de chave paga não roda em CI. O que está sob
 * teste é a tradução — o que enviamos, como lemos, e como classificamos cada falha.
 */

const B64 = encodePng(48, 24, () => [200, 100, 50] as const).toString('base64');

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const imagesResponse = (n = 1) =>
  ok({ data: Array.from({ length: n }, () => ({ b64_json: B64 })) });

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

async function settle(provider: OpenAIImageProvider, id: string) {
  for (let i = 0; i < 50; i++) {
    const status = await provider.getStatus(id);
    if (status.state !== 'running') return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('job não terminou');
}

describe('OpenAIImageProvider', () => {
  it('declara só as proporções que a API produz', () => {
    const caps = new OpenAIImageProvider({ apiKey: 'k' }).getCapabilities();

    // Três tamanhos, três proporções. As outras sete do SceneSpec ficam com outro provedor, e
    // o roteador descarta este sozinho quando a cena pede uma delas.
    expect([...caps.supportedAspectRatios].sort()).toEqual(['1:1', '2:3', '3:2']);
    expect(caps.supportedAspectRatios).not.toContain('16:9');
  });

  it('pede máscara por transparência, não por luminância', () => {
    // É a razão de este adapter existir: aqui a máscara é usada COMO máscara.
    expect(new OpenAIImageProvider({ apiKey: 'k' }).getCapabilities().maskEncoding).toBe('alpha');
  });

  it('manda a chave no header, nunca na URL', async () => {
    const fetchImpl = vi.fn(async () => imagesResponse());
    const provider = new OpenAIImageProvider({ apiKey: 'sk-secreta', fetchImpl });

    const handle = await provider.generate(request());
    await settle(provider, handle.providerJobId);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('sk-secreta');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-secreta');
  });

  it('traduz proporção em tamanho e respeita o formato pedido', async () => {
    const fetchImpl = vi.fn(async () => imagesResponse());
    const provider = new OpenAIImageProvider({ apiKey: 'k', fetchImpl });

    const handle = await provider.generate(request({ aspectRatio: '3:2', format: 'webp' }));
    await settle(provider, handle.providerJobId);

    const body = JSON.parse(
      String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    ) as Record<string, unknown>;

    expect(body.size).toBe('1536x1024');
    // Diferente do Gemini, aqui o formato da cena é honrado pelo próprio fornecedor.
    expect(body.output_format).toBe('webp');
    expect(body.model).toBe(OPENAI_MODELS.standard.name);
  });

  it('pede as imagens numa chamada só', async () => {
    const fetchImpl = vi.fn(async () => imagesResponse(4));
    const provider = new OpenAIImageProvider({ apiKey: 'k', fetchImpl });

    const handle = await provider.generate(request({ count: 4 }));
    const status = await settle(provider, handle.providerJobId);

    // Quatro imagens são quatro requisições no Gemini; aqui, uma.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(status.images).toHaveLength(4);
  });

  it('a edição vai por multipart, com imagem e máscara', async () => {
    const fetchImpl = vi.fn(async (input: unknown) =>
      String(input).includes('api.openai.com')
        ? imagesResponse()
        : new Response(Buffer.from('bytes'), {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
    );
    const provider = new OpenAIImageProvider({ apiKey: 'k', fetchImpl });

    const handle = await provider.edit({
      ...request({ mode: 'edit' }),
      baseImageUrl: 'https://storage.test/base.png',
      maskUrl: 'https://storage.test/mask.png',
    });
    await settle(provider, handle.providerJobId);

    const call = fetchImpl.mock.calls.find(([url]) => String(url).includes('/images/edits')) as
      [unknown, RequestInit] | undefined;
    const form = call?.[1].body as FormData;

    expect(form).toBeInstanceOf(FormData);
    expect(form.get('image')).toBeInstanceOf(File);
    expect(form.get('mask')).toBeInstanceOf(File);
    expect(form.get('prompt')).toBe('uma xícara de café');
  });

  it('classifica as falhas pelo que o orquestrador decide', async () => {
    for (const [status, code] of [
      [401, 'OPENAI_AUTH_FAILED'],
      [429, 'OPENAI_RATE_LIMITED'],
      [503, 'OPENAI_UNAVAILABLE'],
      [400, 'OPENAI_REJECTED_REQUEST'],
    ] as [number, string][]) {
      const provider = new OpenAIImageProvider({
        apiKey: 'k',
        fetchImpl: vi.fn(
          async () =>
            new Response(JSON.stringify({ error: { message: 'detalhe do fornecedor' } }), {
              status,
            }),
        ),
      });

      const handle = await provider.generate(request());
      expect((await settle(provider, handle.providerJobId)).errorCode, String(status)).toBe(code);
    }
  });

  it('não vaza a chave na mensagem de erro', async () => {
    const provider = new OpenAIImageProvider({
      apiKey: 'sk-nao-pode-aparecer',
      fetchImpl: vi.fn(async () => new Response('erro', { status: 400 })),
    });

    const handle = await provider.generate(request());
    expect((await settle(provider, handle.providerJobId)).errorMessage).not.toContain('sk-');
  });

  it('resposta sem imagem é recusa de conteúdo, não sucesso vazio', async () => {
    const provider = new OpenAIImageProvider({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => ok({ data: [] })),
    });

    const handle = await provider.generate(request());
    const status = await settle(provider, handle.providerJobId);

    expect(status.state).toBe('failed');
    expect(status.errorCode).toBe('NO_IMAGE_RETURNED');
  });

  it('recusa mais saídas do que o teto', async () => {
    const provider = new OpenAIImageProvider({ apiKey: 'k', fetchImpl: vi.fn() });

    await expect(provider.generate(request({ count: 9 }))).rejects.toBeInstanceOf(ProviderError);
  });
});
