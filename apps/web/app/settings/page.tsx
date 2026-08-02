'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../../components/ui/controls';
import { Icon, Spinner } from '../../components/ui/icons';
import { toast } from '../../components/ui/toast';
import { UserMenu } from '../../components/user-menu';
import { ApiError, api, queryKeys, type CredentialProvider } from '../../lib/api';
import { timeAgo } from '../../lib/format';

/**
 * Chaves de API do usuário.
 *
 * A conta de nuvem é dele, e a fatura também. Esta tela existe para tornar isso explícito: o
 * que o Waymage cobra é o acesso ao editor; o que o fornecedor cobra é a geração, direto de
 * quem gerou.
 *
 * O valor de uma chave salva **nunca volta do servidor** — nem para quem a cadastrou. O que
 * aparece são os quatro últimos caracteres, o bastante para reconhecer qual está ali.
 */
export default function SettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const session = useQuery({ queryKey: queryKeys.session, queryFn: () => api.me() });
  const catalog = useQuery({
    queryKey: queryKeys.providerCatalog,
    queryFn: () => api.providerCatalog(),
  });
  const credentials = useQuery({
    queryKey: queryKeys.credentials,
    queryFn: () => api.credentials(),
  });

  if (session.error instanceof ApiError && session.error.status === 401) {
    router.replace('/login');
    return null;
  }

  if (!catalog.data || !credentials.data) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-[14px] text-ink-muted">Carregando…</p>
      </main>
    );
  }

  const saved = new Map(credentials.data.map((entry) => [entry.provider, entry]));

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
        <span className="text-h3 text-ink-primary">Chaves de IA</span>
        <div className="ml-auto">
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 p-6">
        <p className="flex gap-2.5 rounded-lg border border-accent/25 bg-accent/[0.06] px-4 py-3 text-[13px] leading-relaxed text-ink-secondary">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-accent-40" />
          <span>
            A geração usa a <strong className="text-ink-primary">sua</strong> chave e é cobrada
            direto pelo fornecedor. O Waymage não intermedeia esse consumo — sem uma chave
            cadastrada, não há como gerar.
          </span>
        </p>

        {catalog.data.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            saved={saved.get(provider.id)}
            onChanged={() => queryClient.invalidateQueries({ queryKey: queryKeys.credentials })}
          />
        ))}

        <p className="flex gap-2.5 rounded-lg border border-surface-border px-4 py-3 text-micro leading-relaxed text-ink-muted">
          <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            A chave é cifrada antes de ser gravada e nunca volta do servidor — nem para você. Se
            precisar consultá-la, use o painel do fornecedor; aqui só dá para substituir ou remover.
          </span>
        </p>
      </main>
    </div>
  );
}

function ProviderCard({
  provider,
  saved,
  onChanged,
}: {
  provider: CredentialProvider;
  saved: { hint: string; createdAt: string; lastUsedAt: string | null } | undefined;
  onChanged: () => void;
}) {
  const [secret, setSecret] = useState('');
  // Trocar é uma ação deliberada: o campo só aparece quando pedido, para ninguém sobrescrever
  // uma chave que está funcionando por ter clicado no lugar errado.
  const [editing, setEditing] = useState(false);

  const save = useMutation({
    mutationFn: () => api.saveCredential(provider.id, secret.trim()),
    onSuccess: () => {
      setSecret('');
      setEditing(false);
      toast.success(`Chave do ${provider.label} salva`);
      onChanged();
    },
    onError: (caught) =>
      toast.error(caught instanceof ApiError ? caught.message : 'Não foi possível salvar a chave.'),
  });

  const revoke = useMutation({
    mutationFn: () => api.revokeCredential(provider.id),
    onSuccess: () => {
      toast.success(`Chave do ${provider.label} removida`);
      onChanged();
    },
    onError: (caught) =>
      toast.error(
        caught instanceof ApiError ? caught.message : 'Não foi possível remover a chave.',
      ),
  });

  const showForm = editing || !saved;

  return (
    <section className="rounded-lg border border-surface-border bg-surface-raised p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-overlay text-accent-40">
          <Icon name="key" />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-ink-primary">{provider.label}</h2>

          {saved ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-micro text-ink-muted">
              <span className="rounded-sm bg-surface-overlay px-1.5 py-0.5 font-mono text-ink-secondary">
                ····{saved.hint}
              </span>
              <span>cadastrada {timeAgo(saved.createdAt)}</span>
              <span>
                · {saved.lastUsedAt ? `usada ${timeAgo(saved.lastUsedAt)}` : 'ainda não utilizada'}
              </span>
            </p>
          ) : (
            <p className="mt-0.5 text-micro text-ink-muted">Nenhuma chave cadastrada.</p>
          )}
        </div>

        {saved && !editing && (
          <div className="flex shrink-0 gap-1.5">
            <SmallButton onClick={() => setEditing(true)}>substituir</SmallButton>
            <SmallButton onClick={() => revoke.mutate()} disabled={revoke.isPending} danger>
              remover
            </SmallButton>
          </div>
        )}
      </div>

      {showForm && (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="mb-1.5 block text-label uppercase text-ink-muted">Chave de API</span>
            <input
              type="password"
              value={secret}
              autoComplete="off"
              spellCheck={false}
              placeholder={provider.keyPrefix ? `${provider.keyPrefix}…` : 'cole a chave aqui'}
              onChange={(event) => setSecret(event.target.value)}
              className="w-full rounded-md border border-surface-border bg-surface-overlay px-3 py-2.5 font-mono text-[13px] text-ink-primary outline-none transition-all duration-fast ease-out placeholder:font-sans placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/25"
            />
          </label>

          {provider.requirement && (
            <p className="flex gap-2 rounded-md border border-state-warn/25 bg-state-warn/[0.06] px-3 py-2 text-micro leading-relaxed text-ink-secondary">
              <Icon name="warning" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-state-warn" />
              <span>{provider.requirement}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => save.mutate()}
              disabled={secret.trim().length < 8 || save.isPending}
            >
              {save.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="check" />}
              {saved ? 'Substituir' : 'Salvar'}
            </Button>

            {saved && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setSecret('');
                }}
              >
                Cancelar
              </Button>
            )}

            <a
              href={provider.helpUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="ml-auto text-micro text-accent-40 underline-offset-2 hover:underline"
            >
              onde obter a chave
            </a>
          </div>
        </div>
      )}
    </section>
  );
}

function SmallButton({
  children,
  danger,
  ...props
}: { danger?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-md border border-surface-border px-2.5 py-1.5 text-micro font-semibold transition-all duration-fast ease-out active:scale-[0.96] disabled:opacity-40 ${
        danger
          ? 'text-ink-muted hover:border-state-error/50 hover:text-state-error'
          : 'text-ink-secondary hover:border-accent-40/60 hover:text-ink-primary'
      }`}
    >
      {children}
    </button>
  );
}
