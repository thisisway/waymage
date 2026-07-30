import type { SceneSpec } from '@waymage/scene-spec';

/**
 * Tradução dos valores do SceneSpec para linguagem de prompt.
 *
 * **Os prompts são compostos em inglês.** Modelos de imagem são treinados majoritariamente
 * em inglês e respondem melhor ao vocabulário fotográfico nessa língua. O texto livre do
 * usuário (descrição do sujeito, local, pose) é preservado como foi escrito — traduzir
 * automaticamente introduziria erro sem ganho, e o modelo lida bem com trechos em português
 * dentro de uma estrutura em inglês.
 *
 * O que vive aqui é vocabulário, não regra: mudar como um enum é descrito não deveria exigir
 * tocar no compilador.
 */

export const PURPOSE: Record<SceneSpec['intent']['purpose'], string> = {
  social_media_campaign: 'social media campaign image',
  advertisement: 'advertising image',
  product_shot: 'commercial product photograph',
  editorial: 'editorial photograph',
  portrait: 'portrait photograph',
  thumbnail: 'thumbnail image',
  banner: 'wide banner image',
  presentation: 'presentation slide image',
  // 'general image' e não 'image' para o artigo indefinido anterior nunca ficar errado.
  other: 'general image',
};

export const SUBJECT_TYPE: Record<SceneSpec['subject']['type'], string> = {
  person: 'a person',
  group: 'a group of people',
  product: 'a product',
  animal: 'an animal',
  object: 'an object',
  scene_only: 'an empty scene',
};

export const GAZE: Record<NonNullable<SceneSpec['subject']['gaze']>, string> = {
  camera: 'looking directly at the camera',
  away: 'looking away from the camera',
  down: 'looking downward',
  up: 'looking upward',
  side: 'looking to the side',
};

export const POSITION: Record<SceneSpec['subject']['position'], string> = {
  left: 'positioned on the left of the frame',
  center: 'centered in the frame',
  right: 'positioned on the right of the frame',
};

export const TIME_OF_DAY: Record<NonNullable<SceneSpec['scene']['time']>, string> = {
  dawn: 'at dawn',
  morning: 'in the morning',
  midday: 'at midday',
  afternoon: 'in the afternoon',
  golden_hour: 'during golden hour',
  evening: 'in the evening',
  night: 'at night',
};

export const WEATHER: Record<NonNullable<SceneSpec['scene']['weather']>, string> = {
  clear: 'clear sky',
  cloudy: 'cloudy sky',
  overcast: 'overcast sky',
  rain: 'rain',
  snow: 'snow',
  fog: 'fog',
};

export const BACKGROUND_DETAIL: Record<SceneSpec['scene']['backgroundDetail'], string> = {
  none: 'plain uncluttered background',
  low: 'minimal background detail',
  medium: 'moderately detailed background',
  high: 'richly detailed background',
};

export const SHOT: Record<SceneSpec['camera']['shot'], string> = {
  extreme_close_up: 'extreme close-up',
  close_up: 'close-up',
  head_and_shoulders: 'head and shoulders shot',
  waist_up: 'waist-up shot',
  three_quarter: 'three-quarter shot',
  full_body: 'full body shot',
  wide: 'wide shot',
  extreme_wide: 'extreme wide shot',
};

export const ANGLE: Record<SceneSpec['camera']['angle'], string> = {
  eye_level: 'eye-level angle',
  low: 'low angle',
  high: 'high angle',
  birds_eye: "bird's-eye view",
  worms_eye: "worm's-eye view",
  dutch: 'dutch angle',
};

export const DEPTH_OF_FIELD: Record<SceneSpec['camera']['depthOfField'], string> = {
  deep: 'deep depth of field, everything in focus',
  medium: 'moderate depth of field',
  shallow: 'shallow depth of field, softly blurred background',
};

export const KEY_LIGHT: Record<SceneSpec['lighting']['key'], string> = {
  soft: 'soft key light',
  hard: 'hard directional key light',
  natural: 'natural light',
  studio: 'studio lighting',
  dramatic: 'dramatic key light',
};

export const FILL_LIGHT: Record<SceneSpec['lighting']['fill'], string> = {
  none: 'no fill light, deep shadows',
  subtle: 'subtle fill light',
  balanced: 'balanced fill light',
  strong: 'strong fill light, open shadows',
};

export const CONTRAST: Record<SceneSpec['lighting']['contrast'], string> = {
  flat: 'flat contrast',
  natural: 'natural contrast',
  cinematic: 'cinematic contrast',
  high: 'high contrast',
};

export const TEMPERATURE: Record<SceneSpec['lighting']['temperature'], string> = {
  cool: 'cool colour temperature',
  neutral: 'neutral colour temperature',
  warm_neutral: 'warm-neutral colour temperature',
  warm: 'warm colour temperature',
  mixed: 'mixed colour temperature',
};

export const LIGHT_DIRECTION: Record<NonNullable<SceneSpec['lighting']['direction']>, string> = {
  front: 'lit from the front',
  left: 'lit from the left',
  right: 'lit from the right',
  back: 'backlit',
  top: 'lit from above',
  ambient: 'ambient light',
};

export const COMPOSITION_RULE: Record<SceneSpec['composition']['rule'], string> = {
  thirds: 'composed on the rule of thirds',
  center: 'centred composition',
  golden_ratio: 'golden-ratio composition',
  symmetry: 'symmetrical composition',
  diagonal: 'diagonal composition',
  none: 'natural composition',
};

export const NEGATIVE_SPACE: Record<SceneSpec['composition']['negativeSpace'], string> = {
  none: '',
  left: 'clear negative space on the left',
  right: 'clear negative space on the right',
  top: 'clear negative space at the top',
  bottom: 'clear negative space at the bottom',
};

/** Aspectos que uma referência pode preservar, no vocabulário do prompt. */
export const PRESERVE: Record<string, string> = {
  face: 'facial features',
  skin_tone: 'skin tone',
  hair: 'hair',
  body_shape: 'body shape',
  clothing: 'clothing',
  colors: 'colours',
  palette: 'colour palette',
  lighting: 'lighting character',
  composition: 'composition',
  texture: 'texture',
  shape: 'shape',
  logo: 'logo',
};

/**
 * Campos de texto livre costumam chegar em snake_case, tanto por hábito quanto porque os
 * presets do produto usam esse formato. `arms_crossed` no meio de uma frase confunde o
 * modelo; `arms crossed` não.
 */
export function humanize(value: string): string {
  return value.replace(/_/g, ' ').trim();
}

/** Descreve realismo e estilização numa frase, em vez de despejar dois números. */
export function describeRealism(realism: number, stylization: number): string {
  const realismText =
    realism >= 0.9
      ? 'photorealistic'
      : realism >= 0.6
        ? 'realistic'
        : realism >= 0.3
          ? 'semi-realistic'
          : 'illustrative';

  if (stylization <= 0.15) return realismText;
  if (stylization <= 0.4) return `${realismText} with subtle stylisation`;
  if (stylization <= 0.7) return `${realismText} with pronounced stylisation`;
  return `${realismText} with heavy artistic stylisation`;
}

/** Peso da referência traduzido em intensidade, que é o que o provedor entende. */
export function describeWeight(weight: number): string {
  if (weight >= 0.85) return 'very strongly';
  if (weight >= 0.6) return 'strongly';
  if (weight >= 0.35) return 'moderately';
  return 'loosely';
}
