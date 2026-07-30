'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, type Project, type SessionUser } from '../../lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; user: SessionUser; projects: Project[] }
  | { kind: 'error'; message: string };

/**
 * Lista de projetos do workspace.
 *
 * Componente cliente e não server component: a sessão vive num cookie do browser, e
 * renderizar no servidor exigiria repassar o cookie do request Next para a API — indireção
 * sem ganho enquanto a página é interativa de qualquer forma. Migra para TanStack Query na
 * Fase 3, quando houver cache de cenas e versões para coordenar.
 */
export default function ProjectsPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ user }, projects] = await Promise.all([api.me(), api.listProjects()]);
      setState({ kind: 'ready', user, projects });
    } catch (caught) {
      // 401 é o caminho normal de quem não entrou ainda, não um erro a exibir.
      if (caught instanceof ApiError && caught.status === 401) {
        router.replace('/login');
        return;
      }
      setState({
        kind: 'error',
        message:
          caught instanceof ApiError
            ? caught.message
            : 'Não foi possível conectar à API. Ela está rodando?',
      });
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (!name) return;

    setCreating(true);
    try {
      await api.createProject({ name });
      form.reset();
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function handleLogout() {
    await api.logout().catch(() => undefined);
    router.replace('/login');
  }

  if (state.kind === 'loading') {
    return <Centered>Carregando…</Centered>;
  }

  if (state.kind === 'error') {
    return <Centered tone="error">{state.message}</Centered>;
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-surface-border bg-surface-raised px-6 py-3">
        <span className="text-sm font-semibold tracking-tight">Waymage</span>
        <div className="flex items-center gap-4 text-xs text-ink-secondary">
          <span>{state.user.email}</span>
          <button type="button" onClick={handleLogout} className="hover:text-ink-primary">
            Sair
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-base font-medium">Projetos</h1>

        <form onSubmit={handleCreate} className="mt-4 flex gap-2">
          <input
            name="name"
            type="text"
            required
            maxLength={160}
            placeholder="Nome do novo projeto"
            aria-label="Nome do novo projeto"
            className="flex-1 rounded-md border border-surface-border bg-surface-raised px-3 py-2 text-sm placeholder:text-ink-muted"
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-surface-base disabled:opacity-50"
          >
            {creating ? 'Criando…' : 'Criar'}
          </button>
        </form>

        {state.projects.length === 0 ? (
          <p className="mt-8 text-sm text-ink-muted">
            Nenhum projeto ainda. Crie o primeiro acima.
          </p>
        ) : (
          <ul className="mt-6 space-y-2">
            {state.projects.map((project) => (
              <li
                key={project.id}
                className="rounded-md border border-surface-border bg-surface-raised px-4 py-3"
              >
                <div className="text-sm text-ink-primary">{project.name}</div>
                {project.description && (
                  <div className="mt-0.5 text-xs text-ink-secondary">{project.description}</div>
                )}
                <div className="mt-1 text-xs text-ink-muted">
                  atualizado em {new Date(project.updatedAt).toLocaleDateString('pt-BR')}
                </div>
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
