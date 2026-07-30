'use client';

import {
  aspectRatioSchema,
  cameraAngleSchema,
  compositionRuleSchema,
  contrastSchema,
  depthOfFieldSchema,
  detailLevelSchema,
  fillLightSchema,
  gazeSchema,
  horizontalPositionSchema,
  imageFormatSchema,
  keyLightSchema,
  lightDirectionSchema,
  negativeSpaceSchema,
  orientationSchema,
  purposeSchema,
  qualitySchema,
  shotSchema,
  subjectTypeSchema,
  temperatureSchema,
  textPlacementSchema,
  timeOfDaySchema,
  weatherSchema,
  type SceneSpec,
} from '@waymage/scene-spec';
import { useEditorStore, type InspectorSection } from '../../stores/editor-store';
import {
  NumberField,
  PaletteField,
  SelectField,
  SliderField,
  TagsField,
  TextField,
  ToggleField,
} from './fields';
import { LABELS } from './labels';

/**
 * Inspetor contextual (blueprint §5.1).
 *
 * As opções de cada campo vêm de `schema.options` do Zod, não de listas escritas à mão: a UI
 * fica impossibilitada de oferecer um valor que a API recusaria, e adicionar uma opção no
 * schema a faz aparecer aqui sozinha.
 */
export function Inspector({
  spec,
  onChange,
  disabled,
}: {
  spec: SceneSpec;
  onChange: (spec: SceneSpec) => void;
  disabled?: boolean;
}) {
  const section = useEditorStore((s) => s.section);

  /** Atualiza um bloco do SceneSpec preservando o resto. */
  function patch<K extends keyof SceneSpec>(key: K, value: Partial<SceneSpec[K]>) {
    onChange({ ...spec, [key]: { ...(spec[key] as object), ...value } });
  }

  return (
    <div
      className={disabled ? 'pointer-events-none space-y-4 opacity-50' : 'space-y-4'}
      aria-disabled={disabled}
    >
      {renderSection(section, spec, patch)}
    </div>
  );
}

