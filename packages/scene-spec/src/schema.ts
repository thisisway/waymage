import { z } from 'zod';
import { SCENE_SPEC_VERSION } from './version';

/**
 * SceneSpec — fonte da verdade de uma cena.
 *
 * Definido uma única vez em Zod e consumido por web, api e worker. O tipo TypeScript
 * é inferido, nunca escrito à mão: assim front e back não podem divergir.
 */

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Cor deve estar no formato hexadecimal (#RRGGBB)');

/** Escala normalizada 0..1 usada por intensidades (identidade, realismo, peso). */
const unitScale = z.number().min(0).max(1);

// ── intent ───────────────────────────────────────────────────────────────────

export const purposeSchema = z.enum([
  'social_media_campaign',
  'advertisement',
  'product_shot',
  'editorial',
  'portrait',
  'thumbnail',
  'banner',
  'presentation',
  'other',
]);

export const textPlacementSchema = z.enum(['none', 'left', 'right', 'top', 'bottom', 'center']);

export const intentSchema = z.object({
  purpose: purposeSchema,
  message: z.string().max(500).optional(),
  targetAudience: z.string().max(500).optional(),
  textPlacement: textPlacementSchema.default('none'),
});

// ── subject ──────────────────────────────────────────────────────────────────

export const subjectTypeSchema = z.enum([
  'person',
  'group',
  'product',
  'animal',
  'object',
  'scene_only',
]);

export const gazeSchema = z.enum(['camera', 'away', 'down', 'up', 'side']);
export const horizontalPositionSchema = z.enum(['left', 'center', 'right']);

export const wardrobeSchema = z.object({
  description: z.string().min(1).max(500),
  /** Trava a roupa: o compilador instrui o provedor a não alterá-la. */
  lock: z.boolean().default(false),
});

export const subjectSchema = z.object({
  type: subjectTypeSchema,
  description: z.string().min(1).max(1000),
  /** 0 = identidade livre, 1 = preservação máxima do rosto de referência. */
  identityLock: unitScale.default(0),
  pose: z.string().max(200).optional(),
  expression: z.string().max(200).optional(),
  gaze: gazeSchema.optional(),
  position: horizontalPositionSchema.default('center'),
  wardrobe: wardrobeSchema.optional(),
});

// ── scene ────────────────────────────────────────────────────────────────────

export const timeOfDaySchema = z.enum([
  'dawn',
  'morning',
  'midday',
  'afternoon',
  'golden_hour',
  'evening',
  'night',
]);

export const weatherSchema = z.enum(['clear', 'cloudy', 'overcast', 'rain', 'snow', 'fog']);
export const detailLevelSchema = z.enum(['none', 'low', 'medium', 'high']);

export const sceneSchema = z.object({
  location: z.string().min(1).max(500),
  time: timeOfDaySchema.nullable().default(null),
  weather: weatherSchema.nullable().default(null),
  backgroundDetail: detailLevelSchema.default('medium'),
  props: z.array(z.string().max(100)).max(20).default([]),
});

// ── camera ───────────────────────────────────────────────────────────────────

export const shotSchema = z.enum([
  'extreme_close_up',
  'close_up',
  'head_and_shoulders',
  'waist_up',
  'three_quarter',
  'full_body',
  'wide',
  'extreme_wide',
]);

export const cameraAngleSchema = z.enum([
  'eye_level',
  'low',
  'high',
  'birds_eye',
  'worms_eye',
  'dutch',
]);

export const depthOfFieldSchema = z.enum(['deep', 'medium', 'shallow']);
export const orientationSchema = z.enum(['landscape', 'portrait', 'square']);

export const cameraSchema = z.object({
  shot: shotSchema,
  angle: cameraAngleSchema.default('eye_level'),
  /** Distância focal simulada, em milímetros. */
  lensMm: z.number().int().min(8).max(400).optional(),
  depthOfField: depthOfFieldSchema.default('medium'),
  orientation: orientationSchema.default('landscape'),
});

// ── lighting ─────────────────────────────────────────────────────────────────

export const keyLightSchema = z.enum(['soft', 'hard', 'natural', 'studio', 'dramatic']);
export const fillLightSchema = z.enum(['none', 'subtle', 'balanced', 'strong']);
export const contrastSchema = z.enum(['flat', 'natural', 'cinematic', 'high']);
export const temperatureSchema = z.enum(['cool', 'neutral', 'warm_neutral', 'warm', 'mixed']);
export const lightDirectionSchema = z.enum(['front', 'left', 'right', 'back', 'top', 'ambient']);

export const lightingSchema = z.object({
  key: keyLightSchema.default('natural'),
  fill: fillLightSchema.default('balanced'),
  rim: z.boolean().default(false),
  contrast: contrastSchema.default('natural'),
  temperature: temperatureSchema.default('neutral'),
  direction: lightDirectionSchema.optional(),
  atmosphere: z.string().max(200).optional(),
});

// ── composition ──────────────────────────────────────────────────────────────

export const compositionRuleSchema = z.enum([
  'thirds',
  'center',
  'golden_ratio',
  'symmetry',
  'diagonal',
  'none',
]);

export const negativeSpaceSchema = z.enum(['none', 'left', 'right', 'top', 'bottom']);

export const compositionSchema = z.object({
  rule: compositionRuleSchema.default('thirds'),
  subjectPosition: horizontalPositionSchema.default('center'),
  negativeSpace: negativeSpaceSchema.default('none'),
  /** Reserva uma área limpa para texto sobreposto na peça final. */
  reservedTextArea: z.boolean().default(false),
  symmetry: z.boolean().default(false),
});

// ── style ────────────────────────────────────────────────────────────────────

export const styleSchema = z.object({
  preset: z.string().max(100).default('natural'),
  realism: unitScale.default(0.8),
  stylization: unitScale.default(0.2),
  palette: z.array(hexColor).max(8).default([]),
});

// ── references ───────────────────────────────────────────────────────────────

export const referenceRoleSchema = z.enum([
  'identity',
  'face',
  'body',
  'wardrobe',
  'product',
  'scene',
  'style',
  'pose',
  'palette',
  'logo',
]);

/** Aspectos que a referência deve preservar. Texto livre: o compilador traduz por provedor. */
export const preserveAspectSchema = z.enum([
  'face',
  'skin_tone',
  'hair',
  'body_shape',
  'clothing',
  'colors',
  'palette',
  'lighting',
  'composition',
  'texture',
  'shape',
  'logo',
]);

export const referenceSchema = z.object({
  assetId: z.string().min(1),
  role: referenceRoleSchema,
  weight: unitScale.default(0.5),
  preserve: z.array(preserveAspectSchema).max(12).default([]),
});

// ── locks ────────────────────────────────────────────────────────────────────

/** Travas do blueprint §20. Todas explícitas: o compilador precisa saber o que não pode mudar. */
export const locksSchema = z.object({
  identity: z.boolean().default(false),
  face: z.boolean().default(false),
  hairstyle: z.boolean().default(false),
  wardrobe: z.boolean().default(false),
  pose: z.boolean().default(false),
  camera: z.boolean().default(false),
  composition: z.boolean().default(false),
  background: z.boolean().default(false),
  palette: z.boolean().default(false),
  product: z.boolean().default(false),
});

// ── output ───────────────────────────────────────────────────────────────────

export const aspectRatioSchema = z.enum([
  '1:1',
  '4:5',
  '5:4',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '21:9',
]);

export const qualitySchema = z.enum(['draft', 'standard', 'final']);
export const imageFormatSchema = z.enum(['webp', 'png', 'jpeg']);

export const outputSchema = z.object({
  aspectRatio: aspectRatioSchema.default('1:1'),
  quality: qualitySchema.default('draft'),
  count: z.number().int().min(1).max(8).default(4),
  format: imageFormatSchema.default('webp'),
  transparentBackground: z.boolean().default(false),
});

// ── advanced ─────────────────────────────────────────────────────────────────

export const advancedSchema = z.object({
  /** `auto` delega ao ModelRouter; qualquer outro valor força um provedor. */
  provider: z.string().min(1).default('auto'),
  seed: z.number().int().nonnegative().nullable().default(null),
  negativePrompt: z.string().max(2000).nullable().default(null),
  /** Parâmetros crus específicos do provedor. Validados pelo adapter, não aqui. */
  providerParams: z.record(z.unknown()).default({}),
});

// ── SceneSpec ────────────────────────────────────────────────────────────────

export const sceneSpecSchema = z
  .object({
    version: z.literal(SCENE_SPEC_VERSION),
    intent: intentSchema,
    subject: subjectSchema,
    scene: sceneSchema,
    camera: cameraSchema,
    lighting: lightingSchema.default({}),
    composition: compositionSchema.default({}),
    style: styleSchema.default({}),
    references: z.array(referenceSchema).max(12).default([]),
    locks: locksSchema.default({}),
    output: outputSchema.default({}),
    advanced: advancedSchema.default({}),
  })
  .strict();

export type SceneSpec = z.infer<typeof sceneSpecSchema>;
/** Forma aceita na entrada: campos com default podem ser omitidos. */
export type SceneSpecInput = z.input<typeof sceneSpecSchema>;

export type Intent = SceneSpec['intent'];
export type Subject = SceneSpec['subject'];
export type SceneSetting = SceneSpec['scene'];
export type Camera = SceneSpec['camera'];
export type Lighting = SceneSpec['lighting'];
export type Composition = SceneSpec['composition'];
export type Style = SceneSpec['style'];
export type SceneReference = SceneSpec['references'][number];
export type SceneLocks = SceneSpec['locks'];
export type SceneOutput = SceneSpec['output'];
export type SceneAdvanced = SceneSpec['advanced'];

export type ReferenceRole = z.infer<typeof referenceRoleSchema>;
export type AspectRatio = z.infer<typeof aspectRatioSchema>;
export type Quality = z.infer<typeof qualitySchema>;
export type ImageFormat = z.infer<typeof imageFormatSchema>;
export type Shot = z.infer<typeof shotSchema>;
