import { describe, expect, it } from 'vitest';
import { FakeImageProvider } from './fake-provider';
import { ProviderRegistry } from './registry';
import { ModelRouter, ROUTING_WEIGHTS, type RoutingRequest } from './router';

/**
 * Dois perfis distintos, que é o mínimo para o roteador ter o que decidir.
 *
 * `rapido` é barato, rápido e completo. `estudio` custa quatro vezes mais, é lento, gera no
 * máximo duas imagens e não aceita negative prompt — mas é o único que entrega fundo
 * transparente. Cada diferença existe para exercitar uma dimensão da pontuação.
 */
function registry() {
  return new ProviderRegistry()
    .register(new FakeImageProvider({ id: 'rapido', latencyMs: 500, creditsPerImage: 1 }))
    .register(
      new FakeImageProvider({
        id: 'estudio',
        latencyMs: 4000,
        creditsPerImage: 4,
        capabilities: {
          transparentBackground: true,
          negativePrompt: false,
          maxOutputs: 2,
          maxReferenceImages: 2,
        },
      }),
    );
}

function request(overrides: Partial<RoutingRequest> = {}): RoutingRequest {
  return {
    operation: 'TEXT_TO_IMAGE',
    aspectRatio: '1:1',
    format: 'png',
    count: 1,
    mode: 'draft',
    referenceCount: 0,
    transparentBackground: false,
    needsSeed: false,
    needsNegativePrompt: false,
    ...overrides,
  };
}

describe('ModelRouter', () => {
  it('soma exatamente 1 nos pesos do blueprint', () => {
    const total = Object.values(ROUTING_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('prefere o mais barato e rápido quando os dois atendem', async () => {
    const ranked = await new ModelRouter(registry()).rank(request());

    expect(ranked.map((entry) => entry.provider)).toEqual(['rapido', 'estudio']);
    expect(ranked.every((entry) => entry.eligible)).toBe(true);
  });

  it('a qualidade percebida pode inverter a ordem', async () => {
    // O estudio perde em custo e latência; ganhar em qualidade por margem larga tem de ser
    // suficiente para virar a decisão, senão o peso de 0.25 não estaria fazendo nada.
    const ranked = await new ModelRouter(registry()).rank(request(), {
      quality: { rapido: 0.2, estudio: 1 },
    });

    expect(ranked[0]?.provider).toBe('estudio');
  });

  it('descarta quem não entrega fundo transparente, por melhor que seja', async () => {
    const ranked = await new ModelRouter(registry()).rank(
      request({ transparentBackground: true }),
      { quality: { rapido: 1, estudio: 0 } },
    );

    const rapido = ranked.find((entry) => entry.provider === 'rapido');
    expect(rapido?.eligible).toBe(false);
    expect(rapido?.notes.join(' ')).toContain('transparente');
    // Elegibilidade não é pontuação: o melhor avaliado não pode vencer sendo inviável.
    expect(ranked[0]?.provider).toBe('estudio');
  });

  it('descarta quem não gera a quantidade pedida', async () => {
    const ranked = await new ModelRouter(registry()).rank(request({ count: 4 }));

    expect(ranked.find((entry) => entry.provider === 'estudio')?.eligible).toBe(false);
    expect(ranked.find((entry) => entry.provider === 'estudio')?.notes.join(' ')).toContain(
      'no máximo 2 imagens',
    );
  });

  it('penaliza sem descartar quem não tem negative prompt', async () => {
    const ranked = await new ModelRouter(registry()).rank(
      request({ needsNegativePrompt: true }),
      {},
    );

    const estudio = ranked.find((entry) => entry.provider === 'estudio');
    expect(estudio?.eligible).toBe(true);
    expect(estudio?.breakdown.capability).toBeLessThan(1);
    expect(estudio?.notes.join(' ')).toContain('prompt principal');
  });

  it('desempata pela confiabilidade recente quando o resto é igual', async () => {
    const gemeos = new ProviderRegistry()
      .register(new FakeImageProvider({ id: 'estavel', latencyMs: 500, creditsPerImage: 1 }))
      .register(new FakeImageProvider({ id: 'instavel', latencyMs: 500, creditsPerImage: 1 }));

    const ranked = await new ModelRouter(gemeos).rank(request(), {
      reliability: { estavel: 1, instavel: 0.2 },
    });

    expect(ranked[0]?.provider).toBe('estavel');
  });

  it('confiabilidade sozinha não vira um pedido caro em barato', async () => {
    // Com peso 0.15, confiabilidade não compensa 4x de custo e 8x de latência — e não
    // deveria: uma falha isolada custa uma nova tentativa, não a diferença de preço.
    // Derrubar um provedor que falha sempre é papel de um disjuntor, não da pontuação.
    const ranked = await new ModelRouter(registry()).rank(request(), {
      reliability: { rapido: 0.1, estudio: 1 },
    });

    expect(ranked[0]?.provider).toBe('rapido');
    const rapido = ranked[0];
    const semQueda = await new ModelRouter(registry()).rank(request());
    expect(rapido?.score).toBeLessThan(semQueda[0]?.score ?? 0);
  });

  it('provedor indisponível sai da disputa', async () => {
    const ranked = await new ModelRouter(registry()).rank(request(), { unavailable: ['rapido'] });

    expect(ranked[0]?.provider).toBe('estudio');
    expect(ranked.find((entry) => entry.provider === 'rapido')?.notes).toContain('indisponível');
  });

  it('a ordem não depende da ordem de registro', async () => {
    const invertido = new ProviderRegistry()
      .register(new FakeImageProvider({ id: 'estudio', latencyMs: 500, creditsPerImage: 1 }))
      .register(new FakeImageProvider({ id: 'rapido', latencyMs: 500, creditsPerImage: 1 }));

    // Empate perfeito: sem desempate estável, a ordem viraria detalhe de inicialização e o
    // mesmo pedido escolheria provedores diferentes entre processos.
    const ranked = await new ModelRouter(invertido).rank(request());
    expect(ranked.map((entry) => entry.provider)).toEqual(['estudio', 'rapido']);
  });

  it('escolhe o melhor elegível', async () => {
    const provider = await new ModelRouter(registry()).choose(request({ count: 4 }));
    expect(provider.id).toBe('rapido');
  });

  it('explica quando ninguém atende', async () => {
    const router = new ModelRouter(registry());

    await expect(router.choose(request({ count: 99 }))).rejects.toThrow(/Nenhum provedor atende/);
  });

  it('registro vazio é erro, não escolha silenciosa', async () => {
    const router = new ModelRouter(new ProviderRegistry());

    await expect(router.rank(request())).rejects.toThrow(/Nenhum provedor registrado/);
  });
});
