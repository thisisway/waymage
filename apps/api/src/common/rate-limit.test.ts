import { describe, expect, it } from 'vitest';
import { AUTH_RATE_LIMITS, type RateLimitRule } from './rate-limit';

/** A mesma busca que o hook faz, isolada para poder ser exercitada sem Fastify nem Redis. */
function match(url: string, method: string, rules: RateLimitRule[] = AUTH_RATE_LIMITS) {
  return rules.find((r) => url.startsWith(r.prefix) && (!r.method || r.method === method));
}

describe('regras de rate limit', () => {
  it('limita a criação de geração', () => {
    expect(match('/generation-jobs', 'POST')?.max).toBe(60);
  });

  it('NÃO limita o acompanhamento da geração', () => {
    /**
     * A regressão que este teste existe para impedir.
     *
     * A tela consulta o job a cada três segundos enquanto ele roda (D-077). Um limite por
     * prefixo, sem método, derrubaria o acompanhamento de uma geração normal — e o sintoma
     * seria "a barra travou", exatamente o defeito que a consulta veio resolver.
     */
    expect(match('/generation-jobs/abc-123', 'GET')).toBeUndefined();
    expect(match('/generation-jobs/abc-123/events', 'GET')).toBeUndefined();
  });

  it('limita a emissão de URL de upload', () => {
    // Cada URL assinada é permissão de escrita no nosso bucket.
    expect(match('/assets/upload-url', 'POST')?.max).toBe(120);
    expect(match('/projects/x/assets', 'GET')).toBeUndefined();
  });

  it('mantém os limites de autenticação, que valem para qualquer método', () => {
    expect(match('/auth/login', 'POST')?.max).toBe(10);
    expect(match('/auth/register', 'POST')?.windowSeconds).toBe(3600);
  });

  it('não limita o resto da API', () => {
    for (const url of ['/projects', '/scenes/abc', '/health', '/provider-catalog']) {
      expect(match(url, 'GET'), url).toBeUndefined();
    }
  });
});
