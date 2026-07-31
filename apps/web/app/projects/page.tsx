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
      <header className="flex items-center justify-between border-b border-surface-border bg-surface-raised px-6 py-3.5">
        <span className="text-h3 text-ink-primary">Waymage</span>
        <div className="flex items-center gap-5 text-micro text-ink-secondary">
          <a href="/billing" className="font-semibold transition-colors hover:text-accent-40">
            créditos
          </a>
          <span className="text-ink-muted">{session.data.user.email}</span>
          <button
            type="button"
            onClick={handleLogout}
            className="font-semibold transition-colors hover:text-ink-primary"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-h2 text-ink-primary">Projetos</h1>

        <form onSubmit={handleCreate} className="mt-4 flex gap-2">
          <input
            name="name"
            type="text"
            required
            maxLength={160}
            placeholder="Nome do novo projeto"
            aria-label="Nome do novo projeto"
            className="flex-1 rounded-md border border-surface-border bg-surface-overlay px-3 py-2.5 text-[14px] text-ink-primary transition-all duration-fast ease-out placeholder:text-ink-muted hover:border-surface-hover focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={createProject.isPending}
            className="rounded-md bg-accent px-5 py-2.5 text-[14px] font-bold text-white shadow-glow-sm transition-all duration-fast ease-out hover:bg-accent-80 hover:shadow-glow active:scale-[0.98] disabled:opacity-50"
          >
            {createProject.isPending ? 'Criando…' : 'Criar'}
          </button>
        </form>

        {projects.data.length === 0 ? (
          <p className="mt-8 text-sm text-ink-muted">
            Nenhum projeto ainda. Crie o primeiro acima.
          </p>
        ) : (
          <ul className="stagger mt-6 grid gap-3 sm:grid-cols-2">
            {projects.data.map((project) => (
              <li key={project.id}>
                <a
                  href={`/projects/${project.id}`}
                  className="group block h-full rounded-lg border border-surface-border bg-surface-raised p-4 transition-all duration-fast ease-out hover:-translate-y-0.5 hover:border-accent-40/60 hover:shadow-lg"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[15px] font-bold text-ink-primary">{project.name}</span>
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4 shrink-0 text-ink-muted opacity-0 transition-all duration-fast ease-out group-hover:translate-x-0.5 group-hover:text-accent-40 group-hover:opacity-100"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </div>
                  {project.description && (
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
                      {project.description}
                    </p>
                  )}
                  <p className="mt-3 text-micro text-ink-muted">
                    atualizado em {new Date(project.updatedAt).toLocaleDateString('pt-BR')}
                  </p>
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
