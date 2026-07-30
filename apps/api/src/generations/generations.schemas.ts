import { z } from 'zod';

export const estimateSchema = z.object({
  sceneId: z.string().uuid(),
});

export const createGenerationSchema = z.object({
  sceneId: z.string().uuid(),
  operationType: z.enum(['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'VARIATION', 'REFINE']).optional(),
});

export type EstimateInput = z.infer<typeof estimateSchema>;
export type CreateGenerationInput = z.infer<typeof createGenerationSchema>;
