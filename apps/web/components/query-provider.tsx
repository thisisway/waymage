'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../lib/api';

/**
 * Estado remoto (projetos, cenas, versões) vive no TanStack Query; estado local do editor
 * vive no Zustand. A separação é do blueprint §23 e evita o erro clássico de copiar dado do
 * servidor para dentro de um store e ter duas fontes da verdade divergindo.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  // `useState` e não módulo global: em SSR, um client compartilhado vazaria cache de um
  // usuário para outro.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (failureCount, error) => {
              // 401 significa sessão expirada e 404 significa que não existe: repetir só
              // gasta request. Erro de rede, sim, vale tentar de novo.
              if (error instanceof ApiError && error.status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
