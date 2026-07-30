/**
 * Chaves de objeto no bucket (blueprint §16).
 *
 * O `workspaceId` vem primeiro de propósito: qualquer vazamento cross-tenant fica visível
 * no próprio caminho, e uma policy de bucket pode ser escrita por prefixo se um dia for
 * preciso isolar por chave de acesso.
 */

export const storageKeys = {
  assetOriginal(workspaceId: string, projectId: string, assetId: string, ext: string): string {
    return `workspaces/${workspaceId}/projects/${projectId}/assets/${assetId}/original.${ext}`;
  },

  assetThumbnail(workspaceId: string, projectId: string, assetId: string): string {
    return `workspaces/${workspaceId}/projects/${projectId}/assets/${assetId}/thumb.webp`;
  },

  mask(workspaceId: string, projectId: string, maskId: string): string {
    return `workspaces/${workspaceId}/projects/${projectId}/masks/${maskId}.png`;
  },

  generationResult(
    workspaceId: string,
    projectId: string,
    jobId: string,
    index: number,
    ext: string,
  ): string {
    return `workspaces/${workspaceId}/projects/${projectId}/generations/${jobId}/${index}.${ext}`;
  },

  export(workspaceId: string, projectId: string, exportId: string, ext: string): string {
    return `workspaces/${workspaceId}/projects/${projectId}/exports/${exportId}.${ext}`;
  },
} as const;

/** Extrai o workspaceId de uma chave — usado em auditoria e em asserção de isolamento. */
export function workspaceIdFromKey(key: string): string | null {
  const match = /^workspaces\/([^/]+)\//.exec(key);
  return match?.[1] ?? null;
}
