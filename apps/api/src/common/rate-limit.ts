import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';

/**
 * Rate limit dos endpoints de autenticação.
 *
 * Só `/auth/*` por enquanto: é onde força bruta e enumeração de e-mail doem, e onde o custo
 * de cada request é alto (scrypt roda de propósito devagar). Limite de geração por workspace
 * entra na Fase 6, junto com os créditos, porque lá o eixo é dinheiro e não IP.
 *
 * Contador no Redis, não em memória: com mais de uma instância de API, um limite por processo
 * multiplica o teto real pelo número de réplicas.
 *
 * ponytail: janela fixa, não deslizante — o dobro do limite passa na virada da janela. Aceito
 * para travar força bruta; trocar por sliding window se virar problema medido.
 */
export interface RateLimitRule {
  /** Prefixo da rota, comparado com `startsWith`. */
  prefix: string;
  max: number;
  windowSeconds: number;
}

export const AUTH_RATE_LIMITS: RateLimitRule[] = [
  { prefix: '/auth/login', max: 10, windowSeconds: 300 },
  { prefix: '/auth/register', max: 5, windowSeconds: 3600 },
  { prefix: '/auth/refresh', max: 60, windowSeconds: 300 },
];

export function registerRateLimit(
  app: FastifyInstance,
  redis: Redis,
  rules: RateLimitRule[] = AUTH_RATE_LIMITS,
): void {
  app.addHook('onRequest', async (request, reply) => {
    const rule = rules.find((r) => request.url.startsWith(r.prefix));
    if (!rule) return;

    const window = Math.floor(Date.now() / 1000 / rule.windowSeconds);
    const key = `ratelimit:${rule.prefix}:${request.ip}:${window}`;

    let count: number;
    try {
      const [incr] = (await redis.multi().incr(key).expire(key, rule.windowSeconds).exec()) ?? [];
      count = Number(incr?.[1] ?? 0);
    } catch {
      // Redis fora do ar não pode derrubar o login. Falha aberta é a escolha certa aqui:
      // o dano de bloquear todo mundo é maior que o de deixar passar durante o incidente.
      return;
    }

    if (count > rule.max) {
      void reply.status(429).send({
        code: 'RATE_LIMITED',
        message: 'Muitas tentativas. Aguarde alguns minutos.',
        details: { retryAfterSeconds: rule.windowSeconds },
        requestId: String(request.id ?? ''),
      });
    }
  });
}
