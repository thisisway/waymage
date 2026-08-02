'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon, Spinner } from '../../components/ui/icons';
import { toast } from '../../components/ui/toast';
import { UserMenu } from '../../components/user-menu';
import { ApiError, api, queryKeys, type AdminWorkspace, type Subscription } from '../../lib/api';
import { timeAgo } from '../../lib/format';

/**
 * Painel da plataforma.
 *
 * Mostra **quem está usando e quem está em dia** — nada do que as pessoas criaram. Nome de
 * projeto, cena e imagem ficam de fora de propósito: operar não exige ver o trabalho alheio, e
 * o produto guarda imagem de gente.
 *
 * A proteção real é o guard da API; esta tela só existe para quem já tem a permissão.
 */
export default function AdminPage() {
  const router = useRouter();

  const overview = useQuery({
    queryKey: queryKeys.adminOverview,
    queryFn: () => api.adminOverview(),
  });
  const workspaces = useQuery({
    queryKey: queryKeys.adminWorkspaces,
    queryFn: () => api.adminWorkspaces(),
  });

  const error = overview.error ?? workspaces.error;

  if (error instanceof ApiError && error.status === 401) {
    router.replace('/login');
    return null;
  }

  if (error instanceof ApiError && error.status === 403) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-[14px] text-ink-muted">Você não tem acesso a esta área.</p>
      </main>
    );
  }

  if (!overview.data || !workspaces.data) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-[14px] text-ink-muted">Carregando…</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-surface-border bg-surface-base/95 px-6 py-3 backdrop-blur">
        <a
          href="/projects"
          aria-label="Voltar aos projetos"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-all duration-fast ease-out hover:bg-surface-overlay hover:text-ink-primary"
        >
          <Icon name="chevronLeft" />
        </a>
        <span className="text-h3 text-ink-primary">Painel da plataforma</span>
        <div className="ml-auto">
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <section className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Workspaces" value={overview.data.workspaces} icon="folder" />
          <Stat
            label="Assinantes"
            value={overview.data.activeSubscriptions}
            icon="check"
            highlight
          />
          <Stat label="Em avaliação" value={overview.data.trialing} icon="info" />
          <Stat label="Imagens (30d)" value={overview.data.imagesLast30Days} icon="image" />
        </section>

        <section>
          <h2 className="mb-3 text-label uppercase text-ink-muted">Workspaces</h2>

          <div className="overflow-x-auto rounded-lg border border-surface-border">
            <table className="w-full min-w-[820px] text-left text-[13px]">
              <thead className="bg-surface-overlay text-micro uppercase tracking-wide text-ink-muted">
                <tr>
                  {['Workspace', 'Dono', 'Assinatura', 'Chaves', 'Imagens', 'Criado', ''].map(
                    (header) => (
                      <th key={header} className="px-3 py-2 font-semibold">
                        {header}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border bg-surface-raised">
                {workspaces.data.map((workspace) => (
                  <Row key={workspace.id} workspace={workspace} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="flex gap-2.5 rounded-lg border border-surface-border px-4 py-3 text-micro leading-relaxed text-ink-muted">
          <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Este painel não mostra projetos, cenas nem imagens — só uso e assinatura. Alterar uma
            assinatura fica registrado na auditoria do workspace afetado, visível para o dono dele.
          </span>
        </p>
      </main>
    </div>
  );
}

const STATUS_LABEL: Record<Subscription['status'], { text: string; tone: string }> = {
  ACTIVE: { text: 'ativa', tone: 'text-state-ok' },
  TRIALING: { text: 'avaliação', tone: 'text-accent-40' },
  PAST_DUE: { text: 'pagamento pendente', tone: 'text-state-warn' },
  CANCELED: { text: 'cancelada', tone: 'text-state-error' },
};

function Row({ workspace }: { workspace: AdminWorkspace }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<Subscription['status'] | null>(null);

  const setSubscription = useMutation({
    mutationFn: (status: Subscription['status']) => {
      // Trinta dias para quem é ativado, e nada para quem é cancelado: o campo de data só faz
      // sentido enquanto há prazo a respeitar.
      const until =
        status === 'ACTIVE' || status === 'TRIALING'
          ? new Date(Date.now() + 30 * 86_400_000).toISOString()
          : null;

      return api.adminSetSubscription(workspace.id, { status, until });
    },
    onSuccess: (_, status) => {
      toast.success(`Assinatura marcada como ${STATUS_LABEL[status].text}`);
      return queryClient.invalidateQueries({ queryKey: queryKeys.adminWorkspaces });
    },
    onError: (caught) =>
      toast.error(caught instanceof ApiError ? caught.message : 'Não foi possível alterar.'),
    onSettled: () => setBusy(null),
  });

  const status = STATUS_LABEL[workspace.subscription.status];

  return (
    <tr className="transition-colors duration-fast hover:bg-surface-overlay">
      <td className="px-3 py-2.5 font-semibold text-ink-primary">{workspace.name}</td>
      <td className="px-3 py-2.5 text-ink-secondary">
        {workspace.owner ? (
          <>
            <span className="block">{workspace.owner.name}</span>
            <span className="block text-micro text-ink-muted">{workspace.owner.email}</span>
          </>
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span className={`font-semibold ${status.tone}`}>{status.text}</span>
        {workspace.subscription.trialDaysLeft !== null && (
          <span className="block text-micro text-ink-muted">
            {workspace.subscription.trialDaysLeft} dias
          </span>
        )}
        {!workspace.subscription.active && (
          <span className="block text-micro text-state-error">bloqueado</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-micro text-ink-muted">
        {workspace.providers.length > 0 ? workspace.providers.join(', ') : 'nenhuma'}
      </td>
      <td className="px-3 py-2.5 font-mono text-ink-secondary">{workspace.imagesGenerated}</td>
      <td className="px-3 py-2.5 text-micro text-ink-muted">{timeAgo(workspace.createdAt)}</td>
      <td className="px-3 py-2.5">
        <div className="flex justify-end gap-1.5">
          {(['ACTIVE', 'CANCELED'] as const).map((next) => (
            <button
              key={next}
              type="button"
              disabled={setSubscription.isPending}
              onClick={() => {
                setBusy(next);
                setSubscription.mutate(next);
              }}
              className={`rounded-md border px-2 py-1 text-micro font-semibold transition-all duration-fast ease-out active:scale-[0.96] disabled:opacity-40 ${
                next === 'ACTIVE'
                  ? 'border-surface-border text-ink-secondary hover:border-state-ok/50 hover:text-state-ok'
                  : 'border-surface-border text-ink-muted hover:border-state-error/50 hover:text-state-error'
              }`}
            >
              {busy === next && setSubscription.isPending ? (
                <Spinner className="h-3 w-3" />
              ) : next === 'ACTIVE' ? (
                'ativar'
              ) : (
                'cancelar'
              )}
            </button>
          ))}
        </div>
      </td>
    </tr>
  );
}

function Stat({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: number;
  icon: 'folder' | 'check' | 'info' | 'image';
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        highlight
          ? 'border-accent/40 bg-accent/[0.08] shadow-glow-sm'
          : 'border-surface-border bg-surface-raised'
      }`}
    >
      <span
        className={`flex items-center gap-1.5 text-micro uppercase tracking-wide ${
          highlight ? 'text-accent-40' : 'text-ink-muted'
        }`}
      >
        <Icon name={icon} className="h-3.5 w-3.5" />
        {label}
      </span>
      <span
        className={`mt-2 block font-mono text-h2 ${highlight ? 'text-accent-40' : 'text-ink-primary'}`}
      >
        {value}
      </span>
    </div>
  );
}
