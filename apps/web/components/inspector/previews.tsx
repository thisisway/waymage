'use client';

import type { SceneSpec } from '@waymage/scene-spec';

/**
 * Diagramas das opções do SceneSpec.
 *
 * Tudo é SVG e CSS, sem nenhuma imagem de exemplo. A razão não é economia: uma foto de
 * exemplo promete um resultado que o provedor pode não entregar, e "waist_up" ilustrado com
 * um retrato específico sugere estilo, iluminação e sujeito que não foram escolhidos. O
 * diagrama comunica só o que o controle de fato governa.
 */

const STROKE = 'currentColor';

/** Silhueta usada nos diagramas de enquadramento e posição. */
function Figure({ className = '' }: { className?: string }) {
  return (
    <g className={className}>
      <circle cx="50" cy="26" r="11" fill={STROKE} />
      <path d="M31 78c0-12 8-21 19-21s19 9 19 21v34H31z" fill={STROKE} />
      <rect x="36" y="112" width="10" height="40" rx="4" fill={STROKE} />
      <rect x="54" y="112" width="10" height="40" rx="4" fill={STROKE} />
    </g>
  );
}

/**
 * Enquadramento: a mesma silhueta, aproximada e deslocada.
 *
 * Ampliar a figura dentro de uma moldura fixa é literalmente o que a lente faz — e deixa
 * óbvio que "plano aberto" mostra menos do rosto, que é a informação que importa quando há
 * trava de identidade.
 */
const SHOT_TRANSFORM: Record<SceneSpec['camera']['shot'], { scale: number; y: number }> = {
  extreme_close_up: { scale: 4.2, y: -70 },
  close_up: { scale: 2.8, y: -42 },
  head_and_shoulders: { scale: 2.0, y: -24 },
  waist_up: { scale: 1.4, y: -8 },
  three_quarter: { scale: 1.1, y: 0 },
  full_body: { scale: 0.85, y: 4 },
  wide: { scale: 0.5, y: 12 },
  extreme_wide: { scale: 0.28, y: 18 },
};

export function ShotPreview({ shot }: { shot: SceneSpec['camera']['shot'] }) {
  const { scale, y } = SHOT_TRANSFORM[shot];

  return (
    <svg viewBox="0 0 100 100" className="h-full w-auto text-ink-secondary" aria-hidden>
      <rect x="0" y="0" width="100" height="100" rx="6" className="fill-surface-base" />
      <g clipPath="url(#frame)">
        <g transform={`translate(50 ${50 + y}) scale(${scale}) translate(-50 -50)`}>
          <Figure />
        </g>
      </g>
      <defs>
        <clipPath id="frame">
          <rect x="0" y="0" width="100" height="100" rx="6" />
        </clipPath>
      </defs>
    </svg>
  );
}

