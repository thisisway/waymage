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
 *
 * **Mas o SSE não é a única fonte.** Ele atravessa um proxy reverso que não controlamos, e
 * proxy que bufferiza resposta em streaming segura os eventos até o fim — a geração termina e
 * a tela continua dizendo "na fila". Aconteceu em produção: a fila já estava vazia e o
 * usuário via a barra parada.
 *
 * Por isso há uma consulta periódica enquanto o job não termina. Ela é o piso: se o SSE
 * funcionar, a atualização chega antes e a consulta só confirma; se não funcionar, a tela
 * ainda anda. O custo é uma requisição a cada poucos segundos, e só durante a geração.
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
    /**
     * Consulta periódica enquanto o job estiver em voo.
     *
     * Três segundos: rápido o bastante para não parecer travado, espaçado o bastante para não
     * pesar. Para sozinha quando o job chega a um estado terminal — `false` desliga o
     * intervalo, e nada fica consultando um job concluído para sempre.
     */
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return 3000;
      return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) ? false : 3000;
    },
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

    // Sem evento nenhum em vinte segundos, o stream não está entregando — proxy bufferizando,
    // quase sempre. Fecha e deixa a consulta periódica assumir, em vez de manter aberta uma
    // conexão que não traz nada.
    const silence = setTimeout(() => {
      if (sourceRef.current === source) {
        source.close();
        sourceRef.current = null;
      }
    }, 20_000);

    // O servidor fecha o stream ao terminar, e o EventSource trata isso como erro. Buscar o
    // job resolve os dois casos: término normal e queda de verdade.
    source.onerror = () => {
      source.close();
      sourceRef.current = null;
      void queryClient.invalidateQueries({ queryKey: queryKeys.generation(jobId) });
    };

    return () => {
      clearTimeout(silence);
      source.close();
      sourceRef.current = null;
    };
  }, [jobId, finish, queryClient]);

  const cancel = useMutation({
    mutationFn: () => api.cancelGeneration(jobId as string),
    onSuccess: finish,
  });

  /**
   * O progresso que a tela mostra: o mais adiantado entre o SSE e a consulta.
   *
   * As duas fontes existem porque nenhuma é confiável sozinha — o SSE pode ficar preso num
   * proxy, e a consulta chega com até três segundos de atraso. Escolher a mais adiantada faz
   * a barra andar pela primeira que responder, sem nunca voltar atrás.
   *
   * Sem isto, a consulta periódica atualizaria os RESULTADOS e deixaria a barra parada — que
   * é exatamente o sintoma que ela veio resolver.
   */
  const fromJob: GenerationProgress | null = job.data
    ? {
        generationJobId: job.data.id,
        status: job.data.status,
        statusLabel: job.data.statusLabel,
        progress: job.data.progress,
        message: job.data.errorMessage,
        at: new Date().toISOString(),
      }
    : null;

  const current = mostAdvanced(progress, fromJob);

  const running =
    start.isPending ||
    (current !== null && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(current.status));

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
    progress: current,
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

/** Estado terminal ganha de tudo; entre os demais, vence o de maior progresso. */
function mostAdvanced(
  a: GenerationProgress | null,
  b: GenerationProgress | null,
): GenerationProgress | null {
  if (!a) return b;
  if (!b) return a;

  const terminal = (state: GenerationProgress) =>
    ['COMPLETED', 'FAILED', 'CANCELLED'].includes(state.status);

  if (terminal(a) !== terminal(b)) return terminal(a) ? a : b;
  return a.progress >= b.progress ? a : b;
}
