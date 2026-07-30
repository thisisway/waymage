import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from './app-error';
import { ZodValidationPipe } from './zod-validation.pipe';

const schema = z.object({ name: z.string().min(1), count: z.number().int().max(4) });

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('devolve o valor já tipado quando válido', () => {
    expect(pipe.transform({ name: 'cena', count: 2 })).toEqual({ name: 'cena', count: 2 });
  });

  it('lança AppError com o caminho de cada campo inválido', () => {
    try {
      pipe.transform({ name: '', count: 99 });
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const details = (error as AppError).details as { issues: { path: string }[] };
      expect(details.issues.map((i) => i.path).sort()).toEqual(['count', 'name']);
      expect((error as AppError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('remove campos não declarados em vez de repassá-los adiante', () => {
    const result = pipe.transform({ name: 'x', count: 1, isAdmin: true }) as Record<
      string,
      unknown
    >;
    expect(result).not.toHaveProperty('isAdmin');
  });
});
