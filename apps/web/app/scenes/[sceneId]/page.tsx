'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { validateSceneSpec, type SceneSpec } from '@waymage/scene-spec';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { Inspector } from '../../../components/inspector/inspector';
import { SaveIndicator } from '../../../components/save-indicator';
import { ApiError, api, queryKeys, type Scene } from '../../../lib/api';
import { useAutosave } from '../../../lib/use-autosave';
import { INSPECTOR_SECTIONS, SECTION_LABELS, useEditorStore } from '../../../stores/editor-store';

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
        indicator={<SaveIndicator state={autosave} />}
      />

      <div className="flex min-h-0 flex-1">
        <SectionNav />
        <Canvas scene={scene} />
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

/** Componente próprio para que o título acompanhe a seção pelo hook, e não por leitura única. */
function InspectorPanel({
  scene,
  onChange,
  disabled,
}: {
  scene: Scene;
  onChange: (spec: SceneSpec) => void;
  disabled: boolean;
}) {
  const section = useEditorStore((s) => s.section);

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-surface-border bg-surface-raised p-4">
      <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-ink-muted">
        {SECTION_LABELS[section]}
      </h2>
      <Inspector spec={scene.sceneSpec} onChange={onChange} disabled={disabled} />
      <Issues scene={scene} />
    </aside>
  );
}

function TopBar({
  scene,
  onRename,
  onSnapshot,
  snapshotting,
  blocked,
  indicator,
}: {
  scene: Scene;
  onRename: (name: string) => void;
  onSnapshot: () => void;
  snapshotting: boolean;
  blocked: boolean;
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
          disabled
          title={blocked ? 'Resolva os erros da cena antes de gerar' : 'Disponível na Fase 5'}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-surface-base disabled:cursor-not-allowed disabled:opacity-40"
        >
          Gerar
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

function SectionNav() {
  const { section, setSection } = useEditorStore();
  return (
    <nav className="w-44 shrink-0 border-r border-surface-border bg-surface-raised p-3">
      <h2 className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-ink-muted">
        Cena
      </h2>
      <ul className="space-y-0.5">
        {INSPECTOR_SECTIONS.map((item) => (
          <li key={item}>
            <button
              type="button"
              onClick={() => setSection(item)}
              aria-current={section === item ? 'true' : undefined}
              className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                section === item
                  ? 'bg-surface-overlay text-ink-primary'
                  : 'text-ink-secondary hover:bg-surface-overlay'
              }`}
            >
              {SECTION_LABELS[item]}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Resumo legível da cena — o que o blueprint §22 pede antes de gerar. */
function Canvas({ scene }: { scene: Scene }) {
  const spec = scene.sceneSpec;
  const summary = useMemo(
    () =>
      [
        spec.subject.description,
        spec.subject.pose,
        `em ${spec.scene.location}`,
        spec.scene.time,
        `${spec.camera.shot}, ${spec.camera.angle}`,
        `luz ${spec.lighting.key}, contraste ${spec.lighting.contrast}`,
        spec.style.preset,
      ]
        .filter(Boolean)
        .join(' · '),
    [spec],
  );

  return (
    <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-5 p-8">
      <div className="grid w-full max-w-2xl grid-cols-2 gap-3">
        {Array.from({ length: spec.output.count }, (_, i) => (
          <div
            key={i}
            className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-surface-border bg-surface-raised text-xs text-ink-muted"
          >
            rascunho {i + 1}
          </div>
        ))}
      </div>

      <p className="max-w-2xl text-center text-xs leading-relaxed text-ink-muted">{summary}</p>
      <p className="text-xs text-ink-muted">
        {spec.output.count} imagens · {spec.output.aspectRatio} · {spec.output.quality} ·{' '}
        {spec.output.format}
      </p>
    </main>
  );
}

function Issues({ scene }: { scene: Scene }) {
  if (scene.issues.length === 0) {
    return (
      <p className="mt-6 border-t border-surface-border pt-4 text-xs text-state-ok">
        Nenhum conflito detectado.
      </p>
    );
  }

  const tone = {
    error: 'text-state-error',
    warning: 'text-state-warn',
    suggestion: 'text-ink-muted',
  } as const;

  return (
    <div className="mt-6 border-t border-surface-border pt-4">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-muted">
        Validação
      </h3>
      <ul className="space-y-2.5">
        {scene.issues.map((issue) => (
          <li key={issue.code} className="text-xs leading-relaxed">
            <span className={tone[issue.level]}>{issue.level}</span>{' '}
            <span className="text-ink-secondary">{issue.message}</span>
            {issue.suggestion && (
              <span className="mt-0.5 block text-ink-muted">{issue.suggestion}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
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
