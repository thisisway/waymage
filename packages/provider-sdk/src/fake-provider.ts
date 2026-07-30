import type { AspectRatio } from '@waymage/scene-spec';
import { ProviderError } from './errors';
import { encodePng } from './png';
import type {
  ImageProvider,
  ProviderCostEstimate,
  ProviderEditRequest,
  ProviderGenerationRequest,
  ProviderImage,
  ProviderJobHandle,
  ProviderJobStatus,
} from './types';

/**
 * Provedor de desenvolvimento e teste.
 *
 * Executa o fluxo inteiro — enfileirar, progredir, produzir imagens, falhar, expirar —
 * sem rede e sem custo. É o provedor padrão até a Fase 9 (docs/DECISIONS.md D-011), o que
 * significa que um bug de retry não pode gerar cobrança real.
 *
 * Gatilhos de falha ficam no próprio prompt para que um teste E2E possa acioná-los sem
 * mexer na configuração:
 *   `[[fail]]`     → ProviderError transitório
 *   `[[timeout]]`  → job trava em `running` e expira
 *   `[[blocked]]`  → rejeição por política de conteúdo
 */

export interface FakeProviderOptions {
  /** Latência simulada por job, em ms. 0 conclui imediatamente. */
  latencyMs?: number;
  /** Relógio injetável — os testes não devem depender de tempo real. */
  now?: () => number;
}

const ASPECT_DIMENSIONS: Record<AspectRatio, readonly [number, number]> = {
  '1:1': [512, 512],
  '4:5': [448, 560],
  '5:4': [560, 448],
  '3:2': [576, 384],
  '2:3': [384, 576],
  '4:3': [512, 384],
  '3:4': [384, 512],
  '16:9': [640, 360],
  '9:16': [360, 640],
  '21:9': [672, 288],
};

const FAILURE_TRIGGERS = {
  fail: '[[fail]]',
  timeout: '[[timeout]]',
  blocked: '[[blocked]]',
} as const;

interface FakeJob {
  request: ProviderGenerationRequest;
  startedAt: number;
  cancelled: boolean;
  /** Comportamento decidido na submissão, para o status ser determinístico. */
  behaviour: 'succeed' | 'fail' | 'timeout' | 'blocked';
}

/** Hash determinístico (FNV-1a): a mesma seed produz sempre a mesma imagem. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** HSL→RGB simplificado, saturação e luminosidade fixas. */
function hueToRgb(hue: number, lightness: number): readonly [number, number, number] {
  const c = (1 - Math.abs(2 * lightness - 1)) * 0.55;
  const hp = (hue % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1]: readonly [number, number, number] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = lightness - c / 2;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ] as const;
}

export class FakeImageProvider implements ImageProvider {
  readonly id = 'fake';

  private readonly jobs = new Map<string, FakeJob>();
  private readonly latencyMs: number;
  private readonly now: () => number;
  private counter = 0;

  constructor(options: FakeProviderOptions = {}) {
    this.latencyMs = options.latencyMs ?? 1200;
    this.now = options.now ?? (() => Date.now());
  }

  getCapabilities() {
    return {
      textToImage: true,
      imageToImage: true,
      maskedEdit: true,
      multipleReferences: true,
      transparentBackground: false,
      seed: true,
      negativePrompt: true,
      partialStreaming: false,
      supportedAspectRatios: Object.keys(ASPECT_DIMENSIONS) as AspectRatio[],
      supportedFormats: ['png'] as const,
      maxReferenceImages: 6,
      maxOutputs: 8,
    };
  }

  async estimateCost(request: ProviderGenerationRequest): Promise<ProviderCostEstimate> {
    const perImage = request.mode === 'final' ? 4 : 1;
    return {
      externalCostCents: 0,
      credits: perImage * request.count,
      estimatedLatencyMs: this.latencyMs,
    };
  }

  async generate(request: ProviderGenerationRequest): Promise<ProviderJobHandle> {
    return this.submit(request);
  }

  async edit(request: ProviderEditRequest): Promise<ProviderJobHandle> {
    if (!request.baseImageUrl) {
      throw new ProviderError(
        'invalid_request',
        'MISSING_BASE_IMAGE',
        'Edição exige uma imagem base.',
        this.id,
      );
    }
    return this.submit(request);
  }

