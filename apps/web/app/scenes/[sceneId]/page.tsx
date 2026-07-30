'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { validateSceneSpec, type SceneSpec } from '@waymage/scene-spec';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import {
  GenerationProgressBar,
  GenerationSummary,
  ResultsGrid,
} from '../../../components/generation-panel';
import { ResultCompare } from '../../../components/result-compare';
import { Inspector } from '../../../components/inspector/inspector';
import { LibraryPanel } from '../../../components/library-panel';
import { CreditBadge } from '../../../components/credit-badge';
import { SaveIndicator } from '../../../components/save-indicator';
import { ApiError, api, queryKeys, type Scene } from '../../../lib/api';
import { useAutosave } from '../../../lib/use-autosave';
import { useGeneration } from '../../../lib/use-generation';
import { ScenePreview } from '../../../components/scene-preview';
import { useEditorStore } from '../../../stores/editor-store';

/**
 * Editor de cena.
 *
 * O SceneSpec exibido é o do cache do TanStack Query, atualizado localmente a cada edição e
 * confirmado pelo autosave. Manter uma cópia em `useState` criaria uma segunda fonte da
 * verdade que divergiria do servidor no primeiro conflito.
 */
export default function SceneEditorPage() {
  const params = useParams<{ sceneId: string }>();
  const sceneId = params.sceneId;
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: scene, error } = useQuery({
    queryKey: queryKeys.scene(sceneId),
    queryFn: () => api.getScene(sceneId),
  });

  const applyServerScene = useCallback(
    (saved: Scene) => queryClient.setQueryData(queryKeys.scene(sceneId), saved),
    [queryClient, sceneId],
  );

  const autosave = useAutosave(scene, applyServerScene);

  /** Edição local: atualiza o cache na hora e agenda a gravação. */
  const updateSpec = useCallback(
    (next: SceneSpec) => {
      queryClient.setQueryData<Scene>(queryKeys.scene(sceneId), (current) =>
        current ? { ...current, sceneSpec: next, issues: validateSceneSpec(next) } : current,
      );
      autosave.save({ sceneSpec: next });
    },
    [autosave, queryClient, sceneId],
  );

  const updateName = useCallback(
    (name: string) => {
      queryClient.setQueryData<Scene>(queryKeys.scene(sceneId), (current) =>
        current ? { ...current, name } : current,
      );
      autosave.save({ name });
    },
    [autosave, queryClient, sceneId],
  );

  const snapshot = useMutation({
    mutationFn: (changeSummary: string) => api.createVersion(sceneId, { changeSummary }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.versions(sceneId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scene(sceneId) });
    },
  });

  const versions = useQuery({
    queryKey: queryKeys.versions(sceneId),
    queryFn: () => api.listVersions(sceneId),
  });

  const generation = useGeneration(sceneId);

  // Comparação é estado efêmero da tela: quais dois resultados estão marcados agora.
  const [comparing, setComparing] = useState<string[]>([]);
  const toggleCompare = useCallback((resultId: string) => {
    setComparing((current) =>
      current.includes(resultId)
        ? current.filter((id) => id !== resultId)
        : // Dois de cada vez: com três, não é mais comparação lado a lado.
          [...current, resultId].slice(-2),
    );
  }, []);

  const selectResult = useMutation({
    mutationFn: (resultId: string) => api.selectResult(resultId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.generation(generation.job?.id ?? '') }),
  });

  if (error instanceof ApiError && error.status === 401) {
    router.replace('/login');
    return null;
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-state-error">
          {error instanceof ApiError ? error.message : 'Não foi possível carregar a cena.'}
        </p>
      </main>
    );
  }

  if (!scene) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-ink-muted">Carregando cena…</p>
      </main>
    );
  }

  const blocking = scene.issues.filter((i) => i.level === 'error');

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        scene={scene}
        onRename={updateName}
        onSnapshot={() => snapshot.mutate('snapshot manual')}
        snapshotting={snapshot.isPending}
        blocked={blocking.length > 0}
        generating={generation.running}
        onGenerate={generation.start}
        indicator={<SaveIndicator state={autosave} />}
      />

      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-surface-border bg-surface-raised p-3">
          <LibraryPanel projectId={scene.projectId} spec={scene.sceneSpec} onChange={updateSpec} />
        </aside>
        <Canvas
          scene={scene}
          generation={generation}
          onSelectResult={(resultId) => selectResult.mutate(resultId)}
          comparing={comparing}
          onToggleCompare={toggleCompare}
          onClearCompare={() => setComparing([])}
        />
        <InspectorPanel
          scene={scene}
          onChange={updateSpec}
          disabled={autosave.status === 'conflict'}
        />
      </div>

      <Timeline versions={versions.data ?? []} current={scene.currentVersionId} />
    </div>
  );
}

function InspectorPanel({
  scene,
  onChange,
  disabled,
}: {
  scene: Scene;
  onChange: (spec: SceneSpec) => void;
  disabled: boolean;
}) {
  return (
    <aside className="w-[22rem] shrink-0 overflow-y-auto border-l border-surface-border bg-surface-base p-3">
      <Issues scene={scene} />
      <Inspector spec={scene.sceneSpec} onChange={onChange} disabled={disabled} />
    </aside>
  );
}

