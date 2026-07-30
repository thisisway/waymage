import { z } from 'zod';

/**
 * O `sceneSpec` chega como `unknown` de propósito: quem valida é o
 * `parseSceneSpec` de @waymage/scene-spec, o mesmo schema usado pelo front. Reescrever a
 * validação aqui criaria duas descrições da mesma regra, livres para divergir.
 */
const sceneSpec = z.unknown();

export const createSceneSchema = z.object({
  name: z.string().trim().min(1).max(160),
  sceneSpec: sceneSpec.optional(),
});

/**
 * Autosave. `revision` não é opcional: é o que transforma a gravação num
 * compare-and-swap e detecta que outra aba salvou por cima.
 */
export const autosaveSceneSchema = z
  .object({
    revision: z.number().int().min(0),
    name: z.string().trim().min(1).max(160).optional(),
    sceneSpec: sceneSpec.optional(),
  })
  .refine((v) => v.name !== undefined || v.sceneSpec !== undefined, {
    message: 'Informe ao menos um campo para salvar.',
  });

export const createVersionSchema = z.object({
  changeSummary: z.string().trim().max(500).optional(),
});

export type CreateSceneInput = z.infer<typeof createSceneSchema>;
export type AutosaveSceneInput = z.infer<typeof autosaveSceneSchema>;
export type CreateVersionInput = z.infer<typeof createVersionSchema>;
