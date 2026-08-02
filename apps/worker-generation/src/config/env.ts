import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/** Único ponto de leitura de `process.env` no worker. Falha no boot, não no primeiro job. */

const rootEnv = resolve(__dirname, '../../../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /**
   * Decifra as credenciais BYOK dos usuários. Precisa ser IDÊNTICA à da API — é ela que
   * cifrou. Valores diferentes fazem toda geração falhar ao abrir a chave.
   */
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .min(32, 'CREDENTIALS_ENCRYPTION_KEY precisa de ao menos 32 caracteres.'),

  FAKE_PROVIDER_LATENCY_MS: z.coerce.number().int().min(0).max(60_000).default(1200),

  /** Jobs processados em paralelo por instância de worker. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  /**
   * Processar imagem é limitado por CPU: concorrência alta só faz os jobs disputarem os
   * mesmos núcleos e deixa todos mais lentos.
   */
  ASSET_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  /** Teto de espera pelo provedor antes de desistir. */
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),

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
      `Configuração de ambiente inválida no worker:\n${detail}\n\nCopie .env.example para .env e preencha os valores.`,
    );
  }
  return result.data;
}

export const env: Env = load();
