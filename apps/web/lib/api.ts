/** URL base da API. Injetada em build (next.config.mjs) — nunca contém segredo. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

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

/**
 * `credentials: 'include'` desde já: a sessão será cookie httpOnly (D-009), e descobrir
 * isso só na Fase 2 significaria revisar toda chamada.
 */
export async function fetchHealth(): Promise<HealthReport> {
  const response = await fetch(`${API_URL}/health`, {
    credentials: 'include',
    cache: 'no-store',
  });
  // /health responde 503 quando degradado — o corpo continua sendo o relatório.
  return (await response.json()) as HealthReport;
}
