import {
  ProviderError,
  type ImageProvider,
  type ProviderGenerationRequest,
  type ProviderJobStatus,
} from '@waymage/provider-sdk';

/**
 * Submete ao provedor e acompanha até terminar.
 *
 * Existe porque nenhum provedor é confiável quanto a terminar: o loop tem teto de tempo
 * próprio e cancela o job remoto ao desistir — sem isso, um provedor que trava segura um
 * slot do worker para sempre e a reserva de créditos nunca é liberada.
 */

export interface RunOptions {
  timeoutMs: number;
  pollIntervalMs: number;
  /** Injetável para que os testes não esperem tempo real. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onProgress?: (progress: number, state: ProviderJobStatus['state']) => void | Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runProviderJob(
  provider: ImageProvider,
  request: ProviderGenerationRequest,
  options: RunOptions,
): Promise<ProviderJobStatus> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Date.now());
  const deadline = now() + options.timeoutMs;

  const handle = await provider.generate(request);

  for (;;) {
    const status = await provider.getStatus(handle.providerJobId);
    await options.onProgress?.(status.progress, status.state);

    if (status.state === 'succeeded') return status;

    if (status.state === 'failed') {
      throw new ProviderError(
        status.errorCode === 'CONTENT_POLICY' ? 'content_policy' : 'transient',
        status.errorCode ?? 'PROVIDER_FAILED',
        status.errorMessage ?? 'O provedor falhou sem detalhar o motivo.',
        provider.id,
      );
    }

    if (status.state === 'cancelled') {
      throw new ProviderError(
        'invalid_request',
        'PROVIDER_CANCELLED',
        'Job cancelado.',
        provider.id,
      );
    }

    if (now() >= deadline) {
      // Cancelar é best-effort: se o provedor não colaborar, ainda assim desistimos.
      await provider.cancel(handle.providerJobId).catch(() => undefined);
      throw new ProviderError(
        'timeout',
        'PROVIDER_TIMEOUT',
        `O provedor não concluiu em ${options.timeoutMs} ms.`,
        provider.id,
      );
    }

    await sleep(options.pollIntervalMs);
  }
}
