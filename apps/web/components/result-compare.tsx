'use client';

import type { GenerationResult } from '../lib/api';

/**
 * Comparação lado a lado (blueprint §5.1, "comparação lado a lado").
 *
 * Duas imagens no mesmo tamanho, na mesma tela. Escolher entre quatro rascunhos com a grade
 * é difícil porque eles ficam pequenos; aqui as duas candidatas ocupam a largura toda.
 */
export function ResultCompare({
  results,
  selectedIds,
  onClose,
}: {
  results: GenerationResult[];
  selectedIds: string[];
  onClose: () => void;
}) {
  const pair = selectedIds
    .map((id) => results.find((result) => result.id === id))
    .filter((result): result is GenerationResult => result !== undefined);

  if (pair.length !== 2) return null;

  return (
    <div className="w-full max-w-4xl">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-ink-secondary">Comparando duas imagens</span>
        <button type="button" onClick={onClose} className="text-ink-muted hover:text-ink-primary">
          fechar comparação
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {pair.map((result, index) => (
          <figure key={result.id} className="space-y-1.5">
            {result.url ? (
              // <img> e não next/image: a URL é assinada e efêmera; o otimizador do Next a
              // reescreveria e quebraria a assinatura.
              <img
                src={result.url}
                alt={`Comparação ${index + 1}`}
                className="w-full rounded-lg border border-surface-border object-contain"
              />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-lg border border-surface-border bg-surface-raised text-xs text-ink-muted">
                indisponível
              </div>
            )}

            <figcaption className="flex items-center justify-between text-xs text-ink-muted">
              <span>
                {result.width}×{result.height}
                {result.selected && <span className="ml-1.5 text-accent">selecionado</span>}
              </span>
              {result.evaluation && (
                <span className={result.evaluation.score < 1 ? 'text-state-warn' : 'text-state-ok'}>
                  aderência {Math.round(result.evaluation.score * 100)}%
                </span>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
