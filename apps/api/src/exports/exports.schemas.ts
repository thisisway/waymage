import { z } from 'zod';

export const createExportSchema = z.object({
  /** Um ou mais resultados de geração. Todos precisam ser do mesmo workspace. */
  resultIds: z.array(z.string().uuid()).min(1).max(20),
  /** Formato de entrega. WebP é menor; PNG preserva alpha; JPEG é o mais compatível. */
  format: z.enum(['png', 'jpeg', 'webp']).default('png'),
});

export type CreateExportInput = z.infer<typeof createExportSchema>;
