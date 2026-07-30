import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { WorkspaceRole } from '@waymage/database';
import { isTerminal, STATE_LABELS, STATE_PROGRESS, type GenerationState } from '@waymage/domain';
import type { FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { RequireRole } from '../auth/auth.guard';
import { Principal, type AuthenticatedRequest, type RequestPrincipal } from '../auth/request-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { GenerationEventsService } from './generation-events.service';
import {
  createGenerationSchema,
  estimateSchema,
  type CreateGenerationInput,
  type EstimateInput,
} from './generations.schemas';
import {
  GenerationsService,
  type EstimateView,
  type GenerationJobView,
  type GenerationResultView,
} from './generations.service';

@Controller()
export class GenerationsController {
  constructor(
    private readonly generations: GenerationsService,
    private readonly eventStream: GenerationEventsService,
  ) {}

  /** Prévia: custo, provedor, resumo e conflitos, antes de gerar. */
  @Post('generation-jobs/estimate')
  @HttpCode(HttpStatus.OK)
  estimate(
    @Principal() principal: RequestPrincipal,
    @Body(new ZodValidationPipe(estimateSchema)) body: EstimateInput,
  ): Promise<EstimateView> {
    return this.generations.estimate(principal, body);
  }

  /**
   * Cria a geração.
   *
   * `Idempotency-Key` evita que duplo clique ou retry de rede virem duas cobranças. Se o
   * cliente não mandar, geramos uma — o que ainda protege contra o retry automático do
   * fetch, embora não contra o duplo clique.
   */
  @Post('generation-jobs')
  @RequireRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Principal() principal: RequestPrincipal,
    @Body(new ZodValidationPipe(createGenerationSchema)) body: CreateGenerationInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<GenerationJobView> {
    return this.generations.create(
      principal,
      body,
      idempotencyKey?.trim() || randomUUID(),
      requestId(request),
    );
  }

  @Get('generation-jobs/:jobId')
  get(
    @Principal() principal: RequestPrincipal,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ): Promise<GenerationJobView> {
    return this.generations.get(principal, jobId);
  }

  @Get('scenes/:sceneId/generation-jobs')
  listForScene(
    @Principal() principal: RequestPrincipal,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
  ): Promise<GenerationJobView[]> {
    return this.generations.listForScene(principal, sceneId);
  }

  @Post('generation-jobs/:jobId/cancel')
  @RequireRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  cancel(
    @Principal() principal: RequestPrincipal,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<GenerationJobView> {
    return this.generations.cancel(principal, jobId, requestId(request));
  }

  @Post('generation-results/:resultId/select')
  @RequireRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  select(
    @Principal() principal: RequestPrincipal,
    @Param('resultId', ParseUUIDPipe) resultId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<GenerationResultView> {
    return this.generations.select(principal, resultId, requestId(request));
  }

  /**
   * Progresso em tempo real.
   *
   * SSE e não WebSocket: o fluxo é de mão única e o navegador reconecta sozinho. A
   * autenticação funciona porque `EventSource` envia cookies — não seria possível com header
   * `Authorization`, que a API deliberadamente não usa.
   *
   * Escrito na resposta crua, e não com `@Sse()`, por dois motivos: o tenancy é confirmado
   * **antes** de qualquer header sair (senão o 404 viraria 200 com corpo de erro), e o
   * heartbeat abaixo precisa de acesso direto ao socket.
   */
  @Get('generation-jobs/:jobId/events')
  async events(
    @Principal() principal: RequestPrincipal,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Antes de escrever qualquer byte: sem isto, bastaria adivinhar um UUID para acompanhar
    // a geração de outro workspace.
    const job = await this.generations.get(principal, jobId);

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Desliga o buffer do nginx; sem isso o proxy segura os eventos e o progresso chega
      // todo de uma vez, no fim.
      'x-accel-buffering': 'no',
    });

    // Formato SSE: `data: <json>` seguido de linha em branco, que é o que delimita o evento.
    const send = (data: unknown) => {
      if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Estado atual primeiro: quem conecta com o job já em andamento veria a barra parada
    // até a próxima transição.
    send({
      generationJobId: job.id,
      status: job.status,
      statusLabel: STATE_LABELS[job.status],
      progress: STATE_PROGRESS[job.status],
      message: null,
      at: new Date().toISOString(),
    });

    if (isTerminal(job.status)) {
      reply.raw.end();
      return;
    }

    // Comentário SSE a cada 20s. Proxies derrubam conexão ociosa, e uma geração pode passar
    // minutos entre transições.
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': keep-alive\n\n');
    }, 20_000);

    const subscription = this.eventStream.stream(jobId).subscribe({
      next: (event) =>
        send({
          generationJobId: event.generationJobId,
          status: event.status,
          statusLabel: STATE_LABELS[event.status as GenerationState] ?? event.status,
          progress: event.progress,
          message: event.message ?? null,
          at: event.at,
        }),
      complete: () => close(),
    });

    const close = () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
      if (!reply.raw.writableEnded) reply.raw.end();
    };

    // Aba fechada ou rede caída: sem isto o listener e o timer sobrevivem à conexão.
    reply.raw.on('close', close);
  }
}

function requestId(request: AuthenticatedRequest): string | undefined {
  return request.id ? String(request.id) : undefined;
}
