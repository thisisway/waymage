import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { AppError } from './app-error';

/**
 * Validação de borda com Zod (docs/DECISIONS.md D-010).
 *
 * Substitui os decorators do class-validator: o mesmo schema usado no formulário do front
 * valida a requisição na API, então não há duas descrições da mesma regra.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new AppError('VALIDATION_FAILED', 'Dados inválidos.', HttpStatus.BAD_REQUEST, {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
}
