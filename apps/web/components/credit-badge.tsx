'use client';

import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '../lib/api';

/**
 * Saldo na topbar do editor.
 *
 * Mostra o reservado separado do disponível: sem essa distinção, o usuário vê o saldo cair
 * ao gerar e não entende que aquilo volta se a geração falhar.
 */
export function CreditBadge() {
  const wallet = useQuery({
    queryKey: queryKeys.wallet,
    queryFn: () => api.wallet(),
    // O worker altera o saldo por fora; revalidar ao voltar para a aba mantém o número honesto.
    refetchOnWindowFocus: true,
  });

  if (!wallet.data) return null;

  return (
    <a href="/billing" className="text-ink-secondary hover:text-ink-primary">
      créditos <span className="font-mono text-ink-primary">{wallet.data.balance}</span>
      {wallet.data.reserved > 0 && (
        <span className="ml-1 text-ink-muted" title="Reservado em gerações em andamento">
          (+{wallet.data.reserved} reservados)
        </span>
      )}
    </a>
  );
}
