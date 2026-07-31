import { z } from 'zod';

export const estimateSchema = z.object({
  sceneId: z.string().uuid(),
});

export const createGenerationSchema = z.object({
  sceneId: z.string().uuid(),
  operationType: z.enum(['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'VARIATION', 'REFINE']).optional(),
});

/**
 * Edição localizada (blueprint §14).
 *
 * `featherPx` e `inverted` ficam na `MaskAsset` e não nos pixels: a máscara pintada é binária
 * e imutável, e suavizar ou inverter é decisão de aplicação. Guardadas como dado, dá para
 * repetir a edição com outro valor sem repintar nada.
 */
export const editSchema = z.object({
  maskAssetId: z.string().uuid(),
  instruction: z.string().trim().min(3).max(500),
  /** Suavização da borda, em pixels do arquivo original. */
  featherPx: z.number().int().min(0).max(64).default(0),
  /** Editar tudo MENOS o que foi pintado. */
  inverted: z.boolean().default(false),
});

export type EditInput = z.infer<typeof editSchema>;
export type EstimateInput = z.infer<typeof estimateSchema>;
export type CreateGenerationInput = z.infer<typeof createGenerationSchema>;
