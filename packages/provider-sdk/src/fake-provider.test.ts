import { describe, expect, it } from 'vitest';
import { ProviderError } from './errors';
import { FAKE_PROVIDER_TRIGGERS, FakeImageProvider } from './fake-provider';
import { ProviderRegistry } from './registry';
import type { ProviderGenerationRequest } from './types';

/** Relógio controlado: nenhum teste aqui pode depender de tempo real. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function request(overrides: Partial<ProviderGenerationRequest> = {}): ProviderGenerationRequest {
  return {
    requestId: 'req_1',
    prompt: 'retrato editorial em consultório',
    references: [],
    aspectRatio: '16:9',
    format: 'png',
    count: 4,
    mode: 'draft',
    ...overrides,
  };
}

describe('FakeImageProvider', () => {
  it('anuncia capabilities coerentes com o que entrega', () => {
    const caps = new FakeImageProvider().getCapabilities();
    expect(caps.textToImage).toBe(true);
    expect(caps.maskedEdit).toBe(true);
    expect(caps.supportedFormats).toContain('png');
    expect(caps.supportedAspectRatios).toContain('16:9');
    // Não sabe fazer transparência — a validação do SceneSpec precisa saber disso.
    expect(caps.transparentBackground).toBe(false);
  });

  it('progride de running para succeeded conforme a latência simulada', async () => {
    const c = clock();
    const provider = new FakeImageProvider({ latencyMs: 1000, now: c.now });
    const { providerJobId } = await provider.generate(request());

    const early = await provider.getStatus(providerJobId);
    expect(early.state).toBe('running');
    expect(early.progress).toBeLessThan(1);
    expect(early.images).toHaveLength(0);

    c.advance(400);
    expect((await provider.getStatus(providerJobId)).progress).toBeGreaterThan(early.progress);

    c.advance(1000);
    const done = await provider.getStatus(providerJobId);
    expect(done.state).toBe('succeeded');
    expect(done.progress).toBe(1);
    expect(done.latencyMs).toBe(1400);
  });

  it('produz a quantidade pedida de PNGs com as dimensões da proporção', async () => {
    const provider = new FakeImageProvider({ latencyMs: 0 });
    const { providerJobId } = await provider.generate(request({ count: 3, aspectRatio: '9:16' }));
    const { images } = await provider.getStatus(providerJobId);

    expect(images).toHaveLength(3);
    for (const image of images) {
      expect(image.mimeType).toBe('image/png');
      expect(image.width).toBe(360);
      expect(image.height).toBe(640);
      // Assinatura PNG — o arquivo precisa ser decodificável de verdade.
      expect(image.data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(image.data.length).toBeGreaterThan(100);
    }
  });

  it('é determinístico para a mesma seed e diferente entre variações', async () => {
    const provider = new FakeImageProvider({ latencyMs: 0 });
    const runOnce = async () => {
      const { providerJobId } = await provider.generate(request({ seed: 7, count: 2 }));
      return (await provider.getStatus(providerJobId)).images;
    };

    const [a, b] = [await runOnce(), await runOnce()];
    expect(a[0]?.data.equals(b[0]?.data as Buffer)).toBe(true);
    // Variações dentro do mesmo job precisam diferir, senão a grade fica inútil.
    expect(a[0]?.data.equals(a[1]?.data as Buffer)).toBe(false);
  });

  it('simula falha transitória pelo gatilho no prompt', async () => {
    const provider = new FakeImageProvider({ latencyMs: 0 });
    const { providerJobId } = await provider.generate(
      request({ prompt: `qualquer coisa ${FAKE_PROVIDER_TRIGGERS.fail}` }),
    );
    const status = await provider.getStatus(providerJobId);
    expect(status.state).toBe('failed');
    expect(status.errorCode).toBe('FAKE_TRANSIENT_FAILURE');
  });

  it('simula rejeição por política de conteúdo', async () => {
    const provider = new FakeImageProvider({ latencyMs: 0 });
    const { providerJobId } = await provider.generate(
      request({ prompt: FAKE_PROVIDER_TRIGGERS.blocked }),
    );
    expect((await provider.getStatus(providerJobId)).errorCode).toBe('CONTENT_POLICY');
  });

  it('simula timeout ficando preso em running', async () => {
    const c = clock();
    const provider = new FakeImageProvider({ latencyMs: 100, now: c.now });
    const { providerJobId } = await provider.generate(
      request({ prompt: FAKE_PROVIDER_TRIGGERS.timeout }),
    );
    c.advance(600_000);
    expect((await provider.getStatus(providerJobId)).state).toBe('running');
  });

  it('cancela um job em andamento', async () => {
    const provider = new FakeImageProvider({ latencyMs: 0 });
    const { providerJobId } = await provider.generate(request());
    await provider.cancel(providerJobId);
    expect((await provider.getStatus(providerJobId)).state).toBe('cancelled');
  });

  it('recusa contagem acima do limite do provedor', async () => {
    const provider = new FakeImageProvider();
    await expect(provider.generate(request({ count: 99 }))).rejects.toThrow(ProviderError);
  });

  it('recusa edição sem imagem base', async () => {
    const provider = new FakeImageProvider();
    await expect(provider.edit({ ...request(), baseImageUrl: '' })).rejects.toThrow(/imagem base/i);
  });

  it('reporta job desconhecido em vez de devolver estado inventado', async () => {
    await expect(new FakeImageProvider().getStatus('nao_existe')).rejects.toThrow(ProviderError);
  });

  it('estima mais créditos em qualidade final do que em rascunho', async () => {
    const provider = new FakeImageProvider();
    const draft = await provider.estimateCost(request({ mode: 'draft', count: 4 }));
    const final = await provider.estimateCost(request({ mode: 'final', count: 4 }));
    expect(final.credits).toBeGreaterThan(draft.credits);
    expect(draft.externalCostCents).toBe(0);
  });
});

describe('ProviderError', () => {
  it('classifica retry, fallback e devolução de crédito por tipo de falha', () => {
    const transient = new ProviderError('transient', 'X', 'x');
    expect([transient.retryable, transient.failoverable, transient.refundable]).toEqual([
      true,
      false,
      true,
    ]);

    const policy = new ProviderError('content_policy', 'X', 'x');
    expect([policy.retryable, policy.failoverable, policy.refundable]).toEqual([
      false,
      false,
      false,
    ]);

    const down = new ProviderError('unavailable', 'X', 'x');
    expect([down.retryable, down.failoverable, down.refundable]).toEqual([false, true, true]);
  });
});

describe('ProviderRegistry', () => {
  it('registra e recupera provedores', () => {
    const provider = new FakeImageProvider();
    const registry = new ProviderRegistry().register(provider);
    expect(registry.get('fake')).toBe(provider);
    expect(registry.ids()).toEqual(['fake']);
    expect(registry.has('outro')).toBe(false);
  });

  it('falha com mensagem útil ao pedir provedor inexistente', () => {
    const registry = new ProviderRegistry().register(new FakeImageProvider());
    expect(() => registry.get('midjourney')).toThrow(/Disponíveis: fake/);
  });
});

describe('gatilho direcionado', () => {
  it('derruba só o provedor nomeado', async () => {
    const alvo = new FakeImageProvider({ id: 'alvo', latencyMs: 0 });
    const outro = new FakeImageProvider({ id: 'outro', latencyMs: 0 });
    const prompt = 'cena qualquer [[fail:alvo]]';

    const base = {
      requestId: 'r',
      prompt,
      references: [],
      aspectRatio: '1:1',
      format: 'png',
      count: 1,
      mode: 'draft',
    } as const;

    const alvoJob = await alvo.generate(base);
    const outroJob = await outro.generate(base);

    expect((await alvo.getStatus(alvoJob.providerJobId)).state).toBe('failed');
    // Sem isto o fallback não teria como ser exercitado: os dois provedores falhariam pelo
    // mesmo prompt e nunca haveria recuperação para observar.
    expect((await outro.getStatus(outroJob.providerJobId)).state).toBe('succeeded');
  });
});
