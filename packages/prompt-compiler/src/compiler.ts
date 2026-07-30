import type { SceneSpec } from '@waymage/scene-spec';
import { parseSceneSpec } from '@waymage/scene-spec';
import type {
  CompilationWarning,
  CompileInput,
  PromptCompilationResult,
  PromptCompiler,
  ReferenceInstruction,
} from './types';
import {
  ANGLE,
  BACKGROUND_DETAIL,
  COMPOSITION_RULE,
  CONTRAST,
  DEPTH_OF_FIELD,
  FILL_LIGHT,
  GAZE,
  KEY_LIGHT,
  LIGHT_DIRECTION,
  NEGATIVE_SPACE,
  POSITION,
  PRESERVE,
  PURPOSE,
  SHOT,
  SUBJECT_TYPE,
  TEMPERATURE,
  TIME_OF_DAY,
  WEATHER,
  describeRealism,
  describeWeight,
  humanize,
} from './vocabulary';

/**
 * Versão do compilador, persistida com cada geração.
 *
 * Sem ela, melhorar o compilador tornaria impossível explicar por que a mesma cena passou a
 * produzir imagens diferentes. Incrementar sempre que a saída mudar de forma perceptível.
 */
export const COMPILER_VERSION = '1.0.0';

/** Ruído que praticamente todo provedor produz e ninguém quer numa peça publicada. */
const BASE_NEGATIVES = [
  'text',
  'watermark',
  'signature',
  'logo overlay',
  'lowres',
  'jpeg artifacts',
  'distorted hands',
  'extra fingers',
  'extra limbs',
  'deformed face',
];

/**
 * Compila um `SceneSpec` em prompt.
 *
 * As seções seguem a ordem do blueprint §10.3 — intenção, sujeito, pose, cenário,
 * composição, câmera, iluminação, direção de arte, restrições, saída. A ordem não é
 * decorativa: modelos de difusão dão mais peso ao início do prompt, então o que define a
 * imagem vem antes do que a refina.
 */
export class SceneSpecPromptCompiler implements PromptCompiler {
  async compile(input: CompileInput): Promise<PromptCompilationResult> {
    // Reparse normaliza defaults e garante que o compilador nunca opera sobre spec parcial.
    const spec = parseSceneSpec(input.sceneSpec);
    const warnings: CompilationWarning[] = [];

    const sections = [
      intentSection(spec, input.mode),
      subjectSection(spec),
      sceneSection(spec),
      compositionSection(spec),
      cameraSection(spec),
      lightingSection(spec),
      artDirectionSection(spec),
    ].filter((section): section is string => section !== null);

    if (input.mode === 'edit' && input.editInstruction) {
      // A instrução de edição vem primeiro: é o que o usuário quer mudar agora, e o resto
      // da cena serve de contexto para preservar o que não deve mudar.
      sections.unshift(`Edit the provided image: ${input.editInstruction}.`);
    }

    const constraints = constraintsFrom(spec);
    const references = referenceInstructions(spec, warnings);
    const negatives = [...BASE_NEGATIVES, ...negativesFrom(spec)];

    // Provedor sem negative prompt ignoraria as restrições em silêncio; melhor dobrá-las
    // dentro do prompt principal do que perdê-las.
    const foldNegatives = !input.providerCapabilities.negativePrompt;
    if (foldNegatives) {
      warnings.push({
        code: 'NEGATIVE_PROMPT_FOLDED',
        message:
          'O provedor não aceita negative prompt; as restrições foram para o prompt principal.',
      });
    }

    if (spec.output.transparentBackground && !input.providerCapabilities.transparentBackground) {
      warnings.push({
        code: 'TRANSPARENCY_UNSUPPORTED',
        message: 'O provedor não gera fundo transparente; será necessário recortar depois.',
      });
    }

    if (references.length > input.providerCapabilities.maxReferenceImages) {
      warnings.push({
        code: 'REFERENCES_TRUNCATED',
        message: `O provedor aceita ${input.providerCapabilities.maxReferenceImages} referências; as excedentes foram descartadas.`,
      });
    }

    const promptParts = [
      ...sections,
      constraints.length > 0 ? `Must preserve: ${constraints.join(', ')}.` : null,
      outputSection(spec, input.mode),
      foldNegatives ? `Avoid: ${negatives.join(', ')}.` : null,
    ].filter((part): part is string => part !== null);

    return {
      prompt: promptParts.join(' '),
      ...(foldNegatives ? {} : { negativePrompt: negatives.join(', ') }),
      referenceInstructions: references.slice(0, input.providerCapabilities.maxReferenceImages),
      warnings,
      normalizedSceneSpec: spec,
      compilerVersion: COMPILER_VERSION,
      summary: summarize(spec, input.mode),
    };
  }
}

