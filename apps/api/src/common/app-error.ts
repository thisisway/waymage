import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Erro de aplicação com código estável.
 *
 * O `code` é contrato com o front (e com os testes): nunca traduzir, nunca renomear sem
 * migração. A `message` é para humanos e pode mudar.
 */
export class AppError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details: Record<string, unknown> = {},
  ) {
    super({ code, message, details }, status);
  }

  static notFound(resource: string): AppError {
    // 404 e não 403: responder 403 confirmaria que o recurso existe em outro workspace.
    return new AppError('RESOURCE_NOT_FOUND', `${resource} não encontrado.`, HttpStatus.NOT_FOUND);
  }

  static serviceUnavailable(code: string, message: string): AppError {
    return new AppError(code, message, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
