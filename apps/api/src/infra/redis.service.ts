import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { env } from '../config/env';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  /**
   * `maxRetriesPerRequest: null` é exigido pelo BullMQ — sem isso a conexão do worker
   * derruba comandos bloqueantes durante uma reconexão.
   */
  readonly client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  async ping(): Promise<void> {
    const reply = await this.client.ping();
    if (reply !== 'PONG') throw new Error(`Resposta inesperada do Redis: ${reply}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
    this.logger.log('Conexão com Redis encerrada.');
  }
}
