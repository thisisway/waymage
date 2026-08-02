import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';

/**
 * Rate limit dos endpoints de autenticação.
 *
 * `/auth/*` cobre força bruta e enumeração de e-mail, onde cada request custa caro porque o
 * scrypt roda devagar de propósito.
 *
 * As outras regras cobrem o que gasta **recurso nosso**: cada URL de upload assinada permite
 * escrever no nosso bucket, e cada geração ocupa um worker. Não é sobre dinheiro do usuário —
 * a chave do fornecedor é dele (D-070) —, é sobre um visitante conseguir encher o storage ou
 * a fila de quem hospeda.
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
  /**
   * Método, quando a regra vale só para ele.
   *
   * Sem isto, um limite em `/generation-jobs` atingiria também o `GET` que a tela usa para
   * acompanhar o progresso — a consulta roda a cada três segundos, e o teto pensado para
   * criações derrubaria o acompanhamento de uma geração normal.
   */
  method?: string;
  max: number;
  windowSeconds: number;
}

export const AUTH_RATE_LIMITS: RateLimitRule[] = [
  { prefix: '/auth/login', max: 10, windowSeconds: 300 },
  { prefix: '/auth/register', max: 5, windowSeconds: 3600 },
  { prefix: '/auth/refresh', max: 60, windowSeconds: 300 },

  // Cada URL assinada é permissão de escrita no nosso bucket. Sem teto, um visitante enche o
  // storage de quem hospeda sem nunca completar um upload.
  { prefix: '/assets/upload-url', method: 'POST', max: 120, windowSeconds: 300 },

  // Criar geração ocupa um worker. `POST` apenas: o `GET` do mesmo prefixo é o acompanhamento.
  { prefix: '/generation-jobs', method: 'POST', max: 60, windowSeconds: 300 },
];

export function registerRateLimit(
  app: FastifyInstance,
  redis: Redis,
  rules: RateLimitRule[] = AUTH_RATE_LIMITS,
): void {
  app.addHook('onRequest', async (request, reply) => {
    const rule = rules.find(
      (r) => request.url.startsWith(r.prefix) && (!r.method || r.method === request.method),
    );
    if (!rule) return;

    const window = Math.floor(Date.now() / 1000 / rule.windowSeconds);
    // O método entra na chave: duas regras no mesmo prefixo não podem dividir o contador.
    const key = `ratelimit:${rule.method ?? 'ANY'}:${rule.prefix}:${request.ip}:${window}`;

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
