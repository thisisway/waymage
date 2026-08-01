'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { referenceRoleSchema, type SceneReference, type SceneSpec } from '@waymage/scene-spec';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api, queryKeys, uploadAsset, type Asset } from '../lib/api';
import { Icon } from './ui/icons';
import { toast } from './ui/toast';

/**
 * Biblioteca de referências (blueprint §5.1, painel esquerdo).
 *
 * Cada referência tem função e peso explícitos: o mesmo rosto pode servir para preservar
 * identidade ou só para sugerir iluminação, e o compilador precisa saber qual das duas.
 */

const ROLE_LABELS: Record<string, string> = {
  identity: 'Identidade',
  face: 'Rosto',
  body: 'Corpo',
  wardrobe: 'Roupa',
  product: 'Produto',
  scene: 'Cenário',
  style: 'Estilo',
  pose: 'Pose',
  palette: 'Paleta',
  logo: 'Logotipo',
};

export function LibraryPanel({
  projectId,
  spec,
  onChange,
}: {
  projectId: string;
  spec: SceneSpec;
  onChange: (spec: SceneSpec) => void;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const assets = useQuery({
    queryKey: queryKeys.assets(projectId),
    queryFn: () => api.listAssets(projectId),
    // Enquanto houver asset em processamento, o worker ainda está gerando a miniatura.
    // Parar de perguntar quando todos estiverem prontos evita polling eterno.
    refetchInterval: (query) =>
      query.state.data?.some((asset) => asset.status === 'PROCESSING') ? 2000 : false,
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadAsset(projectId, file),
    onSuccess: () => {
      toast.success('Referência enviada');
      return queryClient.invalidateQueries({ queryKey: queryKeys.assets(projectId) });
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Falha inesperada ao enviar o arquivo.',
      ),
  });

  const remove = useMutation({
    mutationFn: (assetId: string) => api.deleteAsset(assetId),
    onSuccess: (_result, assetId) => {
      // Apagar o asset precisa remover a referência da cena junto, senão o SceneSpec fica
      // apontando para algo que não existe mais e a gravação seguinte é recusada.
      onChange({ ...spec, references: spec.references.filter((r) => r.assetId !== assetId) });
      toast.success('Referência excluída');
      void queryClient.invalidateQueries({ queryKey: queryKeys.assets(projectId) });
    },
  });

  /**
   * Colar imagem da área de transferência.
   *
   * `Ctrl+V` com um print copiado é o caminho mais curto que existe para trazer uma
   * referência — e quem trabalha com imagem tenta isso por reflexo. Ignorado quando o foco
   * está num campo de texto, onde colar pertence ao campo.
   */
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;

      const file = [...(event.clipboardData?.items ?? [])]
        .find((item) => item.type.startsWith('image/'))
        ?.getAsFile();

      if (file) {
        setError(null);
        upload.mutate(file);
      }
    }

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [upload]);

  /** Aceita o primeiro arquivo solto. Vários de uma vez entram na Fase de lote. */
  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);

    const file = event.dataTransfer.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Solte uma imagem JPEG, PNG ou WebP.');
      return;
    }
    setError(null);
    upload.mutate(file);
  }

  const referenceOf = (assetId: string): SceneReference | undefined =>
    spec.references.find((reference) => reference.assetId === assetId);

  function attach(assetId: string) {
    if (referenceOf(assetId)) return;
    onChange({
      ...spec,
      references: [...spec.references, { assetId, role: 'style', weight: 0.5, preserve: [] }],
    });
  }

  function updateReference(assetId: string, patch: Partial<SceneReference>) {
    onChange({
      ...spec,
      references: spec.references.map((reference) =>
        reference.assetId === assetId ? { ...reference, ...patch } : reference,
      ),
    });
  }

  function detach(assetId: string) {
    onChange({ ...spec, references: spec.references.filter((r) => r.assetId !== assetId) });
  }

  return (
    <section
      // A coluna inteira é alvo de soltura, não só a área vazia: depois do primeiro upload a
      // área vazia some, e o alvo não deveria sumir junto.
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        // `relatedTarget` fora da seção: sair para um filho não conta como sair.
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={handleDrop}
      className={`rounded-lg transition-all duration-fast ease-out ${
        dragging ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface-raised' : ''
      }`}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-label uppercase text-ink-muted">Referências</h2>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-micro font-semibold text-accent-40 transition-all duration-fast ease-out hover:bg-accent/10 hover:text-accent disabled:opacity-50"
        >
          {upload.isPending ? (
            'enviando…'
          ) : (
            <>
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              enviar
            </>
          )}
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          setError(null);
          if (file) upload.mutate(file);
          // Zera para que enviar o mesmo arquivo de novo dispare o evento outra vez.
          event.target.value = '';
        }}
      />

      {error && (
        <p role="alert" className="px-2 pb-2 text-xs text-state-error">
          {error}
        </p>
      )}

      {assets.data?.length === 0 && (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="w-full rounded-lg border border-dashed border-surface-border px-3 py-8 text-center transition-all duration-fast ease-out hover:border-accent-40/60 hover:bg-accent/[0.04]"
        >
          <span className="block text-micro font-semibold text-ink-secondary">
            Arraste ou clique para enviar
          </span>
          <span className="mt-1 block text-micro text-ink-muted">
            JPEG, PNG ou WebP · até 15 MB
          </span>
        </button>
      )}

      <ul className="space-y-2">
        {assets.data?.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            reference={referenceOf(asset.id)}
            onAttach={() => attach(asset.id)}
            onDetach={() => detach(asset.id)}
            onUpdate={(patch) => updateReference(asset.id, patch)}
            onDelete={() => remove.mutate(asset.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function AssetCard({
  asset,
  reference,
  onAttach,
  onDetach,
  onUpdate,
  onDelete,
}: {
  asset: Asset;
  reference: SceneReference | undefined;
  onAttach: () => void;
  onDetach: () => void;
  onUpdate: (patch: Partial<SceneReference>) => void;
  onDelete: () => void;
}) {
  const attached = reference !== undefined;

  return (
    <li
      className={`animate-rise rounded-lg border p-2.5 transition-all duration-fast ease-out ${
        attached
          ? 'border-accent/40 bg-accent/[0.08] shadow-glow-sm'
          : 'border-surface-border bg-surface-overlay hover:border-surface-hover'
      }`}
    >
      <div className="flex gap-2">
        <Thumbnail asset={asset} />

        <div className="min-w-0 flex-1">
          <p
            className="truncate text-micro font-medium text-ink-primary"
            title={asset.originalName ?? ''}
          >
            {asset.originalName ?? 'sem nome'}
          </p>
          <p className="mt-1 text-micro text-ink-muted">
            {asset.status === 'PROCESSING' && 'processando…'}
            {asset.status === 'FAILED' && <span className="text-state-error">falhou</span>}
            {asset.status === 'READY' && asset.width
              ? `${asset.width}×${asset.height}`
              : asset.status === 'READY'
                ? 'pronta'
                : null}
          </p>
        </div>

        <button
          type="button"
          onClick={onDelete}
          aria-label={`Excluir ${asset.originalName ?? 'referência'}`}
          className="self-start text-ink-muted transition-colors hover:text-state-error"
        >
          <Icon name="trash" className="h-3.5 w-3.5" />
        </button>
      </div>

      {asset.status === 'READY' &&
        (attached ? (
          <div className="mt-2 space-y-1.5 border-t border-surface-border pt-2">
            <label className="block">
              <span className="sr-only">Função da referência</span>
              <select
                value={reference.role}
                onChange={(e) => onUpdate({ role: e.target.value as SceneReference['role'] })}
                className="w-full rounded-md border border-surface-border bg-surface-base px-2 py-1.5 text-micro font-medium text-ink-secondary transition-colors hover:border-surface-hover focus:border-accent focus:outline-none"
              >
                {referenceRoleSchema.options.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role] ?? role}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2">
              <span className="sr-only">Peso da referência</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={reference.weight}
                onChange={(e) => onUpdate({ weight: Number(e.target.value) })}
                className="flex-1 accent-accent"
              />
              <span className="w-8 text-right font-mono text-xs text-ink-muted">
                {reference.weight.toFixed(2)}
              </span>
            </label>

            <button
              type="button"
              onClick={onDetach}
              className="text-micro text-ink-muted transition-colors hover:text-state-error"
            >
              remover da cena
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onAttach}
            className="mt-2.5 w-full rounded-md border border-surface-border py-1.5 text-micro font-semibold text-ink-secondary transition-all duration-fast ease-out hover:border-accent hover:bg-accent/10 hover:text-accent-40"
          >
            usar nesta cena
          </button>
        ))}
    </li>
  );
}

function Thumbnail({ asset }: { asset: Asset }) {
  if (asset.thumbnailUrl) {
    return (
      // <img> e não next/image: a URL é assinada e efêmera, e o otimizador do Next
      // exigiria allowlist de domínio e reescreveria a URL, quebrando a assinatura.
      <img
        src={asset.thumbnailUrl}
        alt={asset.originalName ?? 'Referência'}
        className="h-12 w-12 shrink-0 rounded-md object-cover ring-1 ring-surface-border"
      />
    );
  }

  return (
    <div
      aria-hidden
      className={`h-12 w-12 shrink-0 rounded-md ${asset.status === 'PROCESSING' ? 'shimmer' : 'bg-surface-hover'}`}
      title={asset.status === 'PROCESSING' ? 'gerando miniatura' : undefined}
    />
  );
}
