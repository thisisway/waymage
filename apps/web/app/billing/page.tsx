'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '../../components/ui/icons';
import { ApiError, api, queryKeys, type CreditTransaction } from '../../lib/api';
import { timeAgo } from '../../lib/format';

/**
 * Créditos: saldo, extrato e consumo.
 *
 * Cada tipo de transação ganha ícone e cor próprios porque o extrato só é útil se der para
 * varrer com o olho — "por que meu saldo caiu?" precisa de resposta na primeira passada, não
 * depois de ler doze linhas de texto igual.
 */

const TYPES: Record<string, { label: string; icon: IconName; tone: string }> = {
  PURCHASE: { label: 'Compra', icon: 'plus', tone: 'text-state-ok' },
  BONUS: { label: 'Bônus', icon: 'sparkles', tone: 'text-state-ok' },
  RESERVATION: { label: 'Reserva', icon: 'layers', tone: 'text-ink-secondary' },
  CAPTURE: { label: 'Cobrança', icon: 'check', tone: 'text-ink-muted' },
  RELEASE: { label: 'Devolução', icon: 'variation', tone: 'text-state-ok' },
  REFUND: { label: 'Reembolso', icon: 'variation', tone: 'text-state-ok' },
  ADMIN_ADJUSTMENT: { label: 'Ajuste', icon: 'refine', tone: 'text-state-warn' },
};

export default function BillingPage() {
  const router = useRouter();

  const wallet = useQuery({ queryKey: queryKeys.wallet, queryFn: () => api.wallet() });
  const transactions = useQuery({
    queryKey: queryKeys.transactions,
    queryFn: () => api.transactions(),
  });
  const usage = useQuery({ queryKey: queryKeys.usage, queryFn: () => api.usage() });

  const error = wallet.error ?? transactions.error;
  if (error instanceof ApiError && error.status === 401) {
    router.replace('/login');
    return null;
  }

  if (!wallet.data || !transactions.data) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-[14px] text-ink-muted">Carregando…</p>
      </main>
    );
  }

  const spent = (usage.data ?? []).reduce((total, entry) => total + entry.creditsCharged, 0);
  const images = (usage.data ?? []).reduce((total, entry) => total + entry.imagesProduced, 0);

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
        <span className="text-h3 text-ink-primary">Créditos</span>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 p-6">
        <section className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Disponível" value={wallet.data.balance} icon="credit" highlight />
          <Stat
            label="Reservado"
            value={wallet.data.reserved}
            icon="layers"
            hint="Preso em gerações em andamento. Volta ao saldo se a geração falhar."
          />
          <Stat label="Consumido" value={spent} icon="check" />
          <Stat label="Imagens" value={images} icon="image" />
        </section>

        <section>
          <h2 className="mb-3 text-label uppercase text-ink-muted">Extrato</h2>

          {transactions.data.length === 0 ? (
            <p className="rounded-lg border border-dashed border-surface-border px-6 py-10 text-center text-[14px] text-ink-muted">
              Nenhuma movimentação ainda.
            </p>
          ) : (
            <ul className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border bg-surface-raised">
              {transactions.data.map((transaction) => (
                <TransactionRow key={transaction.id} transaction={transaction} />
              ))}
            </ul>
          )}
        </section>

        <p className="flex gap-2.5 rounded-lg border border-accent/25 bg-accent/[0.06] px-4 py-3 text-[13px] leading-relaxed text-ink-secondary">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-accent-40" />
          <span>
            Cada geração reserva créditos antes de começar. Se ela falhar por um problema nosso ou
            do provedor, a reserva volta ao saldo automaticamente — você só paga pelo que recebeu.
          </span>
        </p>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  hint,
  highlight,
}: {
  label: string;
  value: number;
  icon: IconName;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      title={hint}
      className={`rounded-lg border p-4 transition-all duration-fast ease-out ${
        highlight
          ? 'border-accent/40 bg-accent/[0.08] shadow-glow-sm'
          : 'border-surface-border bg-surface-raised'
      }`}
    >
      <span
        className={`flex items-center gap-1.5 text-micro uppercase tracking-wide ${highlight ? 'text-accent-40' : 'text-ink-muted'}`}
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

function TransactionRow({ transaction }: { transaction: CreditTransaction }) {
  const type = TYPES[transaction.type] ?? {
    label: transaction.type,
    icon: 'info' as IconName,
    tone: 'text-ink-muted',
  };

  const positive = transaction.amount > 0;
  const neutral = transaction.amount === 0;

  return (
    <li className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-surface-overlay">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-overlay ${type.tone}`}
      >
        <Icon name={type.icon} className="h-4 w-4" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-ink-primary">{type.label}</span>
        <span className="mt-0.5 block truncate text-micro text-ink-muted">
          {timeAgo(transaction.createdAt)}
          {transaction.note ? ` · ${transaction.note}` : ''}
        </span>
      </span>

      <span className="shrink-0 text-right">
        <span
          className={`block font-mono text-[14px] font-semibold ${
            neutral ? 'text-ink-muted' : positive ? 'text-state-ok' : 'text-ink-primary'
          }`}
        >
          {/* Captura não move o disponível — ele já saiu na reserva. */}
          {neutral ? '—' : `${positive ? '+' : ''}${transaction.amount}`}
        </span>
        <span className="block text-micro text-ink-muted">saldo {transaction.balanceAfter}</span>
      </span>
    </li>
  );
}
