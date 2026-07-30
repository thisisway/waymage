import { generationEventsChannel, type GenerationEvent } from '@waymage/domain';
import type { Redis } from 'ioredis';

/**
 * Publica o progresso do job.
 *
 * O worker empurra por pub/sub em vez de a API ficar consultando o banco: polling a cada
 * segundo, por conexão SSE aberta, é carga desnecessária no Postgres.
 *
 * A lista `recent` existe só para inspeção manual em desenvolvimento — a API real assina
 * o canal do job. Sai junto com o DevController na Fase 5.
 */
const RECENT_EVENTS_KEY = 'generation:events:recent';
const RECENT_EVENTS_MAX = 50;

export class EventPublisher {
  constructor(
    private readonly redis: Redis,
    private readonly keepRecent: boolean,
  ) {}

  async publish(event: GenerationEvent): Promise<void> {
    const serialized = JSON.stringify(event);
    const pipeline = this.redis.pipeline();
    pipeline.publish(generationEventsChannel(event.generationJobId), serialized);
    if (this.keepRecent) {
      pipeline.lpush(RECENT_EVENTS_KEY, serialized);
      pipeline.ltrim(RECENT_EVENTS_KEY, 0, RECENT_EVENTS_MAX - 1);
    }
    await pipeline.exec();
  }
}
