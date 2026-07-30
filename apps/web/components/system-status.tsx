'use client';

import { useEffect, useState } from 'react';
import { API_URL, fetchHealth, type HealthReport } from '../lib/api';

type State =
  { kind: 'loading' } | { kind: 'ready'; report: HealthReport } | { kind: 'unreachable' };

/**
 * Estado das dependências, no rodapé do editor.
 *
 * Existe na Fase 1 porque é a forma mais direta de responder "o ambiente está de pé?" sem
 * abrir terminal. Vira o indicador de conexão do editor quando houver SSE.
 */
export function SystemStatus() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    const load = () =>
      fetchHealth()
        .then((report) => active && setState({ kind: 'ready', report }))
        .catch(() => active && setState({ kind: 'unreachable' }));

    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (state.kind === 'loading') {
    return <span className="text-xs text-ink-muted">verificando serviços…</span>;
  }

  if (state.kind === 'unreachable') {
    return (
      <span className="text-xs text-state-error">
        API inacessível em {API_URL} — rode <code className="font-mono">pnpm dev</code>
      </span>
    );
  }

  return (
    <div className="flex items-center gap-4 text-xs">
      {state.report.dependencies.map((dep) => (
        <span key={dep.name} className="flex items-center gap-1.5 text-ink-secondary">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${dep.state === 'ok' ? 'bg-state-ok' : 'bg-state-error'}`}
          />
          {dep.name}
          <span className="sr-only">{dep.state === 'ok' ? 'operacional' : 'fora do ar'}</span>
          <span className="text-ink-muted">{dep.latencyMs}ms</span>
        </span>
      ))}
    </div>
  );
}
