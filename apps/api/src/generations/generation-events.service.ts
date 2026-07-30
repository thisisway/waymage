import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { generationEventSchema, type GenerationEvent } from '@waymage/domain';
import { EventEmitter } from 'node:events';
import { Observable } from 'rxjs';
import { RedisService } from '../infra/redis.service';

const CHANNEL_PATTERN = 'generation:events:*';

/**
 * Ponte entre o pub/sub do Redis e as conexões SSE abertas.
 *
 * **Uma** conexão Redis para todo o processo, não uma por cliente conectado: uma conexão em
 * modo subscribe não aceita outros comandos, e abrir uma por aba do editor esgotaria o
 * limite de conexões do Redis com meia dúzia de usuários.
 *
 * O `psubscribe` recebe tudo e o fan-out acontece em memória, por `jobId`.
 */
@Injectable()
export class GenerationEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GenerationEventsService.name);
  private readonly emitter = new EventEmitter();
  private subscriber: ReturnType<RedisService['client']['duplicate']> | null = null;

  constructor(private readonly redis: RedisService) {
    // Cada SSE aberto adiciona um listener; o default de 10 do Node acusaria vazamento
    // falso com poucas abas abertas.
    this.emitter.setMaxListeners(0);
  }

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redis.client.duplicate();

    this.subscriber.on('pmessage', (_pattern: string, _channel: string, payload: string) => {
      const parsed = generationEventSchema.safeParse(safeJson(payload));
      // Evento malformado é descartado com log: derrubar o stream por causa de uma
      // mensagem ruim tiraria o progresso de todos os jobs do ar.
      if (!parsed.success) {
        this.logger.warn({ payload }, 'Evento de geração inválido, descartado');
        return;
      }
      this.emitter.emit(parsed.data.generationJobId, parsed.data);
    });

    await this.subscriber.psubscribe(CHANNEL_PATTERN);
    this.logger.log({ pattern: CHANNEL_PATTERN }, 'Assinando eventos de geração');
  }

  /** Observable dos eventos de um job. Cancelar a assinatura remove o listener. */
  stream(generationJobId: string): Observable<GenerationEvent> {
    return new Observable<GenerationEvent>((subscriber) => {
      const onEvent = (event: GenerationEvent) => {
        subscriber.next(event);
        // Estado terminal fecha o stream: manter a conexão aberta depois disso só consome
        // um socket de cada lado sem nunca mais enviar nada.
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(event.status)) subscriber.complete();
      };

      this.emitter.on(generationJobId, onEvent);
      return () => this.emitter.off(generationJobId, onEvent);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.emitter.removeAllListeners();
    if (this.subscriber) {
      await this.subscriber.punsubscribe(CHANNEL_PATTERN).catch(() => undefined);
      await this.subscriber.quit().catch(() => undefined);
    }
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
