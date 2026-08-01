import type { SceneSpec } from '@waymage/scene-spec';

declare global {
  interface Window {
    __WAYMAGE_API_URL__?: string;
  }
}

/**
 * URL base da API, resolvida em runtime.
 *
 * Uma função, e não uma constante de módulo, porque o valor não existe no bundle: ele é
 * injetado pelo servidor em cada resposta (ver `app/layout.tsx`) e lido aqui na hora da
 * chamada. Constante seria avaliada na carga do módulo, que pode acontecer antes do script
 * de configuração.
 *
 * `NEXT_PUBLIC_API_URL` continua valendo como padrão de build — é o que serve o
 * desenvolvimento local, onde a URL nunca muda. Em produção ela seria embutida na imagem, e
 * trocar de ambiente exigiria rebuild.
 */
export function apiUrl(): string {
  if (typeof window !== 'undefined' && window.__WAYMAGE_API_URL__) {
    return window.__WAYMAGE_API_URL__;
  }
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';
}

const CSRF_COOKIE = 'wm_csrf';
const CSRF_HEADER = 'x-csrf-token';

/** Formato de erro da API (blueprint §31). */
/** Resposta das rotas de sessão: o usuário e o token que prova a origem da requisição. */
export interface Session {
  user: SessionUser;
  csrfToken: string;
}

