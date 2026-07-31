'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { Icon, type IconName } from './icons';

/**
 * Confirmação de ações.
 *
 * Existe porque várias operações aconteciam em silêncio: criar uma versão, excluir uma
 * referência, escolher um resultado. O usuário clicava e nada respondia — a única forma de
 * saber se funcionou era procurar a mudança na tela.
 *
 * Aparece no canto inferior, some sozinho e nunca bloqueia: confirmação não é decisão, e
 * exigir clique para dispensar transformaria um aviso em obstáculo.
 */

export type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (tone: ToastTone, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 0;

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (tone, message) =>
    set((state) => ({
      // Teto de três: uma pilha maior cobre a interface e deixa de ser aviso.
      toasts: [...state.toasts, { id: ++nextId, tone, message }].slice(-3),
    })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** `toast.success('Versão criada')` de qualquer componente, sem prop drilling. */
export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
};

const TONE: Record<ToastTone, { icon: IconName; className: string }> = {
  success: { icon: 'success', className: 'border-state-ok/40 text-state-ok' },
  error: { icon: 'error', className: 'border-state-error/40 text-state-error' },
  info: { icon: 'info', className: 'border-accent/40 text-accent-40' },
};

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);

  return (
    <div
      // `polite` e não `assertive`: confirmação não deve interromper o que o leitor de tela
      // está anunciando no momento.
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4"
    >
      {toasts.map((item) => (
        <ToastItem key={item.id} toast={item} />
      ))}
    </div>
  );
}

function ToastItem({ toast: item }: { toast: Toast }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const tone = TONE[item.tone];

  useEffect(() => {
    // Erro fica mais tempo: costuma trazer informação que a pessoa precisa ler.
    const timer = setTimeout(() => dismiss(item.id), item.tone === 'error' ? 6000 : 3500);
    return () => clearTimeout(timer);
  }, [item.id, item.tone, dismiss]);

  return (
    <div
      className={`animate-rise pointer-events-auto flex items-center gap-2.5 rounded-lg border bg-surface-raised px-3.5 py-2.5 shadow-lg ${tone.className}`}
    >
      <Icon name={tone.icon} className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-[13px] leading-snug text-ink-primary">{item.message}</span>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="Dispensar"
        className="shrink-0 text-ink-muted transition-colors hover:text-ink-primary"
      >
        <Icon name="close" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
