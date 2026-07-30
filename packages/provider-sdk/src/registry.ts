import { ProviderError } from './errors';
import type { ImageProvider } from './types';

/**
 * Registro de provedores disponíveis no processo.
 *
 * O ModelRouter (Fase 9) consulta este registro para escolher; hoje só existe o fake.
 * Deliberadamente burro: sem scoring, sem fallback, sem health check — isso é problema
 * do router, não do registro.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, ImageProvider>();

  register(provider: ImageProvider): this {
    this.providers.set(provider.id, provider);
    return this;
  }

  get(id: string): ImageProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new ProviderError(
        'invalid_request',
        'UNKNOWN_PROVIDER',
        `Provedor não registrado: "${id}". Disponíveis: ${this.ids().join(', ') || 'nenhum'}.`,
      );
    }
    return provider;
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  ids(): string[] {
    return [...this.providers.keys()];
  }

  all(): ImageProvider[] {
    return [...this.providers.values()];
  }
}
