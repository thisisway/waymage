'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { SceneSpec } from '@waymage/scene-spec';
import { ApiError, api, type ExportJob, type GenerationResult } from '../lib/api';
import { MaskEditor } from './mask-editor';
import { Icon } from './ui/icons';
import { toast } from './ui/toast';

/**
 * Ações sobre um resultado (blueprint §22, "Depois").
 *
 * Variar, refinar e exportar são operações distintas sobre a mesma imagem, e a diferença
 * entre elas precisa ficar clara no próprio botão — "variar" gasta crédito de novo, "exportar"
 * não.
 */
export function ResultActions({
  result,
  projectId,
  locks,
  onDerive,
}: {
  result: GenerationResult;
  projectId: string;
  locks: SceneSpec['locks'];
  /** Chamado quando uma derivação é criada, para o editor acompanhá-la. */
  onDerive: (jobId: string) => void;
}) {
  const resultId = result.id;
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const variation = useMutation({
    mutationFn: () => api.variation(resultId, crypto.randomUUID()),
    onSuccess: (job) => {
      toast.info('Variação na fila');
      onDerive(job.id);
    },
    onError: (caught) => setError(message(caught)),
  });

  const refine = useMutation({
    mutationFn: () => api.refine(resultId, crypto.randomUUID()),
    onSuccess: (job) => {
      toast.info('Refinamento na fila');
      onDerive(job.id);
    },
    onError: (caught) => setError(message(caught)),
  });

  const busy = variation.isPending || refine.isPending;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        <ActionButton
          onClick={() => variation.mutate()}
          disabled={busy}
          title="Mesma cena, outra saída. Consome créditos."
        >
          <Icon name="variation" className="h-3.5 w-3.5" />
          {variation.isPending ? 'variando…' : 'variar'}
        </ActionButton>

        <ActionButton
          onClick={() => refine.mutate()}
          disabled={busy}
          title="Mesma imagem em qualidade final. Consome créditos."
        >
          <Icon name="refine" className="h-3.5 w-3.5" />
          {refine.isPending ? 'refinando…' : 'refinar'}
        </ActionButton>

        <ActionButton
          onClick={() => setEditing(true)}
          disabled={busy || !result.url}
          title="Pintar uma região e descrever a mudança. Consome créditos."
        >
          <Icon name="brush" className="h-3.5 w-3.5" />
          editar
        </ActionButton>

        <ExportButton resultIds={[resultId]} />
      </div>

      {error && (
        <p role="alert" className="text-xs text-state-error">
          {error}
        </p>
      )}

      {editing && result.url && (
        <MaskEditor
          resultId={resultId}
          projectId={projectId}
          imageUrl={result.url}
          width={result.width}
          height={result.height}
          locks={locks}
          onClose={() => setEditing(false)}
          onSubmit={onDerive}
        />
      )}
    </div>
  );
}

/**
 * Exportação: pede a conversão e espera o worker terminar.
 *
 * Faz polling em vez de SSE porque a conversão leva menos de um segundo — abrir um stream
 * para isso custaria mais do que a operação inteira.
 */
export function ExportButton({ resultIds }: { resultIds: string[] }) {
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [error, setError] = useState<string | null>(null);

  const exportJob = useMutation({
    mutationFn: async () => {
      const created = await api.createExport(resultIds, format);

      for (let attempt = 0; attempt < 30; attempt++) {
        const current = await api.getExport(created.id);
        if (current.status === 'READY') return current;
        if (current.status === 'FAILED') {
          throw new ApiError('EXPORT_FAILED', current.errorMessage ?? 'Falha ao exportar.', 500);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      throw new ApiError('EXPORT_TIMEOUT', 'A exportação demorou demais.', 504);
    },
    onSuccess: (job) => {
      download(job);
      toast.success(
        job.files.length === 1 ? 'Arquivo baixado' : `${job.files.length} arquivos baixados`,
      );
    },
    onError: (caught) => setError(message(caught)),
  });

  return (
    <>
      <select
        value={format}
        aria-label="Formato de exportação"
        onChange={(e) => setFormat(e.target.value as 'png' | 'jpeg' | 'webp')}
        className="rounded border border-surface-border bg-surface-overlay px-1.5 py-1 text-xs text-ink-secondary"
      >
        <option value="png">PNG</option>
        <option value="jpeg">JPEG</option>
        <option value="webp">WebP</option>
      </select>

      <ActionButton
        onClick={() => {
          setError(null);
          exportJob.mutate();
        }}
        disabled={exportJob.isPending}
        title="Baixa o arquivo. Não consome créditos."
      >
        <Icon name="download" className="h-3.5 w-3.5" />
        {exportJob.isPending ? 'preparando…' : 'exportar'}
      </ActionButton>

      {error && (
        <p role="alert" className="w-full text-xs text-state-error">
          {error}
        </p>
      )}
    </>
  );
}

/** Dispara o download de cada arquivo. A URL já vem com `Content-Disposition: attachment`. */
function download(job: ExportJob): void {
  for (const file of job.files) {
    const link = document.createElement('a');
    link.href = file.downloadUrl;
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

function ActionButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="flex items-center gap-1.5 rounded-md border border-surface-border px-2.5 py-1.5 text-micro font-semibold text-ink-secondary transition-all duration-fast ease-out hover:border-accent-40/60 hover:text-ink-primary active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function message(caught: unknown): string {
  if (caught instanceof ApiError) {
    return caught.code === 'GENERATION_INSUFFICIENT_CREDITS'
      ? 'Créditos insuficientes para esta operação.'
      : caught.message;
  }
  return 'Não foi possível completar a operação.';
}
