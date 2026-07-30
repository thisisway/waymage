import { z } from 'zod';

/**
 * Contrato da fila entre `apps/api` (produtor) e `apps/worker-generation` (consumidor).
 *
 * Mora num package porque os dois lados precisam concordar sobre o formato; se cada um
 * declarasse o seu, um deploy parcial passaria a enfileirar payload que o outro não lê.
 * O schema Zod não é decoração: o worker valida o que tira da fila, porque a fila é uma
 * fronteira de confiança como qualquer outra.
 */

export const QUEUE_GENERATION = 'generation' as const;

/**
 * Fila separada da de geração de propósito: processar um upload leva segundos e é limitado
 * por CPU, enquanto uma geração leva minutos e fica esperando o provedor. Na mesma fila, um
 * lote de uploads seguraria as gerações atrás dele.
 */
export const QUEUE_ASSETS = 'assets' as const;

export const QUEUE_NAMES = [QUEUE_GENERATION, QUEUE_ASSETS] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export const assetJobPayloadSchema = z.object({
  assetId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  requestId: z.string().min(1),
});

export type AssetJobPayload = z.infer<typeof assetJobPayloadSchema>;

export const generationJobPayloadSchema = z.object({
  /** Id do GenerationJob no banco — a fila carrega referência, nunca o estado. */
  generationJobId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  /** Propagado para logs e eventos SSE. */
  requestId: z.string().min(1),
});

export type GenerationJobPayload = z.infer<typeof generationJobPayloadSchema>;

/**
 * Canal Redis pub/sub por onde o worker devolve progresso para a API, que reemite por SSE.
 * A API não faz polling no banco para descobrir que o job andou.
 */
export function generationEventsChannel(generationJobId: string): string {
  return `generation:events:${generationJobId}`;
}

export const generationEventSchema = z.object({
  generationJobId: z.string().uuid(),
  status: z.string(),
  /** 0..1. */
  progress: z.number().min(0).max(1),
  message: z.string().optional(),
  at: z.string().datetime(),
});

export type GenerationEvent = z.infer<typeof generationEventSchema>;
