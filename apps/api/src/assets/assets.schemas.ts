import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '@waymage/domain';
import { z } from 'zod';

export const requestUploadSchema = z.object({
  projectId: z.string().uuid(),
  /**
   * Referência (padrão) ou máscara de edição localizada.
   *
   * Separa os dois na origem: máscara é insumo de uma edição, não material criativo, e
   * misturá-las faria a biblioteca do editor encher de PNGs pretos e brancos.
   */
  kind: z.enum(['REFERENCE', 'MASK']).default('REFERENCE'),
  /** Só para exibição. A chave no bucket é gerada por nós, nunca derivada deste valor. */
  filename: z.string().trim().min(1).max(255),
  /**
   * Declaração do cliente, usada apenas para assinar a URL e recusar o caso óbvio cedo.
   * O tipo real é verificado por assinatura de bytes no `complete`.
   */
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_UPLOAD_BYTES, `O arquivo excede ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`),
});

export const completeUploadSchema = z.object({
  assetId: z.string().uuid(),
});

export type RequestUploadInput = z.infer<typeof requestUploadSchema>;
export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;
