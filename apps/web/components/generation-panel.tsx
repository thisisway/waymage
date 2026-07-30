'use client';

import { useQuery } from '@tanstack/react-query';
import { api, queryKeys, type GenerationJob, type GenerationResult } from '../lib/api';
import type { useGeneration } from '../lib/use-generation';

/** Resumo, custo e alertas antes de gerar (blueprint §22). */
export function GenerationSummary({ sceneId }: { sceneId: string }) {
  const estimate = useQuery({
    queryKey: queryKeys.estimate(sceneId),
    queryFn: () => api.estimate(sceneId),
  });

  if (!estimate.data) return null;
  const { credits, estimatedSeconds, provider, summary, warnings, canGenerate } = estimate.data;

  return (
    <div className="mx-auto w-full max-w-2xl rounded-lg border border-surface-border bg-surface-raised p-3">
      <p className="text-xs leading-relaxed text-ink-secondary">{summary}</p>

      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
        <span>
          provedor <span className="font-mono text-ink-secondary">{provider}</span>
        </span>
        <span>
          custo estimado <span className="font-mono text-ink-secondary">{credits} créditos</span>
        </span>
        <span>
          tempo <span className="font-mono text-ink-secondary">~{estimatedSeconds}s</span>
        </span>
      </dl>

      {warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {warnings.map((warning) => (
            <li key={warning.code} className="text-xs text-state-warn">
              {warning.message}
            </li>
          ))}
        </ul>
      )}

      {!canGenerate && (
        <p className="mt-2 text-xs text-state-error">Resolva os erros da cena antes de gerar.</p>
      )}
    </div>
  );
}

/** Barra de progresso alimentada pelo SSE. */
export function GenerationProgressBar({ state }: { state: ReturnType<typeof useGeneration> }) {
  if (!state.progress) return null;

  const { progress, statusLabel, message, status } = state.progress;
  const failed = status === 'FAILED';

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex items-center justify-between text-xs">
        <span className={failed ? 'text-state-error' : 'text-ink-secondary'}>
          {statusLabel}
          {message ? ` — ${message}` : ''}
        </span>
        {state.canCancel && (
          <button
            type="button"
            onClick={state.cancel}
            className="text-ink-muted hover:text-ink-primary"
          >
            cancelar
          </button>
        )}
      </div>

      <div
        role="progressbar"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progresso da geração"
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-overlay"
      >
        <div
          className={`h-full transition-all duration-300 ${failed ? 'bg-state-error' : 'bg-accent'}`}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      {failed && state.job?.errorMessage && (
        <p role="alert" className="mt-2 text-xs text-state-error">
          {state.job.errorMessage}
        </p>
      )}
    </div>
  );
}

/** Grade de resultados. Enquanto não houver geração, mostra os espaços que serão preenchidos. */
export function ResultsGrid({
  job,
  placeholders,
  onSelect,
}: {
  job: GenerationJob | null;
  placeholders: number;
  onSelect: (resultId: string) => void;
}) {
  const results = job?.results ?? [];

  if (results.length === 0) {
    return (
      <div className="grid w-full max-w-2xl grid-cols-2 gap-3">
        {Array.from({ length: placeholders }, (_, index) => (
          <div
            key={index}
            className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-surface-border bg-surface-raised text-xs text-ink-muted"
          >
            rascunho {index + 1}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid w-full max-w-2xl grid-cols-2 gap-3">
      {results.map((result, index) => (
        <ResultCard
          key={result.id}
          result={result}
          index={index}
          onSelect={() => onSelect(result.id)}
        />
      ))}
    </div>
  );
}

function ResultCard({
  result,
  index,
  onSelect,
}: {
  result: GenerationResult;
  index: number;
  onSelect: () => void;
}) {
  return (
    <figure className="space-y-1.5">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={result.selected}
        className={`block w-full overflow-hidden rounded-lg border transition-colors ${
          result.selected ? 'border-accent' : 'border-surface-border hover:border-ink-muted'
        }`}
      >
        {result.url ? (
          // <img> e não next/image: a URL é assinada e efêmera, e o otimizador do Next
          // reescreveria a URL, quebrando a assinatura.
          <img
            src={result.url}
            alt={`Resultado ${index + 1}`}
            className="aspect-video w-full object-cover"
          />
        ) : (
          <div className="flex aspect-video items-center justify-center bg-surface-raised text-xs text-ink-muted">
            indisponível
          </div>
        )}
      </button>

      <figcaption className="flex items-center justify-between text-xs text-ink-muted">
        <span>
          {result.width}×{result.height}
          {result.selected && <span className="ml-1.5 text-accent">selecionado</span>}
        </span>
        {result.evaluation && (
          <span
            title={
              result.evaluation.issues.map((issue) => issue.message).join('\n') ||
              `Não avaliado: ${result.evaluation.notEvaluated.join(', ')}`
            }
            className={result.evaluation.score < 1 ? 'text-state-warn' : 'text-state-ok'}
          >
            aderência {Math.round(result.evaluation.score * 100)}%
          </span>
        )}
      </figcaption>
    </figure>
  );
}
