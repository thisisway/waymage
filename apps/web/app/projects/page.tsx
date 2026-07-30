'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { ApiError, api, queryKeys } from '../../lib/api';

export default function ProjectsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const session = useQuery({ queryKey: queryKeys.session, queryFn: () => api.me() });
  const projects = useQuery({ queryKey: queryKeys.projects, queryFn: () => api.listProjects() });

  const createProject = useMutation({
    mutationFn: (name: string) => api.createProject({ name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
  });

  const error = session.error ?? projects.error;

  // 401 é o caminho normal de quem ainda não entrou, não um erro a exibir.
  if (error instanceof ApiError && error.status === 401) {
    router.replace('/login');
    return null;
  }

  if (error) {
    return (
      <Centered tone="error">
        {error instanceof ApiError
          ? error.message
          : 'Não foi possível conectar à API. Ela está rodando?'}
      </Centered>
    );
  }

  if (!session.data || !projects.data) return <Centered>Carregando…</Centered>;

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (!name) return;
    createProject.mutate(name);
    form.reset();
  }

  async function handleLogout() {
    await api.logout().catch(() => undefined);
    queryClient.clear();
    router.replace('/login');
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-surface-border bg-surface-raised px-6 py-3">
        <span className="text-sm font-semibold tracking-tight">Waymage</span>
        <div className="flex items-center gap-4 text-xs text-ink-secondary">
          <a href="/billing" className="hover:text-ink-primary">
            créditos
          </a>
          <span>{session.data.user.email}</span>
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
            disabled={createProject.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-surface-base disabled:opacity-50"
          >
            {createProject.isPending ? 'Criando…' : 'Criar'}
          </button>
        </form>

        {projects.data.length === 0 ? (
          <p className="mt-8 text-sm text-ink-muted">
            Nenhum projeto ainda. Crie o primeiro acima.
          </p>
        ) : (
          <ul className="mt-6 space-y-2">
            {projects.data.map((project) => (
              <li key={project.id}>
                <a
                  href={`/projects/${project.id}`}
                  className="block rounded-md border border-surface-border bg-surface-raised px-4 py-3 hover:border-ink-muted"
                >
                  <div className="text-sm text-ink-primary">{project.name}</div>
                  {project.description && (
                    <div className="mt-0.5 text-xs text-ink-secondary">{project.description}</div>
                  )}
                  <div className="mt-1 text-xs text-ink-muted">
                    atualizado em {new Date(project.updatedAt).toLocaleDateString('pt-BR')}
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
