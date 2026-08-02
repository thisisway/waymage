'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, api, queryKeys, type Project } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { Icon } from '../../components/ui/icons';
import { UserMenu } from '../../components/user-menu';
import { toast } from '../../components/ui/toast';

/**
 * Lista de projetos, no formato de navegador de arquivos.
 *
 * A capa de cada cartão é a **última imagem gerada no projeto**. É o que torna a lista
 * navegável de relance: reconhecer um projeto pelo que ele produziu é imediato; ler o nome de
 * doze projetos, não. Projeto sem geração recebe uma capa derivada do próprio id — sempre a
 * mesma para o mesmo projeto, então continua servindo de âncora visual.
 */

type SortMode = 'recent' | 'name';
type ViewMode = 'grid' | 'list';

export default function ProjectsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [sort, setSort] = useState<SortMode>('recent');
  const [view, setView] = useState<ViewMode>('grid');
  const [creating, setCreating] = useState(false);

  const session = useQuery({ queryKey: queryKeys.session, queryFn: () => api.me() });
  const projects = useQuery({ queryKey: queryKeys.projects, queryFn: () => api.listProjects() });

  const createProject = useMutation({
    mutationFn: (name: string) => api.createProject({ name }),
    onSuccess: (project) => {
      setCreating(false);
      // Direto para o editor: o projeto já nasce com a primeira cena, e parar numa lista de
      // um item só para clicar nele seria o passo que acabou de ser removido, de volta.
      if (project.firstSceneId) {
        router.push(`/scenes/${project.firstSceneId}`);
        return;
      }
      toast.success('Projeto criado');
      return queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
    // Sem isto a falha some: o formulário fica aberto, nada aparece, e a pessoa clica de
    // novo achando que não apertou direito. Operação que falha precisa dizer que falhou.
    onError: (caught) =>
      toast.error(
        caught instanceof ApiError ? caught.message : 'Não foi possível criar o projeto.',
      ),
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

  const ordered = [...projects.data].sort((a, b) =>
    sort === 'name'
      ? a.name.localeCompare(b.name, 'pt-BR')
      : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (!name) return;
    createProject.mutate(name);
    form.reset();
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-surface-border bg-surface-base/95 px-6 py-3 backdrop-blur">
        <span className="text-h3 text-ink-primary">Waymage</span>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-6">
        {/* Barra de controle: abas à esquerda, ação e visualização à direita. */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Tab active={sort === 'recent'} onClick={() => setSort('recent')}>
              Recentes
            </Tab>
            <Tab active={sort === 'name'} onClick={() => setSort('name')}>
              Por nome
            </Tab>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCreating((current) => !current)}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-micro font-bold text-white shadow-glow-sm transition-all duration-fast ease-out hover:bg-accent-80 hover:shadow-glow active:scale-[0.97]"
            >
              <Icon name="plus" className="h-3.5 w-3.5" />
              Novo projeto
            </button>

            <div className="flex rounded-md border border-surface-border p-0.5">
              <ViewButton
                active={view === 'grid'}
                onClick={() => setView('grid')}
                label="Grade"
                icon="grid"
              />
              <ViewButton
                active={view === 'list'}
                onClick={() => setView('list')}
                label="Lista"
                icon="list"
              />
            </div>
          </div>
        </div>

        {creating && (
          <form onSubmit={handleCreate} className="animate-rise mb-6 flex gap-2">
            <input
              name="name"
              type="text"
              required
              autoFocus
              maxLength={160}
              placeholder="Nome do novo projeto"
              aria-label="Nome do novo projeto"
              className="max-w-md flex-1 rounded-md border border-surface-border bg-surface-overlay px-3 py-2.5 text-[14px] text-ink-primary transition-all duration-fast ease-out placeholder:text-ink-muted hover:border-surface-hover focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={createProject.isPending}
              className="rounded-md bg-accent px-5 py-2.5 text-[14px] font-bold text-white transition-all duration-fast ease-out hover:bg-accent-80 active:scale-[0.98] disabled:opacity-50"
            >
              {createProject.isPending ? 'Criando…' : 'Criar'}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-md px-4 py-2.5 text-[14px] font-semibold text-ink-muted transition-colors hover:text-ink-primary"
            >
              Cancelar
            </button>
          </form>
        )}

        {ordered.length === 0 ? (
          <EmptyState onCreate={() => setCreating(true)} />
        ) : view === 'grid' ? (
          <ul className="stagger grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
            {ordered.map((project) => (
              <li key={project.id}>
                <ProjectCard project={project} />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="stagger divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border">
            {ordered.map((project) => (
              <li key={project.id}>
                <ProjectRow project={project} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

/**
 * Cartão de projeto: capa grande, barra de metadados embaixo.
 *
 * A capa usa 16:10 — a mesma proporção em que o editor mostra os rascunhos, então a imagem
 * aparece aqui como aparecerá lá.
 */
function ProjectCard({ project }: { project: Project }) {
  return (
    <a
      href={`/projects/${project.id}`}
      className="group block overflow-hidden rounded-lg border border-surface-border bg-surface-raised transition-all duration-fast ease-out hover:-translate-y-0.5 hover:border-accent-40/60 hover:shadow-lg"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-surface-overlay">
        {project.previewUrl ? (
          // <img> e não next/image: a URL é assinada e efêmera; o otimizador do Next a
          // reescreveria e quebraria a assinatura.
          <img
            src={project.previewUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-slow ease-out group-hover:scale-[1.03]"
          />
        ) : (
          <CoverFallback seed={project.id} name={project.name} />
        )}
      </div>

      <div className="flex items-center gap-2.5 border-t border-surface-border px-3 py-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-accent/15 text-accent-40">
          <Icon name="image" className="h-3 w-3" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold text-ink-primary">
            {project.name}
          </span>
          <span className="mt-0.5 block text-micro text-ink-muted">
            editado {timeAgo(project.updatedAt)}
          </span>
        </span>
      </div>
    </a>
  );
}

function ProjectRow({ project }: { project: Project }) {
  return (
    <a
      href={`/projects/${project.id}`}
      className="flex items-center gap-4 bg-surface-raised px-4 py-3 transition-colors duration-fast hover:bg-surface-overlay"
    >
      <span className="h-11 w-16 shrink-0 overflow-hidden rounded-md bg-surface-overlay">
        {project.previewUrl ? (
          <img src={project.previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <CoverFallback seed={project.id} name={project.name} compact />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-ink-primary">
          {project.name}
        </span>
        {project.description && (
          <span className="mt-0.5 block truncate text-micro text-ink-secondary">
            {project.description}
          </span>
        )}
      </span>

      <span className="shrink-0 text-micro text-ink-muted">
        editado {timeAgo(project.updatedAt)}
      </span>
    </a>
  );
}

/**
 * Capa de projeto ainda sem imagem.
 *
 * O matiz vem do id, então é estável: o mesmo projeto tem sempre a mesma cor, e a lista
 * continua reconhecível de relance mesmo antes da primeira geração.
 */
function CoverFallback({ seed, name, compact }: { seed: string; name: string; compact?: boolean }) {
  const hue = [...seed].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 360, 7);

  return (
    <span
      className="flex h-full w-full items-center justify-center"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 45% 22%), hsl(${(hue + 40) % 360} 40% 14%))`,
      }}
      aria-hidden
    >
      <span
        className={`font-bold text-white/25 ${compact ? 'text-[15px]' : 'text-[40px]'}`}
        style={{ letterSpacing: '-0.03em' }}
      >
        {name.slice(0, 2).toUpperCase()}
      </span>
    </span>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-3 py-1.5 text-[13px] font-semibold transition-all duration-fast ease-out ${
        active
          ? 'bg-surface-overlay text-ink-primary'
          : 'text-ink-muted hover:bg-surface-raised hover:text-ink-secondary'
      }`}
    >
      {children}
    </button>
  );
}

function ViewButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: 'grid' | 'list';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`rounded-sm p-1.5 transition-all duration-fast ease-out ${
        active ? 'bg-surface-overlay text-ink-primary' : 'text-ink-muted hover:text-ink-secondary'
      }`}
    >
      <Icon name={icon} />
    </button>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="animate-rise rounded-xl border border-dashed border-surface-border px-6 py-20 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10 text-accent-40">
        <Icon name="image" className="h-6 w-6" />
      </span>

      <h2 className="mt-4 text-h3 text-ink-primary">Nenhum projeto ainda</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-[14px] leading-relaxed text-ink-secondary">
        Um projeto reúne as cenas, as referências e as imagens de uma mesma campanha.
      </p>

      <button
        type="button"
        onClick={onCreate}
        className="mt-5 rounded-md bg-accent px-5 py-2.5 text-[14px] font-bold text-white shadow-glow-sm transition-all duration-fast ease-out hover:bg-accent-80 hover:shadow-glow active:scale-[0.98]"
      >
        Criar o primeiro projeto
      </button>
    </div>
  );
}

function Centered({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <p className={`text-[14px] ${tone === 'error' ? 'text-state-error' : 'text-ink-muted'}`}>
        {children}
      </p>
    </main>
  );
}
