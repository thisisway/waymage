import { FakeImageProvider } from './fake-provider';
import { ProviderRegistry } from './registry';

/**
 * Os provedores deste ambiente, num lugar só.
 *
 * A API estima e o worker executa; se cada um montasse a própria lista, a estimativa
 * mostraria um provedor e a geração usaria outro — e a diferença só apareceria na fatura.
 *
 * Continuam sendo dois perfis fake até haver autorização e chave de fornecedor real
 * (docs/DECISIONS.md D-011). O que muda entre eles é justamente o que o roteador pesa:
 * custo, latência, teto de saídas e capacidades.
 */

export const PROVIDER_IDS = {
  fast: 'fake-rapido',
  studio: 'fake-estudio',
} as const;

/**
 * Qualidade percebida por provedor, 0..1.
 *
 * Julgamento nosso sobre o fornecedor, não capacidade declarada por ele: muda quando o
 * fornecedor melhora ou piora, sem que o adapter mude uma linha.
 */
export const PROVIDER_QUALITY: Readonly<Record<string, number>> = {
  [PROVIDER_IDS.fast]: 0.55,
  [PROVIDER_IDS.studio]: 0.9,
};

export function createProviderRegistry(options: { latencyMs?: number } = {}): ProviderRegistry {
  const latency = options.latencyMs ?? 1200;

  return new ProviderRegistry()
    .register(
      new FakeImageProvider({ id: PROVIDER_IDS.fast, latencyMs: latency, creditsPerImage: 1 }),
    )
    .register(
      new FakeImageProvider({
        id: PROVIDER_IDS.studio,
        // Mais lento e mais caro, como todo provedor de qualidade superior.
        latencyMs: latency * 3,
        creditsPerImage: 3,
        capabilities: {
          transparentBackground: true,
          negativePrompt: false,
          maxOutputs: 4,
          maxReferenceImages: 4,
        },
      }),
    );
}
