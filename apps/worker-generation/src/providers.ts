import { FakeImageProvider, ProviderRegistry, type ImageProvider } from '@waymage/provider-sdk';
import { env } from './config/env';

/**
 * Provedores disponíveis neste worker.
 *
 * Só o fake até a Fase 9 (docs/DECISIONS.md D-011). Adapters reais entram aqui — e apenas
 * aqui: o resto do worker fala com `ImageProvider`, nunca com um SDK.
 */
export const providerRegistry = new ProviderRegistry().register(
  new FakeImageProvider({ latencyMs: env.FAKE_PROVIDER_LATENCY_MS }),
);

/**
 * Escolhe o provedor. O ModelRouter com scoring entra na Fase 9; hoje é o default do
 * ambiente, e `auto` resolve para ele.
 */
export function resolveProvider(strategy: string = 'auto'): ImageProvider {
  return providerRegistry.get(strategy === 'auto' ? env.IMAGE_PROVIDER_DEFAULT : strategy);
}
