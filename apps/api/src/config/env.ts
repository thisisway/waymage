import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Único lugar do processo autorizado a ler `process.env`.
 *
 * Falha no boot, não no primeiro request: variável faltando derruba a API imediatamente
 * com uma mensagem que diz qual é. Descobrir configuração errada em produção às 3h da
 * manhã, por 500 intermitente, é o cenário que isso evita.
 */

// O .env fica na raiz do monorepo — os três processos compartilham a mesma configuração.
const rootEnv = resolve(__dirname, '../../../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  APP_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório.'),
  REDIS_URL: z.string().min(1, 'REDIS_URL é obrigatório.'),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Segredo de assinatura do access token. Mínimo de 32 caracteres: chave curta em HMAC é
  // forçável offline, e o token assinado é o que autoriza toda a API.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET precisa de ao menos 32 caracteres.'),

  /**
   * `SameSite` dos cookies de sessão.
   *
   * `lax` serve quando web e API compartilham o site registrável (`app.dominio.com` e
   * `api.dominio.com`). Use `none` quando não compartilham — inclusive nos domínios padrão
   * do EasyPanel, porque `easypanel.host` está na Public Suffix List e cada subdomínio conta
   * como um site distinto. `none` exige HTTPS nas duas pontas.
   */
  COOKIE_SAMESITE: z.enum(['lax', 'none']).default('lax'),

  /** Necessário atrás de reverse proxy, senão todo request parece vir do IP do proxy. */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  · ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Configuração de ambiente inválida:\n${detail}\n\nCopie .env.example para .env e preencha os valores.`,
    );
  }
  return result.data;
}

export const env: Env = load();
