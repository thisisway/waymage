import { generationEventsChannel, type GenerationEvent } from '@waymage/domain';
import type { Redis } from 'ioredis';

/**
 * Publica o progresso do job.
 *
 * O worker empurra por pub/sub em vez de a API ficar consultando o banco: polling a cada
 * segundo, por conexão SSE aberta, é carga desnecessária no Postgres.
 *
 * Pub/sub não guarda histórico — quem não estava ouvindo perde o evento. É aceitável porque
 * o estado autoritativo está no banco: ao abrir o stream, a API envia o estado atual antes
 * de repassar o que vier depois.
 */
export class EventPublisher {
  constructor(private readonly redis: Redis) {}

  async publish(event: GenerationEvent): Promise<void> {
    await this.redis.publish(generationEventsChannel(event.generationJobId), JSON.stringify(event));
  }
}
