import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { AppStorageService } from '../infra/storage.service';

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
  ) {}

  async check(): Promise<HealthReport> {
    const dependencies = await Promise.all([
      probe('postgres', () => this.prisma.ping()),
      probe('redis', () => this.redis.ping()),
      probe('storage', () => this.storage.ping()),
    ]);

    return {
      status: dependencies.every((d) => d.state === 'ok') ? 'ok' : 'degraded',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      dependencies,
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
