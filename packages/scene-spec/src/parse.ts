import { type z } from 'zod';
import { sceneSpecSchema, type SceneSpec, type SceneSpecInput } from './schema';
import { SCENE_SPEC_VERSION, SUPPORTED_SCENE_SPEC_VERSIONS } from './version';

export class SceneSpecParseError extends Error {
  constructor(
    message: string,
    readonly issues: z.ZodIssue[] = [],
  ) {
    super(message);
    this.name = 'SceneSpecParseError';
  }
}

/**
 * Lê um SceneSpec vindo do banco, da API ou do formulário.
 *
 * Ponto único de entrada — quando existir a v1.1, a migração acontece aqui, antes da
 * validação, e nenhum chamador precisa mudar. Ver docs/DECISIONS.md D-004.
 */
export function parseSceneSpec(input: unknown): SceneSpec {
  const version = (input as { version?: unknown } | null)?.version;

  if (typeof version === 'string' && !SUPPORTED_SCENE_SPEC_VERSIONS.includes(version)) {
    throw new SceneSpecParseError(
      `Versão de SceneSpec não suportada: "${version}". Esta build lê: ${SUPPORTED_SCENE_SPEC_VERSIONS.join(', ')}.`,
    );
  }

  const result = sceneSpecSchema.safeParse(input);
  if (!result.success) {
    throw new SceneSpecParseError('SceneSpec inválido.', result.error.issues);
  }
  return result.data;
}

/** Versão não-lançante, para validação inline na UI. */
export function safeParseSceneSpec(
  input: unknown,
): { success: true; data: SceneSpec } | { success: false; error: SceneSpecParseError } {
  try {
    return { success: true, data: parseSceneSpec(input) };
  } catch (error) {
    if (error instanceof SceneSpecParseError) return { success: false, error };
    throw error;
  }
}

/**
 * SceneSpec mínimo utilizável, para uma cena recém-criada.
 * Só os campos sem default razoável precisam ser informados.
 */
export function createSceneSpec(
  seed: Omit<SceneSpecInput, 'version'> & { version?: typeof SCENE_SPEC_VERSION },
): SceneSpec {
  return parseSceneSpec({ ...seed, version: SCENE_SPEC_VERSION });
}

/**
 * Estado inicial de uma cena nova no editor.
 *
 * Os textos são marcadores, não conteúdo: existem para que o SceneSpec seja válido desde o
 * primeiro instante e o usuário veja o formulário preenchido com a forma esperada, em vez de
 * campos vazios com mensagens de erro antes de digitar qualquer coisa.
 */
export function createEmptySceneSpec(): SceneSpec {
  return createSceneSpec({
    intent: { purpose: 'other' },
    subject: { type: 'person', description: 'sujeito a definir' },
    scene: { location: 'cenário a definir' },
    camera: { shot: 'waist_up' },
  });
}
