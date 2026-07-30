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
import {
  ChipList,
  OptionGrid,
  PaletteEditor,
  SectionCard,
  Segmented,
  Slider,
  TextInput,
  Toggle,
} from '../ui/controls';
import { Icon } from '../ui/icons';
import { LABELS } from './labels';
import {
  AspectPreview,
  CompositionPreview,
  DepthPreview,
  DetailPreview,
  LightingPreview,
  NegativeSpacePreview,
  PositionPreview,
  ShotPreview,
  TimePreview,
} from './previews';

/**
 * Inspetor da cena.
 *
 * Uma coluna de cartões colapsáveis, cada um mostrando o valor atual no subtítulo — dá para
 * ler a cena inteira rolando, sem abrir nada. Onde a opção tem forma visual, ela é escolhida
 * por diagrama; `<select>` só sobrou onde a lista é longa e sem forma (horário, clima).
 *
 * As opções continuam vindo de `schema.options` do Zod (D-026): a interface não consegue
 * oferecer um valor que a API recusaria.
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
  function patch<K extends keyof SceneSpec>(key: K, value: Partial<SceneSpec[K]>) {
    onChange({ ...spec, [key]: { ...(spec[key] as object), ...value } });
  }

  const label = (value: string) => LABELS[value] ?? value;

  return (
    <div
      className={disabled ? 'pointer-events-none space-y-2.5 opacity-50' : 'space-y-2.5'}
      aria-disabled={disabled}
    >
      <SectionCard
        icon={<Icon name="target" />}
        title="Intenção"
        summary={label(spec.intent.purpose)}
        defaultOpen
      >
        <Segmented
          label="Finalidade"
          value={spec.intent.purpose}
          options={purposeSchema.options.slice(0, 3).map((v) => ({ value: v, label: label(v) }))}
          onChange={(v) => patch('intent', { purpose: v })}
        />
        <TextInput
          label="Mensagem"
          value={spec.intent.message ?? ''}
          placeholder="autoridade e confiança"
          hint="O sentimento que a peça deve transmitir."
          onChange={(v) => patch('intent', { message: v || undefined })}
        />
        <TextInput
          label="Público"
          value={spec.intent.targetAudience ?? ''}
          placeholder="adultos interessados em terapia"
          onChange={(v) => patch('intent', { targetAudience: v || undefined })}
        />
        <Segmented
          label="Posição do texto"
          value={spec.intent.textPlacement}
          options={textPlacementSchema.options.map((v) => ({ value: v, label: label(v) }))}
          onChange={(v) => patch('intent', { textPlacement: v })}
        />
      </SectionCard>

      <SectionCard
        icon={<Icon name="person" />}
        title="Sujeito"
        summary={spec.subject.description || 'a definir'}
        defaultOpen
      >
        <Segmented
          label="Tipo"
          value={spec.subject.type}
          options={subjectTypeSchema.options
            .slice(0, 4)
            .map((v) => ({ value: v, label: label(v) }))}
          onChange={(v) => patch('subject', { type: v })}
        />
        <TextInput
          label="Descrição"
          multiline
          value={spec.subject.description}
          placeholder="psicanalista experiente, cabelo grisalho, olhar sereno"
          hint="Quanto mais concreto, mais previsível o resultado."
          onChange={(v) => patch('subject', { description: v })}
        />
        <OptionGrid
          label="Posição no quadro"
          value={spec.subject.position}
          options={horizontalPositionSchema.options.map((v) => ({
            value: v,
            label: label(v),
            preview: <PositionPreview position={v} />,
          }))}
          onChange={(v) => patch('subject', { position: v })}
        />
        <Slider
          label="Consistência de identidade"
          value={spec.subject.identityLock}
          marks={['livre', 'idêntico']}
          hint="Acima de 50 é recomendável anexar uma referência de rosto."
          onChange={(v) => patch('subject', { identityLock: v })}
        />
        <TextInput
          label="Pose"
          value={spec.subject.pose ?? ''}
          placeholder="braços cruzados"
          onChange={(v) => patch('subject', { pose: v || undefined })}
        />
        <TextInput
          label="Expressão"
          value={spec.subject.expression ?? ''}
          placeholder="confiante e calma"
          onChange={(v) => patch('subject', { expression: v || undefined })}
        />
        <Segmented
          label="Direção do olhar"
          value={spec.subject.gaze ?? 'camera'}
          options={gazeSchema.options.slice(0, 3).map((v) => ({ value: v, label: label(v) }))}
          onChange={(v) => patch('subject', { gaze: v })}
        />
        <TextInput
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
      </SectionCard>

      <SectionCard
        icon={<Icon name="scene" />}
        title="Cenário"
        summary={spec.scene.location || 'a definir'}
      >
        <TextInput
          label="Local"
          multiline
          value={spec.scene.location}
          placeholder="consultório contemporâneo, estantes de livros ao fundo"
          onChange={(v) => patch('scene', { location: v })}
        />
        <OptionGrid
          label="Detalhe do fundo"
          value={spec.scene.backgroundDetail}
          options={detailLevelSchema.options.map((v) => ({
            value: v,
            label: label(v),
            preview: <DetailPreview level={v} />,
          }))}
          columns={4}
          onChange={(v) => patch('scene', { backgroundDetail: v })}
        />
        <div>
          <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-ink-muted">
            Horário
          </span>
          <div className="grid grid-cols-4 gap-2">
            {timeOfDaySchema.options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => patch('scene', { time: option })}
                aria-pressed={spec.scene.time === option}
                className={`rounded-lg border p-1.5 transition-all ${
                  spec.scene.time === option
                    ? 'border-accent bg-accent/10'
                    : 'border-surface-border hover:border-ink-muted'
                }`}
              >
                <TimePreview time={option} />
                <span className="mt-1 block truncate text-[10px] text-ink-secondary">
                  {label(option)}
                </span>
              </button>
            ))}
          </div>
        </div>
        <Segmented
          label="Clima"
          value={spec.scene.weather ?? 'clear'}
          options={weatherSchema.options.slice(0, 4).map((v) => ({ value: v, label: label(v) }))}
          onChange={(v) => patch('scene', { weather: v })}
        />
        <ChipList
          label="Elementos"
          value={spec.scene.props}
          placeholder="livros, luminária, poltrona…"
          onChange={(v) => patch('scene', { props: v })}
        />
      </SectionCard>

      <SectionCard
        icon={<Icon name="camera" />}
        title="Câmera"
        summary={`${label(spec.camera.shot)} · ${label(spec.camera.angle)}`}
      >
        <OptionGrid
          label="Enquadramento"
          value={spec.camera.shot}
          options={shotSchema.options.map((v) => ({
            value: v,
            label: label(v),
            preview: <ShotPreview shot={v} />,
          }))}
          columns={4}
          hint="Planos abertos reduzem a área do rosto e a consistência de identidade cai."
          onChange={(v) => patch('camera', { shot: v })}
        />
        <Segmented
          label="Ângulo"
          value={spec.camera.angle}
          options={cameraAngleSchema.options
            .slice(0, 3)
            .map((v) => ({ value: v, label: label(v) }))}
          onChange={(v) => patch('camera', { angle: v })}
        />
        <OptionGrid
          label="Profundidade de campo"
          value={spec.camera.depthOfField}
          options={depthOfFieldSchema.options.map((v) => ({
            value: v,
            label: label(v),
            preview: <DepthPreview depth={v} />,
          }))}
          onChange={(v) => patch('camera', { depthOfField: v })}
        />
        <div>
          <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-ink-muted">
            Lente
          </span>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={16}
              max={200}
              step={1}
              value={spec.camera.lensMm ?? 50}
              aria-label="Distância focal"
              onChange={(e) => patch('camera', { lensMm: Number(e.target.value) })}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-surface-overlay accent-accent"
            />
            <span className="w-12 text-right font-mono text-xs text-ink-secondary">
              {spec.camera.lensMm ?? 50}mm
            </span>
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-ink-muted">
            <span>grande angular</span>
            <span>teleobjetiva</span>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        icon={<Icon name="light" />}
        title="Iluminação"
        summary={`${label(spec.lighting.key)} · ${label(spec.lighting.contrast)}`}
      >
        {/* A esfera reage a tudo abaixo: é como se avalia luz em referência fotográfica. */}
        <div className="flex justify-center py-1">
          <div className="h-24 w-24">
            <LightingPreview lighting={spec.lighting} />
          </div>
        </div>

        <Segmented
          label="Luz principal"
          value={spec.lighting.key}
          options={keyLightSchema.options.map((v) => ({ value: v, label: label(v) }))}
          onChange={(v) => patch('lighting', { key: v })}
        />
        <Segmented
          label="Preenchimento"
          value={spec.lighting.fill}
          options={fillLightSchema.options.map((v) => ({ value: v, label: label(v) }))}
          onChange={(v) => patch('lighting', { fill: v })}
        />
        <Segmented
          label="Direção"
          value={spec.lighting.direction ?? 'left'}
          options={lightDirectionSchema.options.slice(0, 4).map((v) => ({
            value: v,
            label: label(v),
          }))}
          onChange={(v) => patch('lighting', { direction: v })}
        />
        <Segmented
          label="Contraste"
          value={spec.lighting.contrast}
          options={contrastSchema.options.map((v) => ({ value: v, label: label(v) }))}
          onChange={(v) => patch('lighting', { contrast: v })}
        />
        <Segmented
          label="Temperatura"
          value={spec.lighting.temperature}
          options={temperatureSchema.options
            .slice(0, 4)
            .map((v) => ({ value: v, label: label(v) }))}
          onChange={(v) => patch('lighting', { temperature: v })}
        />
        <Toggle
          label="Luz de recorte"
          description="Separa o sujeito do fundo com um contorno de luz."
          value={spec.lighting.rim}
          onChange={(v) => patch('lighting', { rim: v })}
        />
      </SectionCard>

      <SectionCard
        icon={<Icon name="grid" />}
        title="Composição"
        summary={label(spec.composition.rule)}
      >
        <OptionGrid
          label="Regra"
          value={spec.composition.rule}
          options={compositionRuleSchema.options.map((v) => ({
            value: v,
            label: label(v),
            preview: <CompositionPreview rule={v} />,
          }))}
          onChange={(v) => patch('composition', { rule: v })}
        />
        <OptionGrid
          label="Espaço negativo"
          value={spec.composition.negativeSpace}
          options={negativeSpaceSchema.options.map((v) => ({
            value: v,
            label: label(v),
            preview: <NegativeSpacePreview space={v} />,
          }))}
          hint="Não coloque o espaço negativo do mesmo lado do sujeito."
          onChange={(v) => patch('composition', { negativeSpace: v })}
        />
        <Toggle
          label="Reservar área para texto"
          description="Mantém uma região limpa para sobrepor texto depois."
          value={spec.composition.reservedTextArea}
          onChange={(v) => patch('composition', { reservedTextArea: v })}
        />
        <Toggle
          label="Simetria"
          value={spec.composition.symmetry}
          onChange={(v) => patch('composition', { symmetry: v })}
        />
      </SectionCard>

      <SectionCard
        icon={<Icon name="palette" />}
        title="Estilo"
        summary={`${spec.style.preset.replace(/_/g, ' ')} · ${spec.style.palette.length} cores`}
      >
        <TextInput
          label="Preset"
          value={spec.style.preset}
          placeholder="cinematic editorial"
          onChange={(v) => patch('style', { preset: v })}
        />
        <Slider
          label="Realismo"
          value={spec.style.realism}
          marks={['ilustração', 'fotográfico']}
          onChange={(v) => patch('style', { realism: v })}
        />
        <Slider
          label="Estilização"
          value={spec.style.stylization}
          marks={['sóbrio', 'autoral']}
          onChange={(v) => patch('style', { stylization: v })}
        />
        <PaletteEditor
          value={spec.style.palette}
          onChange={(v) => patch('style', { palette: v })}
        />
      </SectionCard>

      <SectionCard
        icon={<Icon name="export" />}
        title="Saída"
        summary={`${spec.output.aspectRatio} · ${spec.output.count} · ${label(spec.output.quality)}`}
        defaultOpen
      >
        <OptionGrid
          label="Proporção"
          value={spec.output.aspectRatio}
          options={aspectRatioSchema.options.map((v) => ({
            value: v,
            label: v,
            preview: <AspectPreview ratio={v} />,
          }))}
          columns={4}
          onChange={(v) => patch('output', { aspectRatio: v })}
        />
        <Segmented
          label="Qualidade"
          value={spec.output.quality}
          options={qualitySchema.options.map((v) => ({ value: v, label: label(v) }))}
          hint="Explore em rascunho; promova só o escolhido para final."
          onChange={(v) => patch('output', { quality: v })}
        />
        <div>
          <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-ink-muted">
            Quantidade
          </span>
          <div className="flex gap-1 rounded-lg bg-surface-overlay p-1">
            {[1, 2, 4, 6, 8].map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => patch('output', { count })}
                aria-pressed={spec.output.count === count}
                className={`flex-1 rounded-md px-2 py-1.5 font-mono text-xs transition-all ${
                  spec.output.count === count
                    ? 'bg-accent text-surface-base'
                    : 'text-ink-secondary hover:bg-surface-hover hover:text-ink-primary'
                }`}
              >
                {count}
              </button>
            ))}
          </div>
        </div>
        <Segmented
          label="Formato"
          value={spec.output.format}
          options={imageFormatSchema.options.map((v) => ({ value: v, label: label(v) }))}
          onChange={(v) => patch('output', { format: v })}
        />
        <Toggle
          label="Fundo transparente"
          description="Exige PNG ou WebP. O provedor atual não suporta."
          value={spec.output.transparentBackground}
          onChange={(v) => patch('output', { transparentBackground: v })}
        />
      </SectionCard>
    </div>
  );
}
