import { type ArgumentsHost, HttpStatus, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from './app-error';
import { HttpExceptionFilter } from './http-exception.filter';
import type { ErrorResponseBody } from './http-exception.filter';

function harness() {
  const send = vi.fn();
  const status = vi.fn().mockReturnValue({ send });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ id: 'req_abc', url: '/x', method: 'GET' }),
    }),
  } as unknown as ArgumentsHost;

  return {
    host,
    status,
    body: () => send.mock.calls[0]?.[0] as ErrorResponseBody,
    statusCode: () => status.mock.calls[0]?.[0] as number,
  };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it('preserva code, message e details de um AppError', () => {
    const h = harness();
    filter.catch(
      new AppError(
        'GENERATION_INSUFFICIENT_CREDITS',
        'Créditos insuficientes.',
        HttpStatus.PAYMENT_REQUIRED,
        {
          required: 8,
        },
      ),
      h.host,
    );

    expect(h.statusCode()).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect(h.body()).toEqual({
      code: 'GENERATION_INSUFFICIENT_CREDITS',
      message: 'Créditos insuficientes.',
      details: { required: 8 },
      requestId: 'req_abc',
    });
  });

  it('não vaza detalhe interno em erro inesperado', () => {
    const h = harness();
    filter.catch(new Error('conexão com postgres em 10.0.0.4 recusada: senha inválida'), h.host);

    expect(h.statusCode()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = h.body();
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('Erro interno.');
    expect(JSON.stringify(body)).not.toContain('postgres');
    expect(JSON.stringify(body)).not.toContain('senha');
  });

  it('mapeia HttpException padrão do Nest para o mesmo formato', () => {
    const h = harness();
    filter.catch(new NotFoundException(), h.host);

    expect(h.statusCode()).toBe(HttpStatus.NOT_FOUND);
    expect(h.body().code).toBe('RESOURCE_NOT_FOUND');
    expect(h.body().requestId).toBe('req_abc');
  });

  it('AppError.notFound responde 404, nunca 403', () => {
    const h = harness();
    filter.catch(AppError.notFound('Projeto'), h.host);
    expect(h.statusCode()).toBe(HttpStatus.NOT_FOUND);
  });
});
