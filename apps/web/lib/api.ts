import type { SceneSpec } from '@waymage/scene-spec';

/** URL base da API. Injetada em build (next.config.mjs) — nunca contém segredo. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

const CSRF_COOKIE = 'wm_csrf';
const CSRF_HEADER = 'x-csrf-token';

/** Formato de erro da API (blueprint §31). */
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
 * O token CSRF vem do único cookie de sessão legível por JavaScript.
 *
 * Access e refresh são httpOnly e nunca são lidos aqui — é o que impede um XSS de roubar a
 * sessão. Este valor sozinho não autoriza nada; serve só para provar que a requisição partiu
 * da nossa página, e não de um site de terceiro.
 */
function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : '';
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
  } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { ...options.headers };

  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') headers[CSRF_HEADER] = csrfToken();

  const response = await fetch(`${API_URL}${path}`, {
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
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
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

export interface GenerationJob {
  id: string;
  sceneId: string;
  sceneVersionId: string;
  status: string;
  statusLabel: string;
  progress: number;
  requestedCount: number;
  selectedProvider: string | null;
  estimatedCredits: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  results: GenerationResult[];
}

export interface Estimate {
  provider: string;
  credits: number;
  estimatedSeconds: number;
  count: number;
  summary: string;
  prompt: string;
  warnings: { code: string; message: string }[];
  issues: { code: string; level: string; message: string }[];
  canGenerate: boolean;
}

export interface Wallet {
  /** Disponível para gastar. Já desconta o que está reservado. */
  balance: number;
  /** Preso em gerações em voo. Volta ao saldo se a geração falhar. */
  reserved: number;
}

export interface CreditTransaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  generationJobId: string | null;
  note: string | null;
  createdAt: string;
}

export interface UsageEntry {
  provider: string;
  imagesProduced: number;
  creditsCharged: number;
  externalCostCents: number;
  createdAt: string;
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
  const response = await fetch(`${API_URL}/health`, { credentials: 'include', cache: 'no-store' });
  return (await response.json()) as HealthReport;
}

export const api = {
  register: (input: { name: string; email: string; password: string }) =>
    apiFetch<{ user: SessionUser }>('/auth/register', { method: 'POST', body: input }),

  login: (input: { email: string; password: string }) =>
    apiFetch<{ user: SessionUser }>('/auth/login', { method: 'POST', body: input }),

  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),

  me: () => apiFetch<{ user: SessionUser }>('/auth/me'),

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

  wallet: () => apiFetch<Wallet>('/billing/wallet'),

  transactions: () => apiFetch<CreditTransaction[]>('/billing/transactions'),

  usage: () => apiFetch<UsageEntry[]>('/billing/usage'),
};

/**
 * Upload em três passos (blueprint §16).
 *
 * O arquivo vai do browser direto ao storage, sem passar pela API — o que evita que um
 * upload de 15 MB ocupe memória do processo que atende todo mundo. A API só assina a URL e,
 * depois, confere o que realmente chegou.
 */
export async function uploadAsset(projectId: string, file: File): Promise<Asset> {
  const ticket = await apiFetch<UploadTicket>('/assets/upload-url', {
    method: 'POST',
    body: {
      projectId,
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    },
  });

  // Sem `credentials`: a URL assinada já carrega a autorização, e mandar cookie para o
  // storage seria vazar a sessão para um host que não precisa dela.
  const upload = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    body: file,
    // Precisa bater exatamente com o tipo assinado, senão o storage recusa a assinatura.
    headers: { 'content-type': ticket.contentType },
  });

  if (!upload.ok) {
    throw new ApiError('UPLOAD_FAILED', 'Falha ao enviar o arquivo.', upload.status);
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
  wallet: ['billing', 'wallet'] as const,
  transactions: ['billing', 'transactions'] as const,
  usage: ['billing', 'usage'] as const,
};
