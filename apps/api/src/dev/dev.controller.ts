import { Controller, Get, HttpStatus, Post } from '@nestjs/common';
import { generationEventsChannel } from '@waymage/domain';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/app-error';
import { env } from '../config/env';
import { RedisService } from '../infra/redis.service';
import { GenerationQueueService } from '../queue/generation-queue.service';

/**
 * Endpoints de smoke da Fase 1 — provam que API → fila → worker → provider → storage está
 * ligado, antes de existir autenticação, cena ou crédito.
 *
 * ponytail: código descartável. Sai na Fase 5, quando `POST /generation-jobs` fizer isso
 * de verdade, com SceneVersion, tenancy e reserva de créditos.
 */
@Controller('dev')
export class DevController {
  constructor(
    private readonly queue: GenerationQueueService,
    private readonly redis: RedisService,
  ) {
    if (env.NODE_ENV === 'production') {
      throw new Error('DevController não pode ser carregado em produção.');
    }
  }

  @Post('smoke-generation')
  async smoke(): Promise<{ generationJobId: string; eventsChannel: string }> {
    const generationJobId = randomUUID();
    await this.queue.enqueue({
      generationJobId,
      workspaceId: randomUUID(),
      requestId: `smoke_${generationJobId.slice(0, 8)}`,
    });
    return { generationJobId, eventsChannel: generationEventsChannel(generationJobId) };
  }

  @Get('queue')
  async counts(): Promise<Record<string, number>> {
    try {
      return await this.queue.counts();
    } catch {
      throw AppError.serviceUnavailable('QUEUE_UNAVAILABLE', 'Fila indisponível.');
    }
  }

  /** Últimos eventos publicados pelo worker, para inspeção manual do progresso. */
  @Get('events')
  async events(): Promise<{ events: unknown[] }> {
    const raw = await this.redis.client.lrange('generation:events:recent', 0, 19);
    return { events: raw.map((entry) => safeJson(entry)) };
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value, parseError: HttpStatus.UNPROCESSABLE_ENTITY };
  }
}
