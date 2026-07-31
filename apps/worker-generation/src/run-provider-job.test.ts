import {
  FAKE_PROVIDER_TRIGGERS,
  FakeImageProvider,
  ProviderError,
  type ProviderGenerationRequest,
} from '@waymage/provider-sdk';
import { describe, expect, it, vi } from 'vitest';
import { runProviderJob } from './run-provider-job';

/** Relógio virtual: `sleep` avança o tempo em vez de esperar. */
function virtualClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => (t += ms),
  };
}

/** Espera a rejeição e devolve o erro já tipado. */
async function rejection<T>(promise: Promise<T>): Promise<ProviderError> {
  return promise.then(
    () => {
      throw new Error('A promise deveria ter sido rejeitada.');
    },
    (error: unknown) => error as ProviderError,
  );
}

function request(overrides: Partial<ProviderGenerationRequest> = {}): ProviderGenerationRequest {
  return {
    requestId: 'req_1',
    prompt: 'cena de teste',
    references: [],
    aspectRatio: '1:1',
    format: 'png',
    count: 2,
    mode: 'draft',
    ...overrides,
  };
}

describe('runProviderJob', () => {
  it('acompanha até o sucesso e devolve as imagens', async () => {
    const c = virtualClock();
    const provider = new FakeImageProvider({ latencyMs: 500, now: c.now });

    const status = await runProviderJob(provider, request(), {
      timeoutMs: 10_000,
      pollIntervalMs: 100,
      sleep: c.sleep,
      now: c.now,
    });

    expect(status.state).toBe('succeeded');
    expect(status.images).toHaveLength(2);
  });

  it('reporta progresso crescente durante a espera', async () => {
    const c = virtualClock();
    const provider = new FakeImageProvider({ latencyMs: 500, now: c.now });
    const seen: number[] = [];

    await runProviderJob(provider, request(), {
      timeoutMs: 10_000,
      pollIntervalMs: 100,
      sleep: c.sleep,
      now: c.now,
      onProgress: (p) => void seen.push(p),
    });

    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it('desiste por timeout e cancela o job remoto', async () => {
    const c = virtualClock();
    const provider = new FakeImageProvider({ latencyMs: 100, now: c.now });
    const cancel = vi.spyOn(provider, 'cancel');

    const attempt = runProviderJob(provider, request({ prompt: FAKE_PROVIDER_TRIGGERS.timeout }), {
      timeoutMs: 1_000,
      pollIntervalMs: 200,
      sleep: c.sleep,
      now: c.now,
    });

    await expect(attempt).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', kind: 'timeout' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('classifica falha transitória como retentável e reembolsável', async () => {
    const c = virtualClock();
    const provider = new FakeImageProvider({ latencyMs: 0, now: c.now });

    const error = await rejection(
      runProviderJob(provider, request({ prompt: FAKE_PROVIDER_TRIGGERS.fail }), {
        timeoutMs: 5_000,
        pollIntervalMs: 100,
        sleep: c.sleep,
        now: c.now,
      }),
    );

    expect(error).toBeInstanceOf(ProviderError);
    expect(error.retryable).toBe(true);
    expect(error.refundable).toBe(true);
  });

  it('não reembolsa nem repete quando a rejeição é por política de conteúdo', async () => {
    const c = virtualClock();
    const provider = new FakeImageProvider({ latencyMs: 0, now: c.now });

    const error = await rejection(
      runProviderJob(provider, request({ prompt: FAKE_PROVIDER_TRIGGERS.blocked }), {
        timeoutMs: 5_000,
        pollIntervalMs: 100,
        sleep: c.sleep,
        now: c.now,
      }),
    );

    expect(error.kind).toBe('content_policy');
    expect(error.retryable).toBe(false);
    expect(error.refundable).toBe(false);
  });
});

describe('edição localizada', () => {
  it('submete por edit quando há imagem base, e não por generate', async () => {
    const provider = new FakeImageProvider({ latencyMs: 0 });
    const edit = vi.spyOn(provider, 'edit');
    const generate = vi.spyOn(provider, 'generate');
    const clock = virtualClock();

    const status = await runProviderJob(
      provider,
      {
        ...request({ count: 1, mode: 'edit' }),
        baseImageUrl: 'https://storage.test/base.png',
        maskUrl: 'https://storage.test/mask.png',
      },
      { timeoutMs: 5_000, pollIntervalMs: 100, sleep: clock.sleep, now: clock.now },
    );

    expect(edit).toHaveBeenCalledOnce();
    expect(generate).not.toHaveBeenCalled();
    expect(status.state).toBe('succeeded');
    expect(status.images).toHaveLength(1);
  });

  it('recusa a edição sem imagem base', async () => {
    const provider = new FakeImageProvider({ latencyMs: 0 });
    const clock = virtualClock();

    // `baseImageUrl` vazio chega aqui se o resultado de origem tiver perdido o asset: o
    // provedor precisa recusar em vez de gerar uma imagem nova do zero e cobrar por ela.
    const error = await rejection(
      runProviderJob(
        provider,
        { ...request({ count: 1, mode: 'edit' }), baseImageUrl: '' },
        { timeoutMs: 5_000, pollIntervalMs: 100, sleep: clock.sleep, now: clock.now },
      ),
    );

    expect(error.code).toBe('MISSING_BASE_IMAGE');
  });
});
