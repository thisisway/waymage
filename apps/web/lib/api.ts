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
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

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

  createProject: (input: { name: string; description?: string }) =>
    apiFetch<Project>('/projects', { method: 'POST', body: input }),
};
