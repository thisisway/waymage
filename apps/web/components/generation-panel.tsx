'use client';

import { useQuery } from '@tanstack/react-query';
import { api, queryKeys, type GenerationJob, type GenerationResult } from '../lib/api';
import type { useGeneration } from '../lib/use-generation';
import { ResultActions } from './result-actions';

/** Resumo, custo e alertas antes de gerar (blueprint §22). */
export function GenerationSummary({ sceneId }: { sceneId: string }) {
  const estimate = useQuery({
    queryKey: queryKeys.estimate(sceneId),
    queryFn: () => api.estimate(sceneId),
  });

  if (!estimate.data) return null;
  const { credits, estimatedSeconds, provider, summary, warnings, canGenerate } = estimate.data;

  return (
    <div className="animate-rise mx-auto w-full max-w-2xl rounded-lg border border-surface-border bg-surface-raised p-4 shadow-sm">
      <p className="text-[13px] leading-relaxed text-ink-secondary">{summary}</p>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        {[
          ['provedor', provider],
          ['custo', `${credits} créditos`],
          ['tempo', `~${estimatedSeconds}s`],
        ].map(([term, value]) => (
          <div key={term} className="rounded-md bg-surface-overlay px-3 py-2">
            <dt className="text-micro uppercase tracking-wide text-ink-muted">{term}</dt>
            <dd className="mt-0.5 font-mono text-code font-semibold text-ink-primary">{value}</dd>
          </div>
        ))}
      </dl>

      {warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {warnings.map((warning) => (
            <li
              key={warning.code}
              className="rounded-md border border-state-warn/30 bg-state-warn/10 px-3 py-2 text-micro leading-relaxed text-state-warn"
            >
              {warning.message}
            </li>
          ))}
        </ul>
      )}

      {!canGenerate && (
        <p className="mt-3 rounded-md border border-state-error/30 bg-state-error/10 px-3 py-2 text-micro text-state-error">
          Resolva os erros da cena antes de gerar.
        </p>
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
        <span
          className={`flex items-center gap-2 font-medium ${failed ? 'text-state-error' : 'text-ink-secondary'}`}
        >
          {!failed && progress < 1 && (
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-pill bg-accent" />
          )}
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
        className="mt-2 h-1.5 overflow-hidden rounded-pill bg-surface-overlay"
      >
        <div
          className={`h-full rounded-pill transition-all duration-base ease-out ${
            failed ? 'bg-state-error' : 'bg-accent shadow-glow-sm'
          }`}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      {failed && state.job?.errorMessage && (
        <p role="alert" className="mt-2 text-xs text-state-error">
          {state.job.errorMessage}
          {state.job.errorCode === 'INSUFFICIENT_CREDITS' && (
            <>
              {' '}
              <a href="/billing" className="underline">
                ver créditos
              </a>
            </>
          )}
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
  onDerive,
  comparing,
  onToggleCompare,
}: {
  job: GenerationJob | null;
  placeholders: number;
  onSelect: (resultId: string) => void;
  onDerive: (jobId: string) => void;
  comparing: string[];
  onToggleCompare: (resultId: string) => void;
}) {
  const results = job?.results ?? [];

  if (results.length === 0) {
    return (
      <div className="grid w-full max-w-2xl grid-cols-2 gap-4">
        {Array.from({ length: placeholders }, (_, index) => (
          <div
            key={index}
            className="shimmer flex aspect-video items-center justify-center rounded-lg border border-surface-border text-micro text-ink-muted"
          >
            rascunho {index + 1}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="stagger grid w-full max-w-2xl grid-cols-2 gap-4">
      {results.map((result, index) => (
        <ResultCard
          key={result.id}
          result={result}
          index={index}
          onSelect={() => onSelect(result.id)}
          onDerive={onDerive}
          comparing={comparing.includes(result.id)}
          onToggleCompare={() => onToggleCompare(result.id)}
        />
      ))}
    </div>
  );
}

function ResultCard({
  result,
  index,
  onSelect,
  onDerive,
  comparing,
  onToggleCompare,
}: {
  result: GenerationResult;
  index: number;
  onSelect: () => void;
  onDerive: (jobId: string) => void;
  comparing: boolean;
  onToggleCompare: () => void;
}) {
  return (
    <figure className="space-y-1.5">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={result.selected}
        className={`block w-full overflow-hidden rounded-lg border transition-all duration-fast ease-out ${
          result.selected
            ? 'border-accent shadow-glow'
            : 'border-surface-border hover:-translate-y-0.5 hover:border-accent-40/60 hover:shadow-lg'
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
          {result.selected && (
            <span className="ml-2 rounded-pill bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              escolhido
            </span>
          )}
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

      <label className="flex items-center gap-1.5 text-xs text-ink-muted">
        <input
          type="checkbox"
          checked={comparing}
          onChange={onToggleCompare}
          className="h-3 w-3 accent-accent"
        />
        comparar
      </label>

      <ResultActions resultId={result.id} onDerive={onDerive} />
    </figure>
  );
}
