'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { referenceRoleSchema, type SceneReference, type SceneSpec } from '@waymage/scene-spec';
import { useRef, useState } from 'react';
import { ApiError, api, queryKeys, uploadAsset, type Asset } from '../lib/api';

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.assets(projectId) }),
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : 'Falha ao enviar o arquivo.'),
  });

  const remove = useMutation({
    mutationFn: (assetId: string) => api.deleteAsset(assetId),
    onSuccess: (_result, assetId) => {
      // Apagar o asset precisa remover a referência da cena junto, senão o SceneSpec fica
      // apontando para algo que não existe mais e a gravação seguinte é recusada.
      onChange({ ...spec, references: spec.references.filter((r) => r.assetId !== assetId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assets(projectId) });
    },
  });

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
    <section>
      <div className="mb-2 flex items-center justify-between px-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-ink-muted">Biblioteca</h2>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending}
          className="text-xs text-accent hover:underline disabled:opacity-50"
        >
          {upload.isPending ? 'enviando…' : '+ enviar'}
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
        <p className="px-2 text-xs leading-relaxed text-ink-muted">
          Nenhuma referência ainda. JPEG, PNG ou WebP, até 15 MB.
        </p>
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
      className={`rounded-md border p-2 ${
        attached ? 'border-accent-dim bg-surface-overlay' : 'border-surface-border'
      }`}
    >
      <div className="flex gap-2">
        <Thumbnail asset={asset} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-ink-secondary" title={asset.originalName ?? ''}>
            {asset.originalName ?? 'sem nome'}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
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
          className="self-start text-xs text-ink-muted hover:text-state-error"
        >
          ×
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
                className="w-full rounded border border-surface-border bg-surface-base px-1.5 py-1 text-xs text-ink-secondary"
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
              className="text-xs text-ink-muted hover:text-ink-secondary"
            >
              remover da cena
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onAttach}
            className="mt-2 w-full rounded border border-surface-border py-1 text-xs text-ink-secondary hover:text-ink-primary"
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
        className="h-11 w-11 shrink-0 rounded object-cover"
      />
    );
  }

  return (
    <div
      aria-hidden
      className="h-11 w-11 shrink-0 rounded bg-surface-overlay"
      title={asset.status === 'PROCESSING' ? 'gerando miniatura' : undefined}
    />
  );
}