function renderSection(
  section: InspectorSection,
  spec: SceneSpec,
  patch: <K extends keyof SceneSpec>(key: K, value: Partial<SceneSpec[K]>) => void,
) {
  switch (section) {
    case 'intent':
      return (
        <>
          <SelectField
            label="Finalidade"
            value={spec.intent.purpose}
            options={purposeSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('intent', { purpose: v })}
          />
          <TextField
            label="Mensagem"
            value={spec.intent.message ?? ''}
            placeholder="autoridade e confiança"
            onChange={(v) => patch('intent', { message: v || undefined })}
          />
          <TextField
            label="Público"
            value={spec.intent.targetAudience ?? ''}
            placeholder="adultos interessados em terapia"
            onChange={(v) => patch('intent', { targetAudience: v || undefined })}
          />
          <SelectField
            label="Posição do texto"
            value={spec.intent.textPlacement}
            options={textPlacementSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('intent', { textPlacement: v })}
          />
        </>
      );

    case 'subject':
      return (
        <>
          <SelectField
            label="Tipo"
            value={spec.subject.type}
            options={subjectTypeSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('subject', { type: v })}
          />
          <TextField
            label="Descrição"
            multiline
            value={spec.subject.description}
            placeholder="psicanalista experiente"
            onChange={(v) => patch('subject', { description: v })}
          />
          <SliderField
            label="Consistência de identidade"
            value={spec.subject.identityLock}
            hint="Acima de 0,5 é recomendável anexar uma referência de rosto."
            onChange={(v) => patch('subject', { identityLock: v })}
          />
          <TextField
            label="Pose"
            value={spec.subject.pose ?? ''}
            placeholder="braços cruzados"
            onChange={(v) => patch('subject', { pose: v || undefined })}
          />
          <TextField
            label="Expressão"
            value={spec.subject.expression ?? ''}
            placeholder="confiante e calma"
            onChange={(v) => patch('subject', { expression: v || undefined })}
          />
          <SelectField
            label="Direção do olhar"
            value={spec.subject.gaze}
            options={gazeSchema.options}
            labels={LABELS}
            allowEmpty
            onChange={(v) => patch('subject', { gaze: v ?? undefined })}
          />
          <SelectField
            label="Posição na imagem"
            value={spec.subject.position}
            options={horizontalPositionSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('subject', { position: v })}
          />
          <TextField
            label="Roupa"
            value={spec.subject.wardrobe?.description ?? ''}
            placeholder="terno escuro elegante"
            onChange={(v) =>
              patch('subject', {
                wardrobe: v
                  ? { description: v, lock: spec.subject.wardrobe?.lock ?? false }
                  : undefined,
              })
            }
          />
        </>
      );

    case 'scene':
      return (
        <>
          <TextField
            label="Local"
            multiline
            value={spec.scene.location}
            placeholder="consultório contemporâneo"
            onChange={(v) => patch('scene', { location: v })}
          />
          <SelectField
            label="Horário"
            value={spec.scene.time}
            options={timeOfDaySchema.options}
            labels={LABELS}
            allowEmpty
            onChange={(v) => patch('scene', { time: v })}
          />
          <SelectField
            label="Clima"
            value={spec.scene.weather}
            options={weatherSchema.options}
            labels={LABELS}
            allowEmpty
            onChange={(v) => patch('scene', { weather: v })}
          />
          <SelectField
            label="Detalhe do fundo"
            value={spec.scene.backgroundDetail}
            options={detailLevelSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('scene', { backgroundDetail: v })}
          />
          <TagsField
            label="Elementos"
            value={spec.scene.props}
            placeholder="livros, luminária, poltrona"
            onChange={(v) => patch('scene', { props: v })}
          />
        </>
      );

    case 'camera':
      return (
        <>
          <SelectField
            label="Enquadramento"
            value={spec.camera.shot}
            options={shotSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('camera', { shot: v })}
          />
          <SelectField
            label="Ângulo"
            value={spec.camera.angle}
            options={cameraAngleSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('camera', { angle: v })}
          />
          <NumberField
            label="Lente (mm)"
            value={spec.camera.lensMm}
            min={8}
            max={400}
            hint="50 mm aproxima a percepção do olho humano."
            onChange={(v) => patch('camera', { lensMm: v ?? undefined })}
          />
          <SelectField
            label="Profundidade de campo"
            value={spec.camera.depthOfField}
            options={depthOfFieldSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('camera', { depthOfField: v })}
          />
          <SelectField
            label="Orientação"
            value={spec.camera.orientation}
            options={orientationSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('camera', { orientation: v })}
          />
        </>
      );

    case 'lighting':
      return (
        <>
          <SelectField
            label="Luz principal"
            value={spec.lighting.key}
            options={keyLightSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('lighting', { key: v })}
          />
          <SelectField
            label="Luz de preenchimento"
            value={spec.lighting.fill}
            options={fillLightSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('lighting', { fill: v })}
          />
          <SelectField
            label="Contraste"
            value={spec.lighting.contrast}
            options={contrastSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('lighting', { contrast: v })}
          />
          <SelectField
            label="Temperatura"
            value={spec.lighting.temperature}
            options={temperatureSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('lighting', { temperature: v })}
          />
          <SelectField
            label="Direção"
            value={spec.lighting.direction}
            options={lightDirectionSchema.options}
            labels={LABELS}
            allowEmpty
            onChange={(v) => patch('lighting', { direction: v ?? undefined })}
          />
          <ToggleField
            label="Luz de recorte (rim light)"
            value={spec.lighting.rim}
            onChange={(v) => patch('lighting', { rim: v })}
          />
        </>
      );

    case 'composition':
      return (
        <>
          <SelectField
            label="Regra"
            value={spec.composition.rule}
            options={compositionRuleSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('composition', { rule: v })}
          />
          <SelectField
            label="Posição do sujeito"
            value={spec.composition.subjectPosition}
            options={horizontalPositionSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('composition', { subjectPosition: v })}
          />
          <SelectField
            label="Espaço negativo"
            value={spec.composition.negativeSpace}
            options={negativeSpaceSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('composition', { negativeSpace: v })}
          />
          <ToggleField
            label="Reservar área para texto"
            value={spec.composition.reservedTextArea}
            hint="Combine com um espaço negativo do lado oposto ao sujeito."
            onChange={(v) => patch('composition', { reservedTextArea: v })}
          />
          <ToggleField
            label="Simetria"
            value={spec.composition.symmetry}
            onChange={(v) => patch('composition', { symmetry: v })}
          />
        </>
      );

    case 'style':
      return (
        <>
          <TextField
            label="Preset"
            value={spec.style.preset}
            placeholder="cinematic_editorial"
            onChange={(v) => patch('style', { preset: v })}
          />
          <SliderField
            label="Realismo"
            value={spec.style.realism}
            onChange={(v) => patch('style', { realism: v })}
          />
          <SliderField
            label="Estilização"
            value={spec.style.stylization}
            onChange={(v) => patch('style', { stylization: v })}
          />
          <PaletteField
            value={spec.style.palette}
            onChange={(v) => patch('style', { palette: v })}
          />
        </>
      );

    case 'output':
      return (
        <>
          <SelectField
            label="Proporção"
            value={spec.output.aspectRatio}
            options={aspectRatioSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('output', { aspectRatio: v })}
          />
          <SelectField
            label="Qualidade"
            value={spec.output.quality}
            options={qualitySchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('output', { quality: v })}
          />
          <NumberField
            label="Quantidade"
            value={spec.output.count}
            min={1}
            max={8}
            hint="Explore em rascunho; promova só o escolhido para final."
            onChange={(v) => v !== null && patch('output', { count: v })}
          />
          <SelectField
            label="Formato"
            value={spec.output.format}
            options={imageFormatSchema.options}
            labels={LABELS}
            onChange={(v) => v && patch('output', { format: v })}
          />
          <ToggleField
            label="Fundo transparente"
            value={spec.output.transparentBackground}
            hint="Exige PNG ou WebP."
            onChange={(v) => patch('output', { transparentBackground: v })}
          />
        </>
      );
  }
}
