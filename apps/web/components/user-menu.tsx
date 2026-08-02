'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, queryKeys } from '../lib/api';
import { Icon } from './ui/icons';

/**
 * Conta e configurações, no canto superior direito.
 *
 * Reúne o que estava espalhado no cabeçalho — e-mail solto, link de chaves, botão de sair —
 * num lugar só. Cabeçalho é o espaço mais disputado da tela: cada item permanente ali cobra
 * atenção de quem só queria ver os projetos.
 *
 * O menu lista **apenas o que existe**. Notificações e novidades entram quando houver o que
 * notificar; tema claro, quando houver tema claro. Entrada que não leva a lugar nenhum é
 * pior do que entrada ausente: ela promete e não cumpre.
 */
export function UserMenu() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const session = useQuery({ queryKey: queryKeys.session, queryFn: () => api.me() });

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    // `pointerdown` e não `click`: fechar no clique deixaria o menu aberto durante o arrasto
    // de uma seleção que começou fora dele.
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const user = session.data?.user;
  if (!user) return null;

  async function handleLogout() {
    await api.logout().catch(() => undefined);
    // Limpa o cache antes de navegar: sem isso a próxima conta a entrar veria, por um
    // instante, os projetos da anterior.
    queryClient.clear();
    router.replace('/login');
  }

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Conta e configurações"
        className={`flex h-8 w-8 items-center justify-center rounded-pill text-[11px] font-bold uppercase transition-all duration-fast ease-out active:scale-[0.94] ${
          open
            ? 'bg-accent text-white shadow-glow-sm'
            : 'bg-surface-overlay text-ink-secondary hover:bg-surface-hover hover:text-ink-primary'
        }`}
      >
        {initials(user.name || user.email)}
      </button>

      {open && (
        <div
          role="menu"
          className="animate-rise absolute right-0 top-10 z-50 w-60 overflow-hidden rounded-lg border border-surface-border bg-surface-raised shadow-lg"
        >
          <div className="border-b border-surface-border px-3 py-2.5">
            <p className="truncate text-[13px] font-semibold text-ink-primary">{user.name}</p>
            <p className="truncate text-micro text-ink-muted">{user.email}</p>
          </div>

          <div className="p-1">
            <MenuLink href="/settings" icon="key">
              Chaves de IA
            </MenuLink>

            {/* Só para quem é administrador da plataforma. Esconder não é a proteção — o
                guard da API é —, mas oferecer uma porta que responde 403 seria ruído. */}
            {user.isPlatformAdmin && (
              <MenuLink href="/admin" icon="grid">
                Painel da plataforma
              </MenuLink>
            )}
          </div>

          <div className="border-t border-surface-border p-1">
            <MenuButton onClick={handleLogout} icon="logout" danger>
              Sair
            </MenuButton>
          </div>
        </div>
      )}
    </div>
  );
}

/** Iniciais para o avatar. Duas quando há sobrenome, uma quando só há o e-mail. */
function initials(source: string): string {
  const parts = source
    .trim()
    .split(/[\s@.]+/)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[1]?.[0] ?? '') : '';
  return `${first}${second}`;
}

const ITEM =
  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors duration-fast';

function MenuLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: 'key' | 'grid';
  children: React.ReactNode;
}) {
  return (
    <a
      role="menuitem"
      href={href}
      className={`${ITEM} text-ink-secondary hover:bg-surface-overlay hover:text-ink-primary`}
    >
      <Icon name={icon} className="h-4 w-4 shrink-0 text-ink-muted" />
      {children}
    </a>
  );
}

function MenuButton({
  onClick,
  icon,
  danger,
  children,
}: {
  onClick: () => void;
  icon: 'logout';
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`${ITEM} ${
        danger
          ? 'text-ink-secondary hover:bg-state-error/10 hover:text-state-error'
          : 'text-ink-secondary hover:bg-surface-overlay hover:text-ink-primary'
      }`}
    >
      <Icon name={icon} className="h-4 w-4 shrink-0 text-ink-muted" />
      {children}
    </button>
  );
}
