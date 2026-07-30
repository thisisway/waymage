import type { SceneSpecInput } from './schema';
import { SCENE_SPEC_VERSION } from './version';

/**
 * Fixtures compartilhadas entre testes, seeds e o estado inicial do editor.
 * Todas devem passar em `parseSceneSpec` — há teste garantindo isso.
 */

/** Cena vazia com que o editor abre uma nova cena. */
export const emptySceneSpec: SceneSpecInput = {
  version: SCENE_SPEC_VERSION,
  intent: { purpose: 'other' },
  subject: { type: 'person', description: 'sujeito a definir' },
  scene: { location: 'a definir' },
  camera: { shot: 'waist_up' },
};

/** Cena completa do blueprint §9.1 — referência para o prompt compiler. */
export const psychoanalystSceneSpec: SceneSpecInput = {
  version: SCENE_SPEC_VERSION,
  intent: {
    purpose: 'social_media_campaign',
    message: 'autoridade e confiança',
    targetAudience: 'adultos interessados em terapia',
    textPlacement: 'left',
  },
  subject: {
    type: 'person',
    description: 'psicanalista experiente',
    identityLock: 0.9,
    pose: 'arms_crossed',
    expression: 'confident_calm',
    gaze: 'camera',
    position: 'right',
    wardrobe: { description: 'terno escuro elegante', lock: true },
  },
  scene: {
    location: 'consultório contemporâneo',
    time: 'evening',
    weather: null,
    backgroundDetail: 'medium',
    props: ['livros', 'luminária', 'poltrona'],
  },
  camera: {
    shot: 'waist_up',
    angle: 'eye_level',
    lensMm: 50,
    depthOfField: 'shallow',
    orientation: 'landscape',
  },
  lighting: {
    key: 'soft',
    fill: 'subtle',
    rim: true,
    contrast: 'cinematic',
    temperature: 'warm_neutral',
  },
  composition: {
    rule: 'thirds',
    subjectPosition: 'right',
    negativeSpace: 'left',
    reservedTextArea: true,
    symmetry: false,
  },
  style: {
    preset: 'cinematic_editorial',
    realism: 0.9,
    stylization: 0.35,
    palette: ['#A90045', '#163F46', '#EFE8D6'],
  },
  references: [
    { assetId: 'ref_face_01', role: 'identity', weight: 0.95, preserve: ['face', 'skin_tone'] },
    { assetId: 'ref_style_02', role: 'style', weight: 0.45, preserve: ['lighting', 'palette'] },
  ],
  locks: {
    identity: true,
    wardrobe: true,
    pose: false,
    camera: true,
    background: false,
    palette: true,
  },
  output: {
    aspectRatio: '16:9',
    quality: 'draft',
    count: 4,
    format: 'webp',
    transparentBackground: false,
  },
  advanced: { provider: 'auto', seed: null, negativePrompt: null, providerParams: {} },
};

/** Foto de produto com fundo transparente — exercita o caminho de PNG/alpha. */
export const productSceneSpec: SceneSpecInput = {
  version: SCENE_SPEC_VERSION,
  intent: { purpose: 'product_shot', message: 'sofisticação minimalista' },
  subject: { type: 'product', description: 'frasco de perfume âmbar' },
  scene: { location: 'fundo infinito neutro', backgroundDetail: 'none' },
  camera: { shot: 'close_up', angle: 'eye_level', lensMm: 100, depthOfField: 'shallow' },
  lighting: { key: 'studio', fill: 'balanced', rim: true, contrast: 'high' },
  composition: { rule: 'center', subjectPosition: 'center' },
  style: { preset: 'product_clean', realism: 1, stylization: 0 },
  locks: { product: true, palette: true },
  output: {
    aspectRatio: '1:1',
    quality: 'final',
    count: 2,
    format: 'png',
    transparentBackground: true,
  },
};

/** Cena deliberadamente conflituosa — usada nos testes de validação. */
export const conflictingSceneSpec: SceneSpecInput = {
  version: SCENE_SPEC_VERSION,
  intent: { purpose: 'portrait' },
  subject: { type: 'person', description: 'retrato', identityLock: 0.9 },
  scene: { location: 'praça aberta' },
  // Plano aberto + identidade travada, espaço negativo em cima do sujeito,
  // duas identidades fortes, roupa travada sem fonte, transparência em JPEG.
  camera: { shot: 'extreme_wide' },
  composition: { subjectPosition: 'left', negativeSpace: 'left' },
  references: [
    { assetId: 'a', role: 'identity', weight: 0.9 },
    { assetId: 'b', role: 'face', weight: 0.8 },
  ],
  locks: { identity: true, wardrobe: true },
  output: { format: 'jpeg', transparentBackground: true },
};