// ── Seções ───────────────────────────────────────────────────────────────────

function intentSection(spec: SceneSpec, mode: CompileInput['mode']): string {
  const quality = mode === 'draft' ? 'Concept draft of a' : 'A';
  const message = spec.intent.message ? ` conveying ${spec.intent.message}` : '';
  return `${quality} ${PURPOSE[spec.intent.purpose]}${message}.`;
}

function subjectSection(spec: SceneSpec): string | null {
  if (spec.subject.type === 'scene_only') return null;

  const parts = [`${SUBJECT_TYPE[spec.subject.type]}: ${spec.subject.description}`];

  if (spec.subject.pose) parts.push(humanize(spec.subject.pose));
  if (spec.subject.expression) parts.push(`${humanize(spec.subject.expression)} expression`);
  if (spec.subject.gaze) parts.push(GAZE[spec.subject.gaze]);
  parts.push(POSITION[spec.subject.position]);
  if (spec.subject.wardrobe) parts.push(`wearing ${spec.subject.wardrobe.description}`);

  return `Subject — ${parts.join(', ')}.`;
}

function sceneSection(spec: SceneSpec): string {
  const parts = [spec.scene.location];

  if (spec.scene.time) parts.push(TIME_OF_DAY[spec.scene.time]);
  if (spec.scene.weather) parts.push(WEATHER[spec.scene.weather]);
  if (spec.scene.props.length > 0) parts.push(`featuring ${spec.scene.props.join(', ')}`);
  parts.push(BACKGROUND_DETAIL[spec.scene.backgroundDetail]);

  return `Setting — ${parts.join(', ')}.`;
}

function compositionSection(spec: SceneSpec): string {
  const parts = [COMPOSITION_RULE[spec.composition.rule]];

  const negativeSpace = NEGATIVE_SPACE[spec.composition.negativeSpace];
  if (negativeSpace) parts.push(negativeSpace);
  if (spec.composition.reservedTextArea) {
    parts.push('with an unobstructed area reserved for overlaid text');
  }
  if (spec.composition.symmetry) parts.push('symmetrical balance');

  return `Composition — ${parts.join(', ')}.`;
}

function cameraSection(spec: SceneSpec): string {
  const parts = [SHOT[spec.camera.shot], ANGLE[spec.camera.angle]];

  if (spec.camera.lensMm) parts.push(`${spec.camera.lensMm}mm lens`);
  parts.push(DEPTH_OF_FIELD[spec.camera.depthOfField]);

  return `Camera — ${parts.join(', ')}.`;
}

function lightingSection(spec: SceneSpec): string {
  const parts = [
    KEY_LIGHT[spec.lighting.key],
    FILL_LIGHT[spec.lighting.fill],
    CONTRAST[spec.lighting.contrast],
    TEMPERATURE[spec.lighting.temperature],
  ];

  if (spec.lighting.rim) parts.push('rim light separating subject from background');
  if (spec.lighting.direction) parts.push(LIGHT_DIRECTION[spec.lighting.direction]);
  if (spec.lighting.atmosphere) parts.push(spec.lighting.atmosphere);

  return `Lighting — ${parts.join(', ')}.`;
}

function artDirectionSection(spec: SceneSpec): string {
  const parts = [describeRealism(spec.style.realism, spec.style.stylization)];

  if (spec.style.preset && spec.style.preset !== 'natural') {
    parts.push(humanize(spec.style.preset));
  }
  if (spec.style.palette.length > 0) {
    parts.push(`colour palette ${spec.style.palette.join(', ')}`);
  }

  return `Art direction — ${parts.join(', ')}.`;
}

