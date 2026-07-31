'use client';

import { useState } from 'react';
import type { GenerationResult } from '../lib/api';

/**
 * Antes e depois com cortina.
 *
 * Lado a lado funciona para escolher entre rascunhos diferentes; aqui as duas imagens são
 * quase iguais de propósito — uma edição localizada muda uma região e preserva o resto — e o
 * olho não acha a diferença varrendo duas figuras. Arrastar a divisória põe as duas versões
 * no MESMO pixel, que é onde a comparação acontece.
 */
export function BeforeAfter({
  before,
  after,
}: {
  before: GenerationResult;
  after: GenerationResult;
}) {
  const [position, setPosition] = useState(50);

  if (!before.url || !after.url) return null;

  return (
    <figure className="w-full max-w-2xl">
      <div
        className="relative overflow-hidden rounded-lg border border-surface-border"
        style={{ aspectRatio: `${after.width} / ${after.height}` }}
      >
        <img
          src={after.url}
          alt="Depois da edição"
          className="absolute inset-0 h-full w-full object-contain"
        />

        {/* O "antes" por cima, recortado até a divisória. */}
        <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
          <img
            src={before.url}
            alt="Antes da edição"
            className="absolute inset-0 h-full w-full object-contain"
          />
        </div>

        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent shadow-glow-sm"
          style={{ left: `${position}%` }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-pill border-2 border-accent bg-surface-base text-micro text-accent-40"
          style={{ left: `${position}%` }}
        >
          ↔
        </span>

        {/* O range cobre a imagem inteira: arrastar em qualquer ponto move a divisória, que é
            o gesto que a pessoa tenta antes de procurar uma alça. */}
        <input
          type="range"
          min={0}
          max={100}
          value={position}
          aria-label="Posição da divisória entre antes e depois"
          onChange={(event) => setPosition(Number(event.target.value))}
          className="absolute inset-0 h-full w-full cursor-ew-resize appearance-none bg-transparent opacity-0"
        />
      </div>

      <figcaption className="mt-1.5 flex justify-between text-micro text-ink-muted">
        <span>antes</span>
        <span>
          {after.width}×{after.height}
        </span>
        <span>depois</span>
      </figcaption>
    </figure>
  );
}
