'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, apiUrl, queryKeys, type GenerationProgress } from './api';

/**
 * Acompanha uma geração do clique até os resultados.
 *
 * O progresso vem por SSE porque o alternativo — perguntar de segundo em segundo — multiplica
 * consultas ao banco por cada aba aberta e ainda entrega a novidade com atraso. `EventSource`
 * ainda reconecta sozinho se a rede cair, o que um polling manual teria de reimplementar.
 */
export function useGeneration(sceneId: string) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const start = useMutation({
    // A chave é gerada por clique: reenviar a MESMA chave devolve o job existente, então
    // duplo clique não vira dois jobs.
    mutationFn: () => api.generate(sceneId, crypto.randomUUID()),
    onSuccess: (job) => {
      setJobId(job.id);
      setProgress({
        generationJobId: job.id,
        status: job.status,
        statusLabel: job.statusLabel,
        progress: job.progress,
        message: null,
        at: new Date().toISOString(),
      });
    },
  });

  const job = useQuery({
    queryKey: queryKeys.generation(jobId ?? ''),
    queryFn: () => api.getGeneration(jobId as string),
    enabled: jobId !== null,
  });

  const finish = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    void queryClient.invalidateQueries({ queryKey: queryKeys.generation(jobId ?? '') });
    void queryClient.invalidateQueries({ queryKey: queryKeys.generations(sceneId) });
  }, [jobId, queryClient, sceneId]);

  useEffect(() => {
    if (!jobId) return;

    // `withCredentials` é o que faz o cookie de sessão acompanhar o SSE — sem ele o guard
    // da API responde 401 e o stream nunca abre.
    const source = new EventSource(`${apiUrl()}/generation-jobs/${jobId}/events`, {
      withCredentials: true,
    });
    sourceRef.current = source;

    source.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as GenerationProgress;
      setProgress(event);
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(event.status)) finish();
    };

    // O servidor fecha o stream ao terminar, e o EventSource trata isso como erro. Buscar o
    // job resolve os dois casos: término normal e queda de verdade.
    source.onerror = () => {
      source.close();
      sourceRef.current = null;
      void queryClient.invalidateQueries({ queryKey: queryKeys.generation(jobId) });
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [jobId, finish, queryClient]);

  const cancel = useMutation({
    mutationFn: () => api.cancelGeneration(jobId as string),
    onSuccess: finish,
  });

  const running =
    start.isPending ||
    (progress !== null && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(progress.status));

  return {
    start: () => start.mutate(),
    /**
     * Acompanha um job criado em outro lugar — variação e refinamento nascem do card do
     * resultado, não do botão Gerar, mas o progresso é o mesmo e reusa este stream.
     */
    follow: (id: string) => {
      setJobId(id);
      setProgress(null);
    },
    cancel: () => cancel.mutate(),
    canCancel: jobId !== null && running && !start.isPending,
    running,
    progress,
    job: job.data ?? null,
    error:
      start.error instanceof ApiError
        ? start.error
        : start.error
          ? new ApiError('UNKNOWN', 'Não foi possível iniciar a geração.', 0)
          : null,
    reset: () => {
      setJobId(null);
      setProgress(null);
      start.reset();
    },
  };
}
