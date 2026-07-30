/**
 * Versão do schema do SceneSpec.
 *
 * Persistida junto com cada SceneVersion. Quando existir uma 1.1, `parseSceneSpec`
 * ganha um passo de migração antes da validação — o ponto de extensão já está lá.
 * Ver docs/DECISIONS.md D-004.
 */
export const SCENE_SPEC_VERSION = '1.0' as const;

export type SceneSpecVersion = typeof SCENE_SPEC_VERSION;

/** Versões que este pacote consegue ler (hoje, só a atual). */
export const SUPPORTED_SCENE_SPEC_VERSIONS: readonly string[] = [SCENE_SPEC_VERSION];
