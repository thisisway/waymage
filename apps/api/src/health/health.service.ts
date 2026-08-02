import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { AppStorageService } from '../infra/storage.service';
import { GenerationQueueService } from '../queue/generation-queue.service';

export type DependencyState = 'ok' | 'down';

export interface DependencyCheck {
  name: string;
  state: DependencyState;
  latencyMs: number;
  /** Motivo resumido da falha. Nunca inclui credencial nem host completo. */
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  dependencies: DependencyCheck[];
  /**
   * Profundidade da fila de geração.
   *
   * Não entra em `dependencies` de propósito: fila cheia não é dependência fora do ar, e
   * marcar o serviço como degradado por causa dela faria o EasyPanel reiniciar uma API
   * saudável enquanto o worker é que está ausente.
   *
   * É informação de diagnóstico: `waiting` alto com `active` em zero significa que ninguém
   * está consumindo.
   */
  queue: { waiting: number; active: number; failed: number } | null;
}

/**
 * Health real: toca Postgres, Redis e S3 de verdade (docs/DECISIONS.md D-012).
 * Um 200 fixo só provaria que o processo subiu.
 */
@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: AppStorageService,
    private readonly generations: GenerationQueueService,
  ) {}

  async check(): Promise<HealthReport> {
    const dependencies = await Promise.all([
      probe('postgres', () => this.prisma.ping()),
      probe('redis', () => this.redis.ping()),
      probe('storage', () => this.storage.ping()),
    ]);

    // Falha ao ler a fila não derruba o health: o Redis já tem sonda própria, e um erro aqui
    // apagaria o relatório inteiro por causa da parte menos crítica dele.
    const queue = await this.generations.depth().catch(() => null);

    return {
      status: dependencies.every((d) => d.state === 'ok') ? 'ok' : 'degraded',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      dependencies,
      queue,
    };
  }
}

async function probe(name: string, fn: () => Promise<unknown>): Promise<DependencyCheck> {
  const startedAt = Date.now();
  try {
    await fn();
    return { name, state: 'ok', latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      name,
      state: 'down',
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.name : 'UnknownError',
    };
  }
}