function TopBar({
  scene,
  onRename,
  onSnapshot,
  snapshotting,
  blocked,
  generating,
  onGenerate,
  indicator,
}: {
  scene: Scene;
  onRename: (name: string) => void;
  onSnapshot: () => void;
  snapshotting: boolean;
  blocked: boolean;
  generating: boolean;
  onGenerate: () => void;
  indicator: React.ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-surface-border bg-surface-raised px-5 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <a
          href={`/projects/${scene.projectId}`}
          className="text-xs text-ink-muted hover:text-ink-secondary"
        >
          ← projeto
        </a>
        <input
          value={scene.name}
          aria-label="Nome da cena"
          onChange={(e) => onRename(e.target.value)}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-ink-primary hover:border-surface-border focus:border-surface-border"
        />
        {indicator}
      </div>

      <div className="flex items-center gap-3 text-xs">
        <CreditBadge />
        <ModeSelector />
        <button
          type="button"
          onClick={onSnapshot}
          disabled={snapshotting}
          className="rounded-md border border-surface-border px-3 py-1.5 text-ink-secondary hover:text-ink-primary disabled:opacity-50"
        >
          {snapshotting ? 'Salvando…' : 'Criar versão'}
        </button>
        <button
          type="button"
          onClick={onGenerate}
          disabled={blocked || generating}
          title={blocked ? 'Resolva os erros da cena antes de gerar' : undefined}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-surface-base disabled:cursor-not-allowed disabled:opacity-40"
        >
          {generating ? 'Gerando…' : 'Gerar'}
        </button>
      </div>
    </header>
  );
}

function ModeSelector() {
  const { mode, setMode } = useEditorStore();
  return (
    <select
      value={mode}
      aria-label="Modo de edição"
      onChange={(e) => setMode(e.target.value as 'quick' | 'guided' | 'pro')}
      className="rounded-md border border-surface-border bg-surface-overlay px-2 py-1.5 text-xs text-ink-secondary"
    >
      <option value="quick">Rápido</option>
      <option value="guided">Guiado</option>
      <option value="pro">Profissional</option>
    </select>
  );
}

/** Área central: resultados, progresso e resumo do que será gerado. */
function Canvas({
  scene,
  generation,
  onSelectResult,
  comparing,
  onToggleCompare,
  onClearCompare,
}: {
  scene: Scene;
  generation: ReturnType<typeof useGeneration>;
  onSelectResult: (resultId: string) => void;
  comparing: string[];
  onToggleCompare: (resultId: string) => void;
  onClearCompare: () => void;
}) {
  const results = generation.job?.results ?? [];

  return (
    <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-8">
      {comparing.length === 2 ? (
        <ResultCompare results={results} selectedIds={comparing} onClose={onClearCompare} />
      ) : results.length > 0 ? (
        <ResultsGrid
          job={generation.job}
          placeholders={scene.sceneSpec.output.count}
          onSelect={onSelectResult}
          onDerive={generation.follow}
          comparing={comparing}
          onToggleCompare={onToggleCompare}
        />
      ) : (
        // Antes da primeira geração, o centro mostra a composição ao vivo em vez de
        // retângulos vazios: cada ajuste no inspetor tem resposta imediata aqui.
        <ScenePreview spec={scene.sceneSpec} />
      )}

      <GenerationProgressBar state={generation} />

      {generation.error && (
        <p role="alert" className="text-xs text-state-error">
          {generation.error.message}
        </p>
      )}

      <GenerationSummary sceneId={scene.id} />
    </main>
  );
}

/**
 * Conflitos da cena, no topo do inspetor.
 *
 * Fica acima e não abaixo porque um erro bloqueia a geração: descobri-lo depois de rolar oito
 * cartões é tarde demais.
 */
function Issues({ scene }: { scene: Scene }) {
  if (scene.issues.length === 0) return null;

  const style = {
    error: 'border-state-error/40 bg-state-error/10 text-state-error',
    warning: 'border-state-warn/40 bg-state-warn/10 text-state-warn',
    suggestion: 'border-surface-border bg-surface-raised text-ink-muted',
  } as const;

  return (
    <ul className="mb-2.5 space-y-1.5">
      {scene.issues.map((issue) => (
        <li
          key={issue.code}
          className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${style[issue.level]}`}
        >
          {issue.message}
          {issue.suggestion && <span className="mt-1 block opacity-80">{issue.suggestion}</span>}
        </li>
      ))}
    </ul>
  );
}

function Timeline({
  versions,
  current,
}: {
  versions: { id: string; versionNumber: number; changeSummary: string | null }[];
  current: string | null;
}) {
  return (
    <footer className="flex items-center gap-2 overflow-x-auto border-t border-surface-border bg-surface-raised px-5 py-2.5 text-xs">
      <span className="shrink-0 text-ink-muted">Versões</span>
      {versions.length === 0 ? (
        <span className="text-ink-muted">— nenhuma ainda. Crie uma antes de gerar.</span>
      ) : (
        <ol className="flex items-center gap-2">
          {[...versions].reverse().map((version, index) => (
            <li key={version.id} className="flex shrink-0 items-center gap-2">
              {index > 0 && (
                <span aria-hidden className="text-ink-muted">
                  →
                </span>
              )}
              <span
                title={version.changeSummary ?? undefined}
                className={
                  version.id === current
                    ? 'rounded bg-surface-overlay px-2 py-0.5 text-ink-primary'
                    : 'px-2 py-0.5 text-ink-secondary'
                }
              >
                v{version.versionNumber}
              </span>
            </li>
          ))}
        </ol>
      )}
    </footer>
  );
}