/** Guarda o token e devolve a sessão, para encadear direto no `then`. */
function keepSession(session: Session): Session {
  rememberCsrf(session.csrfToken);
  return session;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details: Record<string, unknown>;
  requestId: string;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Token CSRF em memória.
 *
 * Ele chega no corpo das respostas de sessão porque o cookie não é legível daqui: em produção
 * a API vive noutro subdomínio, e `document.cookie` só enxerga cookies do próprio host. O
 * browser continua enviando o cookie — só a leitura é que não acontece.
 *
 * Memória e não `localStorage`: o token acompanha a sessão, e persisti-lo criaria um valor
 * sobrevivendo ao logout à espera de confundir a próxima sessão.
 */
let csrfMemo = '';

export function rememberCsrf(token: string | undefined): void {
  if (token) csrfMemo = token;
}

/**
 * O token que prova que a requisição partiu da nossa página.
 *
 * Sozinho ele não autoriza nada — quem autoriza é o cookie de acesso, que é `httpOnly` e
 * nunca é lido aqui. É essa separação que impede um XSS de roubar a sessão.
 *
 * O cookie continua servindo de fallback: em desenvolvimento, web e API compartilham
 * `localhost` e a leitura funciona, então a sessão sobrevive a um recarregamento mesmo antes
 * de `/auth/me` responder.
 */
function csrfToken(): string {
  if (csrfMemo) return csrfMemo;
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

/**
 * Busca o token quando a memória está vazia.
 *
 * Acontece a cada recarregamento de página: a memória do módulo nasce vazia e o cookie não é
 * legível quando a API vive noutro subdomínio. Sem isto, a primeira mutação depois de um F5
 * falha com 403 — e só ela, o que torna o defeito difícil de reproduzir.
 *
 * `/auth/me` é GET, então não exige token e não cai em recursão. As chamadas simultâneas
 * compartilham a mesma promessa: abrir a página e disparar três mutações não deve virar três
 * idas ao servidor pelo mesmo valor.
 */
let pendingCsrf: Promise<void> | null = null;

async function ensureCsrf(): Promise<void> {
  if (csrfToken()) return;

  pendingCsrf ??= apiFetch<Session>('/auth/me')
    .then((session) => rememberCsrf(session.csrfToken))
    .catch(() => undefined)
    .finally(() => {
      pendingCsrf = null;
    });

  await pendingCsrf;
}

/**
 * Cliente HTTP da API.
 *
 * `credentials: 'include'` em toda chamada: a sessão vive em cookie, não em header
 * Authorization, então não há token para o front administrar.
 */
export async function apiFetch<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    headers?: Record<string, string>;
    /** Uso interno: impede que a repetição por CSRF inválido vire laço. */
    retried?: boolean;
  } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const mutation = method !== 'GET' && method !== 'HEAD';

  if (mutation) await ensureCsrf();

  const headers: Record<string, string> = { ...options.headers };

  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (mutation) headers[CSRF_HEADER] = csrfToken();

  const response = await fetch(`${apiUrl()}${path}`, {
    method,
    headers,
    credentials: 'include',
    cache: 'no-store',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = payload as ApiErrorBody | null;

    /**
     * Token recusado: busca outro e tenta uma vez.
     *
     * O token acompanha a sessão, e a sessão se renova sozinha — depois de um refresh o valor
     * em memória fica velho. Repetir uma vez transforma isso num detalhe invisível, em vez de
     * um erro que o usuário resolve recarregando a página.
     */
    if (error?.code === 'CSRF_TOKEN_INVALID' && !options.retried) {
      csrfMemo = '';
      await ensureCsrf();
      return apiFetch<T>(path, { ...options, retried: true });
    }

    throw new ApiError(
      error?.code ?? 'UNKNOWN_ERROR',
      error?.message ?? 'Não foi possível completar a operação.',
      response.status,
      error?.details ?? {},
    );
  }

  return payload as T;
}

// ── Tipos das respostas ──────────────────────────────────────────────────────

export interface DependencyCheck {
  name: string;
  state: 'ok' | 'down';
  latencyMs: number;
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  dependencies: DependencyCheck[];
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface Project {
  /** Só na resposta de criação: a cena que nasceu junto com o projeto. */
  firstSceneId?: string;
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  /** Última imagem gerada no projeto, em URL assinada. Serve de capa na lista. */
  previewUrl: string | null;
}

export interface ValidationIssue {
  code: string;
  level: 'error' | 'warning' | 'suggestion';
  path: string;
  message: string;
  suggestion?: string;
}

/** O tipo do `sceneSpec` vem de @waymage/scene-spec — mesmo schema que a API valida. */
export interface Scene {
  id: string;
  projectId: string;
  name: string;
  sceneSpec: SceneSpec;
  revision: number;
  currentVersionId: string | null;
  issues: ValidationIssue[];
  createdAt: string;
  updatedAt: string;
}

export interface SceneSummary {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
}

export type AssetStatus = 'PENDING_UPLOAD' | 'PROCESSING' | 'READY' | 'FAILED' | 'QUARANTINED';

export interface Asset {
  id: string;
  status: AssetStatus;
  mimeType: string;
  originalName: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  /** URLs assinadas, curtas. Renovadas a cada listagem — não guardar em cache longo. */
  url: string | null;
  thumbnailUrl: string | null;
}

export interface UploadTicket {
  assetId: string;
  uploadUrl: string;
  contentType: string;
  expiresInSeconds: number;
}

export interface SceneVersion {
  id: string;
  versionNumber: number;
  changeSummary: string | null;
  parentVersionId: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

export interface ProviderRun {
  provider: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  attempt: number;
  errorCode: string | null;
  latencyMs: number | null;
}

export interface ModerationNote {
  target: string;
  verdict: 'ALLOW' | 'ALLOW_WITH_WARNING' | 'REVIEW_REQUIRED' | 'BLOCK';
  reason: string | null;
}

export interface GenerationResult {
  id: string;
  width: number;
  height: number;
  format: string;
  seed: string | null;
  selected: boolean;
  evaluation: {
    score: number;
    issues: { code: string; severity: string; message: string }[];
    notEvaluated: string[];
  } | null;
  url: string | null;
  thumbnailUrl: string | null;
}

export interface ExportFile {
  assetId: string;
  downloadUrl: string;
  filename: string;
}

export interface ExportJob {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED';
  format: string;
  resultIds: string[];
  errorMessage: string | null;
  createdAt: string;
  expiresAt: string | null;
  files: ExportFile[];
}

export interface GenerationJob {
  id: string;
  sceneId: string;
  sceneVersionId: string;
  operationType: 'TEXT_TO_IMAGE' | 'IMAGE_TO_IMAGE' | 'VARIATION' | 'REFINE' | 'MASKED_EDIT';
  sourceResultId: string | null;
  /** A imagem de origem, já resolvida — é o "antes" da comparação. */
  sourceResult: GenerationResult | null;
  /** Tentativas contra provedores. Mais de uma significa que houve fallback. */
  runs: ProviderRun[];
  /** Ressalvas da moderação. Só o que não foi permitido sem observação. */
  moderation: ModerationNote[];
  status: string;
  statusLabel: string;
  progress: number;
  requestedCount: number;
  selectedProvider: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  results: GenerationResult[];
}

export interface ProviderAlternative {
  provider: string;
  eligible: boolean;
  estimatedSeconds: number;
  score: number;
  notes: string[];
}

export interface Estimate {
  provider: string;
  estimatedSeconds: number;
  count: number;
  summary: string;
  prompt: string;
  warnings: { code: string; message: string }[];
  issues: { code: string; level: string; message: string }[];
  canGenerate: boolean;
  /** Todos os provedores considerados, do melhor para o pior. */
  alternatives: ProviderAlternative[];
}

/** Evento de progresso recebido pelo SSE. */
export interface GenerationProgress {
  generationJobId: string;
  status: string;
  statusLabel: string;
  progress: number;
  message: string | null;
  at: string;
}

// ── Operações ────────────────────────────────────────────────────────────────

export async function fetchHealth(): Promise<HealthReport> {
  // /health responde 503 quando degradado, mas o corpo continua sendo o relatório.
  const response = await fetch(`${apiUrl()}/health`, {
    credentials: 'include',
    cache: 'no-store',
  });
  return (await response.json()) as HealthReport;
}

export const api = {
  register: (input: { name: string; email: string; password: string }) =>
    apiFetch<Session>('/auth/register', { method: 'POST', body: input }).then(keepSession),

  login: (input: { email: string; password: string }) =>
    apiFetch<Session>('/auth/login', { method: 'POST', body: input }).then(keepSession),

  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),

  me: () => apiFetch<Session>('/auth/me').then(keepSession),

  listProjects: () => apiFetch<Project[]>('/projects'),

  getProject: (projectId: string) => apiFetch<Project>(`/projects/${projectId}`),

  createProject: (input: { name: string; description?: string }) =>
    apiFetch<Project>('/projects', { method: 'POST', body: input }),

  listScenes: (projectId: string) => apiFetch<SceneSummary[]>(`/projects/${projectId}/scenes`),

  createScene: (projectId: string, input: { name: string }) =>
    apiFetch<Scene>(`/projects/${projectId}/scenes`, { method: 'POST', body: input }),

  getScene: (sceneId: string) => apiFetch<Scene>(`/scenes/${sceneId}`),

  /** Autosave. `revision` é o que detecta que outra aba salvou por cima. */
  saveScene: (sceneId: string, input: { revision: number; name?: string; sceneSpec?: unknown }) =>
    apiFetch<Scene>(`/scenes/${sceneId}`, { method: 'PATCH', body: input }),

  listVersions: (sceneId: string) => apiFetch<SceneVersion[]>(`/scenes/${sceneId}/versions`),

  createVersion: (sceneId: string, input: { changeSummary?: string }) =>
    apiFetch<SceneVersion>(`/scenes/${sceneId}/versions`, { method: 'POST', body: input }),

  listAssets: (projectId: string) => apiFetch<Asset[]>(`/projects/${projectId}/assets`),

  deleteAsset: (assetId: string) => apiFetch<void>(`/assets/${assetId}`, { method: 'DELETE' }),

  estimate: (sceneId: string) =>
    apiFetch<Estimate>('/generation-jobs/estimate', { method: 'POST', body: { sceneId } }),

  /**
   * `Idempotency-Key` gerada aqui: sem ela, duplo clique no botão Gerar viraria dois jobs —
   * e, a partir da Fase 6, duas cobranças.
   */
  generate: (sceneId: string, idempotencyKey: string) =>
    apiFetch<GenerationJob>('/generation-jobs', {
      method: 'POST',
      body: { sceneId },
      headers: { 'idempotency-key': idempotencyKey },
    }),

  getGeneration: (jobId: string) => apiFetch<GenerationJob>(`/generation-jobs/${jobId}`),

  listGenerations: (sceneId: string) =>
    apiFetch<GenerationJob[]>(`/scenes/${sceneId}/generation-jobs`),

  cancelGeneration: (jobId: string) =>
    apiFetch<GenerationJob>(`/generation-jobs/${jobId}/cancel`, { method: 'POST' }),

  selectResult: (resultId: string) =>
    apiFetch<GenerationResult>(`/generation-results/${resultId}/select`, { method: 'POST' }),

  /** Mesma cena, seed nova — explora outra saída da mesma especificação. */
  variation: (resultId: string, idempotencyKey: string) =>
    apiFetch<GenerationJob>(`/generation-results/${resultId}/variation`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
    }),

  /** Mesma saída em qualidade final, uma imagem só. */
  refine: (resultId: string, idempotencyKey: string) =>
    apiFetch<GenerationJob>(`/generation-results/${resultId}/refine`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
    }),

  /** Edição localizada: repinta só a região marcada pela máscara. */
  edit: (
    resultId: string,
    input: { maskAssetId: string; instruction: string; featherPx: number; inverted: boolean },
    idempotencyKey: string,
  ) =>
    apiFetch<GenerationJob>(`/generation-results/${resultId}/edit`, {
      method: 'POST',
      body: input,
      headers: { 'idempotency-key': idempotencyKey },
    }),

  createExport: (resultIds: string[], format: 'png' | 'jpeg' | 'webp') =>
    apiFetch<ExportJob>('/exports', { method: 'POST', body: { resultIds, format } }),

  getExport: (exportId: string) => apiFetch<ExportJob>(`/exports/${exportId}`),
};