  async getStatus(providerJobId: string): Promise<ProviderJobStatus> {
    const job = this.jobs.get(providerJobId);
    if (!job) {
      throw new ProviderError(
        'invalid_request',
        'UNKNOWN_JOB',
        `Job desconhecido: ${providerJobId}`,
        this.id,
      );
    }

    if (job.cancelled) {
      return { providerJobId, state: 'cancelled', progress: 0, images: [] };
    }

    const elapsed = this.now() - job.startedAt;

    if (job.behaviour === 'timeout') {
      // Nunca conclui — o orquestrador precisa desistir por timeout próprio.
      return { providerJobId, state: 'running', progress: 0.5, images: [] };
    }

    if (elapsed < this.latencyMs) {
      return {
        providerJobId,
        state: 'running',
        progress: this.latencyMs === 0 ? 1 : Math.min(0.95, elapsed / this.latencyMs),
        images: [],
      };
    }

    if (job.behaviour === 'fail') {
      return {
        providerJobId,
        state: 'failed',
        progress: 1,
        images: [],
        errorCode: 'FAKE_TRANSIENT_FAILURE',
        errorMessage: 'Falha transitória simulada.',
        latencyMs: elapsed,
      };
    }

    if (job.behaviour === 'blocked') {
      return {
        providerJobId,
        state: 'failed',
        progress: 1,
        images: [],
        errorCode: 'CONTENT_POLICY',
        errorMessage: 'Conteúdo rejeitado pela política simulada.',
        latencyMs: elapsed,
      };
    }

    return {
      providerJobId,
      state: 'succeeded',
      progress: 1,
      images: this.render(job.request),
      latencyMs: elapsed,
      externalCostCents: 0,
    };
  }

  async cancel(providerJobId: string): Promise<void> {
    const job = this.jobs.get(providerJobId);
    if (job) job.cancelled = true;
  }

  private submit(request: ProviderGenerationRequest): ProviderJobHandle {
    const caps = this.getCapabilities();
    if (request.count > caps.maxOutputs) {
      throw new ProviderError(
        'invalid_request',
        'COUNT_ABOVE_LIMIT',
        `O provedor fake gera no máximo ${caps.maxOutputs} imagens.`,
        this.id,
      );
    }

    const providerJobId = `fake_${(++this.counter).toString().padStart(6, '0')}`;
    this.jobs.set(providerJobId, {
      request,
      startedAt: this.now(),
      cancelled: false,
      behaviour: behaviourFor(request.prompt),
    });
    return { providerJobId, provider: this.id, model: 'fake-diffusion-v1' };
  }

  /**
   * Placeholder determinístico: gradiente diagonal com faixa de contraste, derivado da
   * seed. Duas execuções com a mesma seed produzem bytes idênticos — o que torna os
   * testes de armazenamento e checksum estáveis.
   */
  private render(request: ProviderGenerationRequest): ProviderImage[] {
    const [width, height] = ASPECT_DIMENSIONS[request.aspectRatio] ?? [512, 512];

    return Array.from({ length: request.count }, (_, index) => {
      const seed = (request.seed ?? hash(request.prompt)) + index;
      const baseHue = seed % 360;
      const data = encodePng(width, height, (x, y) => {
        const dx = x / width;
        const dy = y / height;
        const diagonal = (dx + dy) / 2;
        // Faixas visíveis para distinguir variações a olho nu.
        const band = Math.floor(diagonal * 6) % 2 === 0 ? 0.04 : -0.04;
        return hueToRgb(baseHue + diagonal * 60, 0.42 + diagonal * 0.25 + band);
      });

      return { data, mimeType: 'image/png', width, height, seed };
    });
  }
}

function behaviourFor(prompt: string): FakeJob['behaviour'] {
  if (prompt.includes(FAILURE_TRIGGERS.timeout)) return 'timeout';
  if (prompt.includes(FAILURE_TRIGGERS.blocked)) return 'blocked';
  if (prompt.includes(FAILURE_TRIGGERS.fail)) return 'fail';
  return 'succeed';
}

export const FAKE_PROVIDER_TRIGGERS = FAILURE_TRIGGERS;
