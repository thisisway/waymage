'use client';

import type { SceneSpec } from '@waymage/scene-spec';

/**
 * Prévia da composição.
 *
 * Mostra, ao vivo, o que as escolhas de enquadramento produzem: proporção real, onde o
 * sujeito fica, quanto do corpo entra, onde sobra espaço e onde o texto vai. É o que
 * transforma o editor de formulário em ferramenta — mudar "posição do sujeito" e ver a
 * silhueta andar responde a pergunta na hora, sem gastar crédito para descobrir.
 *
 * Deliberadamente esquemático: não promete estilo, iluminação nem semelhança. Promete
 * enquadramento, que é exatamente o que estes controles governam.
 */

const SHOT_SCALE: Record<SceneSpec['camera']['shot'], { scale: number; y: number }> = {
  extreme_close_up: { scale: 4.2, y: -70 },
  close_up: { scale: 2.8, y: -42 },
  head_and_shoulders: { scale: 2.0, y: -24 },
  waist_up: { scale: 1.4, y: -8 },
  three_quarter: { scale: 1.1, y: 0 },
  full_body: { scale: 0.85, y: 4 },
  wide: { scale: 0.5, y: 12 },
  extreme_wide: { scale: 0.28, y: 18 },
};

const SUBJECT_X: Record<SceneSpec['subject']['position'], number> = {
  left: 28,
  center: 50,
  right: 72,
};

export function ScenePreview({ spec }: { spec: SceneSpec }) {
  const [w, h] = spec.output.aspectRatio.split(':').map(Number);
  const aspect = (w as number) / (h as number);

  const { scale, y } = SHOT_SCALE[spec.camera.shot];
  const cx = SUBJECT_X[spec.subject.position];
  const palette = spec.style.palette;

  // Área reservada para texto acompanha o espaço negativo — é onde ela cabe.
  const textArea = spec.composition.reservedTextArea
    ? {
        none: null,
        left: { x: 4, y: 20, w: 34, h: 60 },
        right: { x: 62, y: 20, w: 34, h: 60 },
        top: { x: 6, y: 6, w: 88, h: 22 },
        bottom: { x: 6, y: 72, w: 88, h: 22 },
      }[spec.composition.negativeSpace]
    : null;

  return (
    <figure className="w-full max-w-md">
      <div
        className="relative mx-auto overflow-hidden rounded-xl border border-surface-border bg-surface-raised transition-all duration-300"
        style={{ aspectRatio: `${aspect}`, maxHeight: '46vh' }}
      >
        {/* Fundo derivado da paleta: dá noção da direção de cor sem fingir ser o resultado. */}
        <div
          className="absolute inset-0 transition-all duration-500"
          style={{
            background:
              palette.length > 0
                ? `linear-gradient(140deg, ${[...palette, palette[0]].join(', ')})`
                : 'linear-gradient(140deg,#1c1f27,#15171d)',
            opacity: 0.35,
          }}
        />

        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden
        >
          {spec.composition.rule === 'thirds' && (
            <g className="stroke-ink-muted" strokeWidth="0.3" opacity="0.5">
              <line x1="33.3" y1="0" x2="33.3" y2="100" />
              <line x1="66.6" y1="0" x2="66.6" y2="100" />
              <line x1="0" y1="33.3" x2="100" y2="33.3" />
              <line x1="0" y1="66.6" x2="100" y2="66.6" />
            </g>
          )}
        </svg>

        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
          <g
            className="fill-ink-secondary transition-transform duration-500 ease-out"
            style={{
              transform: `translate(${cx - 50}px, ${y}px) scale(${scale})`,
              transformOrigin: '50px 50px',
            }}
            opacity={0.85}
          >
            <circle cx="50" cy="26" r="11" />
            <path d="M31 78c0-12 8-21 19-21s19 9 19 21v34H31z" />
            <rect x="36" y="112" width="10" height="40" rx="4" />
            <rect x="54" y="112" width="10" height="40" rx="4" />
          </g>

          {textArea && (
            <g className="transition-all duration-300">
              <rect
                {...{ x: textArea.x, y: textArea.y, width: textArea.w, height: textArea.h }}
                rx="2"
                className="fill-accent/10 stroke-accent"
                strokeWidth="0.5"
                strokeDasharray="2 1.5"
              />
              <text
                x={textArea.x + textArea.w / 2}
                y={textArea.y + textArea.h / 2}
                textAnchor="middle"
                className="fill-accent"
                style={{ fontSize: '4px' }}
              >
                texto
              </text>
            </g>
          )}
        </svg>
      </div>

      <figcaption className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span>{spec.output.aspectRatio}</span>
        <span aria-hidden>·</span>
        <span>{spec.output.count} imagens</span>
        <span aria-hidden>·</span>
        <span>{spec.output.quality === 'final' ? 'qualidade final' : 'rascunho'}</span>
        <span aria-hidden>·</span>
        <span className="uppercase">{spec.output.format}</span>
      </figcaption>
    </figure>
  );
}
