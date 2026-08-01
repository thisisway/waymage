'use client';

import { useQuery } from '@tanstack/react-query';
import type { SceneSpec } from '@waymage/scene-spec';
import { api, queryKeys, type GenerationJob, type GenerationResult } from '../lib/api';
import { BeforeAfter } from './before-after';
import { Icon } from './ui/icons';
import type { useGeneration } from '../lib/use-generation';
import { ResultActions } from './result-actions';

/** Resumo, custo e alertas antes de gerar (blueprint §22). */
export function GenerationSummary({ sceneId }: { sceneId: string }) {
  const estimate = useQuery({
    queryKey: queryKeys.estimate(sceneId),
    queryFn: () => api.estimate(sceneId),
  });

  if (!estimate.data) return null;
  const { count, estimatedSeconds, provider, summary, warnings, canGenerate, alternatives } =
    estimate.data;

  // Só o descartado interessa: repetir o escolhido, que já está em destaque acima, seria
  // ocupar espaço para não dizer nada.
  const others = alternatives.filter((entry) => entry.provider !== provider);

  return (
    <div className="animate-rise mx-auto w-full max-w-2xl rounded-lg border border-surface-border bg-surface-raised p-4 shadow-sm">
      <p className="text-[13px] leading-relaxed text-ink-secondary">{summary}</p>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        {[
          ['provedor', provider],
          ['tempo', `~${estimatedSeconds}s`],
          ['imagens', String(count)],
        ].map(([term, value]) => (
          <div key={term} className="rounded-md bg-surface-overlay px-3 py-2">
            <dt className="text-micro uppercase tracking-wide text-ink-muted">{term}</dt>
            <dd className="mt-0.5 font-mono text-code font-semibold text-ink-primary">{value}</dd>
          </div>
        ))}
      </dl>

      {others.length > 0 && (
        <details className="mt-2 text-micro text-ink-muted">
          <summary className="cursor-pointer select-none transition-colors duration-fast hover:text-ink-secondary">
            por que este provedor?
          </summary>
          <ul className="mt-1.5 space-y-1 pl-1">
            {others.map((entry) => (
              <li key={entry.provider} className="flex flex-wrap items-baseline gap-x-2">
                <span className={entry.eligible ? 'text-ink-secondary' : 'text-ink-muted'}>
                  {entry.eligible ? '·' : '✕'} {entry.provider}
                </span>
                <span className="text-ink-muted">
                  {entry.notes.length > 0
                    ? entry.notes.join('; ')
                    : `pontuação ${entry.score.toFixed(2)}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

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

/**
 * Ressalvas da moderação.
 *
 * Aparece junto do resultado, e não como toast: um aviso sobre semelhança com pessoa real
 * continua valendo depois que a imagem existe, e um aviso que some sozinho seria como não
 * ter avisado.
 */
export function ModerationNotes({ job }: { job: GenerationJob | null }) {
  const notes = (job?.moderation ?? []).filter((note) => note.reason);
  if (notes.length === 0) return null;

  return (
    <ul className="animate-rise mx-auto w-full max-w-2xl space-y-1.5">
      {notes.map((note, index) => (
        <li
          key={`${note.target}-${index}`}
          className="flex gap-2 rounded-lg border border-state-warn/30 bg-state-warn/[0.06] px-3 py-2 text-micro leading-relaxed text-ink-secondary"
        >
          <Icon name="warning" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-state-warn" />
          <span>{note.reason}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Tentativas contra provedores.
 *
 * Só aparece quando houve mais de uma: no caminho feliz o provedor já está no resumo, e uma
 * linha dizendo "tentativa 1 deu certo" seria ruído. Quando houve troca, o usuário precisa
 * saber — é o que explica um job que demorou o dobro e custou outro preço.
 */
export function ProviderAttempts({ job }: { job: GenerationJob | null }) {
  const runs = job?.runs ?? [];
  if (runs.length < 2) return null;

  return (
    <ol className="animate-rise mx-auto w-full max-w-2xl space-y-1 rounded-lg border border-state-warn/30 bg-state-warn/[0.06] p-3">
      <li className="mb-1 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wide text-state-warn">
        <Icon name="variation" className="h-3.5 w-3.5" />
        trocou de provedor
      </li>
      {runs.map((run) => (
        <li
          key={`${run.provider}-${run.attempt}`}
          className="flex flex-wrap items-baseline gap-x-2 text-micro text-ink-secondary"
        >
          <span className="font-mono text-ink-muted">{run.attempt}.</span>
          <span className="font-semibold text-ink-primary">{run.provider}</span>
          <span className={run.status === 'SUCCEEDED' ? 'text-state-ok' : 'text-state-error'}>
            {run.status === 'SUCCEEDED' ? 'entregou' : 'falhou'}
          </span>
          {run.errorCode && <span className="text-ink-muted">{run.errorCode}</span>}
          {run.latencyMs !== null && (
            <span className="font-mono text-ink-muted">
              {Math.round(run.latencyMs / 100) / 10}s
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Grade de resultados. Enquanto não houver geração, mostra os espaços que serão preenchidos. */
export function ResultsGrid({
  job,
  projectId,
  locks,
  placeholders,
  onSelect,
  onDerive,
  comparing,
  onToggleCompare,
}: {
  job: GenerationJob | null;
  projectId: string;
  locks: SceneSpec['locks'];
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

  /**
   * Derivação de uma imagem só ganha cortina em vez de grade.
   *
   * Edição e refinamento devolvem uma variante do MESMO quadro, e uma figura solta não deixa
   * ver o que mudou. A grade continua valendo quando há várias saídas para escolher.
   */
  const source = job?.sourceResult;
  if (source && results.length === 1 && results[0]) {
    return (
      <div className="flex w-full max-w-2xl flex-col items-center gap-3">
        <BeforeAfter before={source} after={results[0]} />
        <div className="w-full">
          <ResultCard
            result={results[0]}
            projectId={projectId}
            locks={locks}
            index={0}
            onSelect={() => onSelect(results[0]!.id)}
            onDerive={onDerive}
            comparing={comparing.includes(results[0].id)}
            onToggleCompare={() => onToggleCompare(results[0]!.id)}
            hideImage
          />
        </div>
      </div>
    );
  }

  return (
    <div className="stagger grid w-full max-w-2xl grid-cols-2 gap-4">
      {results.map((result, index) => (
        <ResultCard
          key={result.id}
          result={result}
          projectId={projectId}
          locks={locks}
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
  projectId,
  locks,
  index,
  onSelect,
  onDerive,
  comparing,
  onToggleCompare,
  hideImage,
}: {
  result: GenerationResult;
  projectId: string;
  locks: SceneSpec['locks'];
  index: number;
  onSelect: () => void;
  onDerive: (jobId: string) => void;
  comparing: boolean;
  onToggleCompare: () => void;
  /** A cortina do antes-e-depois já mostra a imagem; repeti-la logo abaixo só ocuparia espaço. */
  hideImage?: boolean;
}) {
  return (
    <figure className="space-y-1.5">
      {!hideImage && (
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
      )}

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

      {!hideImage && (
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={comparing}
            onChange={onToggleCompare}
            className="h-3 w-3 accent-accent"
          />
          comparar
        </label>
      )}

      <ResultActions result={result} projectId={projectId} locks={locks} onDerive={onDerive} />
    </figure>
  );
}
