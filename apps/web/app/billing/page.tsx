'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ApiError, api, queryKeys, type CreditTransaction } from '../../lib/api';

/** Rótulos dos tipos de transação. Os valores são contrato e ficam em inglês no banco. */
const TYPE_LABELS: Record<string, string> = {
  PURCHASE: 'Compra',
  BONUS: 'Bônus',
  RESERVATION: 'Reserva',
  CAPTURE: 'Cobrança',
  RELEASE: 'Devolução',
  REFUND: 'Reembolso',
  ADMIN_ADJUSTMENT: 'Ajuste',
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
        <p className="text-sm text-ink-muted">Carregando…</p>
      </main>
    );
  }

  const spent = (usage.data ?? []).reduce((total, entry) => total + entry.creditsCharged, 0);
  const images = (usage.data ?? []).reduce((total, entry) => total + entry.imagesProduced, 0);

  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-3 border-b border-surface-border bg-surface-raised px-6 py-3">
        <a href="/projects" className="text-xs text-ink-muted hover:text-ink-secondary">
          ← projetos
        </a>
        <span className="text-sm font-medium">Créditos</span>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 p-6">
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Disponível" value={wallet.data.balance} tone="primary" />
          <Stat
            label="Reservado"
            value={wallet.data.reserved}
            hint="Preso em gerações em andamento. Volta ao saldo se a geração falhar."
          />
          <Stat label="Consumido" value={spent} />
          <Stat label="Imagens geradas" value={images} />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium">Extrato</h2>
          {transactions.data.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhuma movimentação ainda.</p>
          ) : (
            <ul className="divide-y divide-surface-border rounded-md border border-surface-border">
              {transactions.data.map((transaction) => (
                <TransactionRow key={transaction.id} transaction={transaction} />
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs leading-relaxed text-ink-muted">
          Cada geração reserva créditos antes de começar. Se ela falhar por um problema nosso ou do
          provedor, a reserva volta ao saldo automaticamente — você só paga pelo que recebeu.
        </p>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'primary';
}) {
  return (
    <div className="rounded-md border border-surface-border bg-surface-raised p-3" title={hint}>
      <div className="text-xs text-ink-muted">{label}</div>
      <div
        className={`mt-1 font-mono text-xl ${tone === 'primary' ? 'text-accent' : 'text-ink-primary'}`}
      >
        {value}
      </div>
    </div>
  );
}

function TransactionRow({ transaction }: { transaction: CreditTransaction }) {
  const positive = transaction.amount > 0;
  const neutral = transaction.amount === 0;

  return (
    <li className="flex items-center justify-between px-4 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="text-ink-secondary">
          {TYPE_LABELS[transaction.type] ?? transaction.type}
        </div>
        <div className="mt-0.5 text-xs text-ink-muted">
          {new Date(transaction.createdAt).toLocaleString('pt-BR')}
          {transaction.note ? ` · ${transaction.note}` : ''}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div
          className={`font-mono ${
            neutral ? 'text-ink-muted' : positive ? 'text-state-ok' : 'text-ink-primary'
          }`}
        >
          {/* Captura não move o disponível — ele já saiu na reserva. */}
          {neutral ? '—' : `${positive ? '+' : ''}${transaction.amount}`}
        </div>
        <div className="text-xs text-ink-muted">saldo {transaction.balanceAfter}</div>
      </div>
    </li>
  );
}
