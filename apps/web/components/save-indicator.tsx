'use client';

import type { AutosaveState } from '../lib/use-autosave';

/**
 * Estado do autosave (blueprint §24).
 *
 * `aria-live="polite"` porque a mudança de estado é informação real — quem usa leitor de
 * tela precisa saber que o trabalho foi salvo sem ter de ir procurar o indicador.
 */
export function SaveIndicator({ state }: { state: AutosaveState }) {
  const { text, tone } = describe(state);

  return (
    <span
      aria-live="polite"
      className={`shrink-0 whitespace-nowrap text-xs ${tone}`}
      title={state.message ?? undefined}
    >
      {text}
    </span>
  );
}

function describe(state: AutosaveState): { text: string; tone: string } {
  switch (state.status) {
    case 'saving':
      return { text: 'salvando…', tone: 'text-ink-muted' };
    case 'dirty':
      return { text: 'alterações não salvas', tone: 'text-ink-muted' };
    case 'saved':
      return {
        text: state.savedAt
          ? `salvo às ${state.savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
          : 'salvo',
        tone: 'text-state-ok',
      };
    case 'conflict':
      return { text: 'conflito — recarregue', tone: 'text-state-warn' };
    case 'error':
      return { text: 'erro ao salvar', tone: 'text-state-error' };
    case 'idle':
      return { text: '', tone: '' };
  }
}