/**
 * Upload em três passos (blueprint §16).
 *
 * O arquivo vai do browser direto ao storage, sem passar pela API — o que evita que um
 * upload de 15 MB ocupe memória do processo que atende todo mundo. A API só assina a URL e,
 * depois, confere o que realmente chegou.
 */
export async function uploadAsset(
  projectId: string,
  file: File,
  /** Máscara não é material criativo: fica fora da biblioteca de referências. */
  kind: 'REFERENCE' | 'MASK' = 'REFERENCE',
): Promise<Asset> {
  const ticket = await apiFetch<UploadTicket>('/assets/upload-url', {
    method: 'POST',
    body: {
      projectId,
      kind,
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    },
  });

  // Sem `credentials`: a URL assinada já carrega a autorização, e mandar cookie para o
  // storage seria vazar a sessão para um host que não precisa dela.
  /**
   * Duas falhas muito diferentes moram aqui, e confundi-las custa uma tarde.
   *
   * O `fetch` REJEITAR significa que o browser nem chegou a mandar: quase sempre o bucket sem
   * política de CORS, já que o arquivo vai daqui direto ao storage. Uma resposta com status
   * de erro significa que o storage recebeu e recusou — assinatura expirada, tipo divergente
   * do assinado, permissão faltando.
   *
   * A mensagem precisa dizer qual das duas foi, senão o único caminho é adivinhar.
   */
  const upload = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    body: file,
    // Precisa bater exatamente com o tipo assinado, senão o storage recusa a assinatura.
    headers: { 'content-type': ticket.contentType },
  }).catch(() => null);

  if (!upload) {
    throw new ApiError(
      'UPLOAD_BLOCKED',
      'O navegador bloqueou o envio ao storage. Falta liberar CORS no bucket para este domínio.',
      0,
    );
  }

  if (!upload.ok) {
    throw new ApiError(
      'UPLOAD_REJECTED',
      `O storage recusou o arquivo (HTTP ${upload.status}).`,
      upload.status,
    );
  }

  return apiFetch<Asset>('/assets/complete', {
    method: 'POST',
    body: { assetId: ticket.assetId },
  });
}

/** Chaves de cache do TanStack Query, num lugar só para não divergirem entre telas. */
export const queryKeys = {
  session: ['session'] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  scenes: (projectId: string) => ['projects', projectId, 'scenes'] as const,
  scene: (id: string) => ['scenes', id] as const,
  versions: (sceneId: string) => ['scenes', sceneId, 'versions'] as const,
  assets: (projectId: string) => ['projects', projectId, 'assets'] as const,
  generations: (sceneId: string) => ['scenes', sceneId, 'generations'] as const,
  generation: (jobId: string) => ['generation-jobs', jobId] as const,
  estimate: (sceneId: string) => ['scenes', sceneId, 'estimate'] as const,
  export: (exportId: string) => ['exports', exportId] as const,
};
