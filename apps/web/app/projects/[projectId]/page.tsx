'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { ApiError, api, queryKeys } from '../../../lib/api';
import { toast } from '../../../components/ui/toast';

/** Cenas de um projeto. Ponto de entrada para o editor. */
export default function ProjectScenesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const project = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => api.getProject(projectId),
  });

  const scenes = useQuery({
    queryKey: queryKeys.scenes(projectId),
    queryFn: () => api.listScenes(projectId),
  });

  const createScene = useMutation({
    mutationFn: (name: string) => api.createScene(projectId, { name }),
    // Vai direto para o editor: criar uma cena e ficar na lista não é o que ninguém quer.
    onSuccess: (scene) => router.push(`/scenes/${scene.id}`),
    onError: (caught) =>
      toast.error(caught instanceof ApiError ? caught.message : 'Não foi possível criar a cena.'),
  });

  const error = project.error ?? scenes.error;

  if (error instanceof ApiError && error.status === 401) {
    router.replace('/login');
    return null;
  }

  if (error) {
    return (
      <Centered tone="error">
        {error instanceof ApiError ? error.message : 'Não foi possível carregar o projeto.'}
      </Centered>
    );
  }

  if (!project.data || !scenes.data) return <Centered>Carregando…</Centered>;

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (!name) return;
    createScene.mutate(name);
    form.reset();
    void queryClient.invalidateQueries({ queryKey: queryKeys.scenes(projectId) });
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-3 border-b border-surface-border bg-surface-raised px-6 py-3">
        <a href="/projects" className="text-xs text-ink-muted hover:text-ink-secondary">
          ← projetos
        </a>
        <span className="text-sm font-medium">{project.data.name}</span>
      </header>

      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-base font-medium">Cenas</h1>

        <form onSubmit={handleCreate} className="mt-4 flex gap-2">
          <input
            name="name"
            type="text"
            required
            maxLength={160}
            placeholder="Nome da nova cena"
            aria-label="Nome da nova cena"
            className="flex-1 rounded-md border border-surface-border bg-surface-raised px-3 py-2 text-sm placeholder:text-ink-muted"
          />
          <button
            type="submit"
            disabled={createScene.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-surface-base disabled:opacity-50"
          >
            {createScene.isPending ? 'Criando…' : 'Nova cena'}
          </button>
        </form>

        {createScene.error && (
          <p role="alert" className="mt-3 text-sm text-state-error">
            {createScene.error instanceof ApiError
              ? createScene.error.message
              : 'Não foi possível criar a cena.'}
          </p>
        )}

        {scenes.data.length === 0 ? (
          <p className="mt-8 text-sm text-ink-muted">
            Nenhuma cena ainda. Crie a primeira acima — ela já nasce com um SceneSpec válido.
          </p>
        ) : (
          <ul className="mt-6 space-y-2">
            {scenes.data.map((scene) => (
              <li key={scene.id}>
                <a
                  href={`/scenes/${scene.id}`}
                  className="block rounded-md border border-surface-border bg-surface-raised px-4 py-3 hover:border-ink-muted"
                >
                  <div className="text-sm text-ink-primary">{scene.name}</div>
                  <div className="mt-1 text-xs text-ink-muted">
                    revisão {scene.revision} · atualizada em{' '}
                    {new Date(scene.updatedAt).toLocaleString('pt-BR')}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function Centered({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <p className={`text-sm ${tone === 'error' ? 'text-state-error' : 'text-ink-muted'}`}>
        {children}
      </p>
    </main>
  );
}