function outputSection(spec: SceneSpec, mode: CompileInput['mode']): string {
  const parts = [`${spec.output.aspectRatio} aspect ratio`];

  if (spec.output.transparentBackground) parts.push('transparent background');
  parts.push(mode === 'final' ? 'maximum detail and fidelity' : 'quick exploratory render');

  return `Output — ${parts.join(', ')}.`;
}

// ── Restrições e negativos ───────────────────────────────────────────────────

/**
 * Travas viram instrução positiva de preservação.
 *
 * "preserve the face" funciona melhor que "don't change the face": modelos de difusão lidam
 * mal com negação, e um negativo mal interpretado vira justamente o que se queria evitar.
 */
function constraintsFrom(spec: SceneSpec): string[] {
  const constraints: string[] = [];
  const { locks } = spec;

  if (locks.identity || spec.subject.identityLock >= 0.7) {
    constraints.push('the exact identity and facial features of the reference person');
  }
  if (locks.face) constraints.push('facial structure');
  if (locks.hairstyle) constraints.push('hairstyle');
  if (locks.wardrobe || spec.subject.wardrobe?.lock) constraints.push('the described clothing');
  if (locks.pose) constraints.push('the described pose');
  if (locks.camera) constraints.push('the specified framing and camera angle');
  if (locks.composition) constraints.push('the composition layout');
  if (locks.background) constraints.push('the background');
  if (locks.palette && spec.style.palette.length > 0) constraints.push('the colour palette');
  if (locks.product) constraints.push('the product appearance and proportions');

  return constraints;
}

function negativesFrom(spec: SceneSpec): string[] {
  const negatives: string[] = [];

  if (spec.advanced.negativePrompt) negatives.push(spec.advanced.negativePrompt);
  if (spec.composition.reservedTextArea) negatives.push('cluttered composition');
  if (spec.scene.backgroundDetail === 'none') negatives.push('busy background');
  // Fundo transparente não convive com sombra projetada nem cenário.
  if (spec.output.transparentBackground) negatives.push('background scenery', 'cast shadows');

  return negatives;
}

function referenceInstructions(
  spec: SceneSpec,
  warnings: CompilationWarning[],
): ReferenceInstruction[] {
  return spec.references.map((reference) => {
    const preserved = reference.preserve.map((aspect) => PRESERVE[aspect] ?? aspect);

    if (reference.role === 'identity' && preserved.length === 0) {
      warnings.push({
        code: 'IDENTITY_REFERENCE_WITHOUT_ASPECTS',
        message:
          'Referência de identidade sem aspectos a preservar; assumindo rosto e tom de pele.',
      });
      preserved.push(PRESERVE['face'] as string, PRESERVE['skin_tone'] as string);
    }

    const what = preserved.length > 0 ? ` Preserve ${preserved.join(' and ')}.` : '';

    return {
      assetId: reference.assetId,
      role: reference.role,
      weight: reference.weight,
      instruction: `Use this image ${describeWeight(reference.weight)} as the ${reference.role} reference.${what}`,
    };
  });
}

/** Resumo em português, para o usuário conferir antes de gastar créditos. */
function summarize(spec: SceneSpec, mode: CompileInput['mode']): string {
  const parts = [
    spec.subject.type === 'scene_only' ? spec.scene.location : spec.subject.description,
    spec.subject.type === 'scene_only' ? null : `em ${spec.scene.location}`,
    SHOT[spec.camera.shot],
    `${spec.output.count} ${spec.output.count === 1 ? 'imagem' : 'imagens'} ${spec.output.aspectRatio}`,
    mode === 'draft' ? 'em rascunho' : mode === 'final' ? 'em qualidade final' : 'edição',
  ].filter((part): part is string => Boolean(part));

  return parts.join(' · ');
}

/** Instância pronta — o compilador não tem estado. */
export const promptCompiler = new SceneSpecPromptCompiler();
