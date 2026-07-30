import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Formato de erro do blueprint §31. Único em toda a API. */
export interface ErrorResponseBody {
  code: string;
  message: string;
  details: Record<string, unknown>;
  requestId: string;
}

/**
 * Traduz qualquer exceção para o formato padrão.
 *
 * Regra de segurança: erro não previsto vira `INTERNAL_ERROR` genérico. Stack trace, SQL e
 * nome de tabela ficam no log do servidor e nunca chegam ao cliente — mensagem de erro é
 * uma das fontes mais comuns de vazamento de estrutura interna.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const requestId = String(request.id ?? 'unknown');

    const { status, body } = this.describe(exception, requestId);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { requestId, path: request.url, method: request.method, err: exception },
        'Erro não tratado',
      );
    }

    void reply.status(status).send(body);
  }

  private describe(
    exception: unknown,
    requestId: string,
  ): { status: number; body: ErrorResponseBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === 'object' && response !== null && 'code' in response) {
        const shaped = response as {
          code: string;
          message: string;
          details?: Record<string, unknown>;
        };
        return {
          status,
          body: {
            code: shaped.code,
            message: shaped.message,
            details: shaped.details ?? {},
            requestId,
          },
        };
      }

      // HttpException padrão do Nest (ex.: 404 de rota inexistente).
      const message = typeof response === 'string' ? response : exception.message;
      return {
        status,
        body: { code: httpStatusCode(status), message, details: {}, requestId },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno.',
        details: {},
        requestId,
      },
    };
  }
}

function httpStatusCode(status: number): string {
  const known: Record<number, string> = {
    [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
    [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
    [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'RESOURCE_NOT_FOUND',
    [HttpStatus.CONFLICT]: 'CONFLICT',
    [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
    [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
    [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
  };
  return known[status] ?? 'ERROR';
}