/** Proporção: o retângulo na forma exata que a imagem terá. */
export function AspectPreview({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(':').map(Number);
  const aspect = (w as number) / (h as number);
  // Cabe na altura ou na largura, o que estourar primeiro.
  const height = aspect >= 1 ? 40 / aspect : 40;
  const width = aspect >= 1 ? 40 : 40 * aspect;

  return (
    <span
      className="rounded border border-current bg-surface-base"
      style={{ width: `${width}px`, height: `${height}px` }}
      aria-hidden
    />
  );
}

/** Posição do sujeito dentro do quadro. */
export function PositionPreview({ position }: { position: 'left' | 'center' | 'right' }) {
  const x = { left: 22, center: 50, right: 78 }[position];

  return (
    <svg viewBox="0 0 100 70" className="h-full w-auto text-ink-secondary" aria-hidden>
      <rect
        x="1"
        y="1"
        width="98"
        height="68"
        rx="5"
        className="fill-surface-base stroke-surface-border"
      />
      <circle cx={x} cy="28" r="8" fill={STROKE} />
      <path d={`M${x - 13} 62c0-9 6-15 13-15s13 6 13 15z`} fill={STROKE} />
    </svg>
  );
}

/**
 * Iluminação: uma esfera com a luz aplicada.
 *
 * Esfera cinza é como se avalia luz em referência fotográfica — mostra direção, dureza e
 * temperatura de uma vez, o que três dropdowns separados não conseguem.
 */
export function LightingPreview({
  lighting,
}: {
  lighting: Pick<SceneSpec['lighting'], 'key' | 'fill' | 'contrast' | 'temperature' | 'direction'>;
}) {
  const origin = {
    front: '50% 40%',
    left: '22% 35%',
    right: '78% 35%',
    back: '50% 85%',
    top: '50% 10%',
    ambient: '50% 50%',
  }[lighting.direction ?? 'left'];

  // Dureza da luz = quão abrupta é a transição para a sombra.
  const spread = { hard: '22%', dramatic: '18%', studio: '45%', natural: '50%', soft: '60%' }[
    lighting.key
  ];

  const tint = {
    cool: '#9fc4e8',
    neutral: '#e8e8e8',
    warm_neutral: '#f0e0cc',
    warm: '#f5cf9f',
    mixed: '#e0d0e8',
  }[lighting.temperature];

  // Preenchimento define o quanto a sombra fecha.
  // Sombras na família da Way Dark: a esfera precisa pertencer à mesma paleta da interface.
  const shadow = { none: '#0B1023', subtle: '#10162E', balanced: '#1D2649', strong: '#2E3A66' }[
    lighting.fill
  ];

  return (
    <span
      className="block h-full w-full rounded-pill transition-all duration-slow ease-out"
      style={{
        background: `radial-gradient(circle at ${origin}, ${tint} 0%, ${tint} ${spread}, ${shadow} 100%)`,
      }}
      aria-hidden
    />
  );
}

/**
 * Regra de composição: as linhas-guia sobre o quadro.
 */
export function CompositionPreview({ rule }: { rule: SceneSpec['composition']['rule'] }) {
  return (
    <svg viewBox="0 0 100 70" className="h-full w-auto" aria-hidden>
      <rect
        x="1"
        y="1"
        width="98"
        height="68"
        rx="5"
        className="fill-surface-base stroke-surface-border"
      />
      <g className="stroke-accent" strokeWidth="1" opacity="0.7">
        {rule === 'thirds' && (
          <>
            <line x1="34" y1="1" x2="34" y2="69" />
            <line x1="67" y1="1" x2="67" y2="69" />
            <line x1="1" y1="24" x2="99" y2="24" />
            <line x1="1" y1="47" x2="99" y2="47" />
          </>
        )}
        {rule === 'center' && <circle cx="50" cy="35" r="14" fill="none" />}
        {rule === 'golden_ratio' && (
          <path d="M99 1v68H1V38h60V1z M61 38a38 38 0 0 0 38-37" fill="none" />
        )}
        {rule === 'symmetry' && (
          <>
            <line x1="50" y1="1" x2="50" y2="69" strokeDasharray="3 2" />
            <rect x="14" y="20" width="22" height="30" fill="none" />
            <rect x="64" y="20" width="22" height="30" fill="none" />
          </>
        )}
        {rule === 'diagonal' && <line x1="4" y1="66" x2="96" y2="4" />}
        {rule === 'none' && (
          <text
            x="50"
            y="39"
            textAnchor="middle"
            className="fill-ink-muted text-[11px]"
            stroke="none"
          >
            livre
          </text>
        )}
      </g>
    </svg>
  );
}

/** Detalhe do fundo: densidade de elementos atrás do sujeito. */
export function DetailPreview({ level }: { level: 'none' | 'low' | 'medium' | 'high' }) {
  const count = { none: 0, low: 3, medium: 7, high: 14 }[level];
  // Posições fixas: variar a cada render faria o ícone "piscar" sem significar nada.
  const dots = Array.from({ length: count }, (_, i) => ({
    x: 10 + ((i * 37) % 80),
    y: 10 + ((i * 23) % 50),
    r: 2 + (i % 3),
  }));

  return (
    <svg viewBox="0 0 100 70" className="h-full w-auto" aria-hidden>
      <rect
        x="1"
        y="1"
        width="98"
        height="68"
        rx="5"
        className="fill-surface-base stroke-surface-border"
      />
      {dots.map((dot, index) => (
        <circle key={index} cx={dot.x} cy={dot.y} r={dot.r} className="fill-ink-muted" />
      ))}
      <path d="M42 69c0-10 4-16 8-16s8 6 8 16z" className="fill-ink-secondary" />
      <circle cx="50" cy="46" r="6" className="fill-ink-secondary" />
    </svg>
  );
}

/** Profundidade de campo: o quanto o fundo desfoca. */
export function DepthPreview({ depth }: { depth: 'deep' | 'medium' | 'shallow' }) {
  const blur = { deep: 0, medium: 1.6, shallow: 3.4 }[depth];

  return (
    <svg viewBox="0 0 100 70" className="h-full w-auto" aria-hidden>
      <defs>
        <filter id={`blur-${depth}`}>
          <feGaussianBlur stdDeviation={blur} />
        </filter>
      </defs>
      <rect
        x="1"
        y="1"
        width="98"
        height="68"
        rx="5"
        className="fill-surface-base stroke-surface-border"
      />
      <g filter={`url(#blur-${depth})`} className="fill-ink-muted">
        <circle cx="20" cy="22" r="9" />
        <rect x="70" y="12" width="18" height="34" rx="3" />
        <circle cx="46" cy="16" r="6" />
      </g>
      <circle cx="50" cy="44" r="9" className="fill-ink-primary" />
      <path d="M36 69c0-9 6-15 14-15s14 6 14 15z" className="fill-ink-primary" />
    </svg>
  );
}

/** Horário do dia: a cor do céu. */
export function TimePreview({ time }: { time: string }) {
  const sky: Record<string, string> = {
    dawn: 'linear-gradient(180deg,#2b3a5c,#c98a6b)',
    morning: 'linear-gradient(180deg,#7fb2e5,#dbe9f5)',
    midday: 'linear-gradient(180deg,#5aa6e8,#bfdcf5)',
    afternoon: 'linear-gradient(180deg,#6fa8dc,#f0d9a8)',
    golden_hour: 'linear-gradient(180deg,#e59b4a,#f5d199)',
    evening: 'linear-gradient(180deg,#3d3a63,#c96f52)',
    night: 'linear-gradient(180deg,#0d1430,#22305c)',
  };

  return (
    <span
      className="block h-9 w-full rounded-md border border-surface-border"
      style={{ background: sky[time] ?? '#161D3B' }}
      aria-hidden
    />
  );
}
