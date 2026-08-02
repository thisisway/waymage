import type { AspectRatio, ImageFormat } from '@waymage/scene-spec';
import { ProviderError } from './errors';
import { imageSize } from './image-size';
import type {
  ImageProvider,
  ProviderCapabilities,
  ProviderCostEstimate,
  ProviderEditRequest,
  ProviderGenerationRequest,
  ProviderImage,
  ProviderJobHandle,
  ProviderJobStatus,
} from './types';

/**
 * OpenAI — família `gpt-image`.
 *
 * Dois endpoints com formatos diferentes: `/v1/images/generations` é JSON, e
 * `/v1/images/edits` é multipart, porque a imagem e a máscara vão como arquivo. Ter os dois no
 * mesmo adapter é o preço de o contrato `ImageProvider` esconder essa diferença de quem chama.
 *
 * **A máscara é real aqui.** O endpoint de edição recebe um PNG com canal alfa e trata a
 * transparência como a região a alterar — diferente do Gemini, que recebe a máscara como mais
 * uma imagem e precisa deduzir o que ela significa. É a razão principal de este adapter
 * existir.
 *
 * **O preço é a proporção.** A API aceita três tamanhos, que dão 1:1, 3:2 e 2:3. As outras
 * sete proporções do SceneSpec ficam com o Gemini, e o roteador descarta este provedor sozinho
 * quando a cena pede uma delas (docs/DECISIONS.md D-056).
 */

const GENERATIONS = 'https://api.openai.com/v1/images/generations';
const EDITS = 'https://api.openai.com/v1/images/edits';

/** As três proporções que os tamanhos aceitos produzem. */
const SIZE_BY_RATIO: Partial<Record<AspectRatio, string>> = {
  '1:1': '1024x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
};

const ASPECT_RATIOS = Object.keys(SIZE_BY_RATIO) as AspectRatio[];

export interface OpenAIModel {
  name: string;
  /** Custo relativo, não preço — serve ao roteador, não à tela (D-075). */
  relativeCost: number;
  estimatedLatencyMs: number;
}

export const OPENAI_MODELS = {
  mini: { name: 'gpt-image-1-mini', relativeCost: 1, estimatedLatencyMs: 10_000 },
  standard: { name: 'gpt-image-1.5', relativeCost: 3, estimatedLatencyMs: 20_000 },
  latest: { name: 'gpt-image-2', relativeCost: 5, estimatedLatencyMs: 25_000 },
} as const satisfies Record<string, OpenAIModel>;

export interface OpenAIProviderOptions {
  apiKey: string;
  id?: string;
  model?: OpenAIModel;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface RunningJob {
  images: ProviderImage[] | null;
  error: ProviderError | null;
  cancelled: boolean;
  startedAt: number;
}

interface ImagesResponse {
  data?: { b64_json?: string }[];
  error?: { message?: string; code?: string };
}

export class OpenAIImageProvider implements ImageProvider {
  readonly id: string;

  private readonly apiKey: string;
  private readonly model: OpenAIModel;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly jobs = new Map<string, RunningJob>();
  private counter = 0;

  constructor(options: OpenAIProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? OPENAI_MODELS.standard;
    this.id = options.id ?? 'openai-image';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      textToImage: true,
      imageToImage: true,
      maskedEdit: true,
      multipleReferences: true,
      // `gpt-image-2` não aceita fundo transparente. Declarar por modelo daria um provedor
      // que muda de capacidade conforme a configuração — o roteador não saberia o que esperar.
      transparentBackground: false,
      seed: false,
      negativePrompt: false,
      partialStreaming: false,
      supportedAspectRatios: ASPECT_RATIOS,
      supportedFormats: ['png', 'jpeg', 'webp'],
      maxReferenceImages: 4,
      /**
       * Teto de quatro, embora `n` aceite mais numa chamada só.
       *
       * Diferente do Gemini, aqui quatro imagens custam uma requisição. O limite continua
       * baixo pelo mesmo motivo: cada saída é uma cobrança na conta do usuário.
       */
      maxOutputs: 4,
      // A transparência é a região a editar. É o que torna a máscara real neste provedor.
      maskEncoding: 'alpha',
    };
  }

  async estimateCost(request: ProviderGenerationRequest): Promise<ProviderCostEstimate> {
    return {
      externalCostCents: 0,
      credits: this.model.relativeCost * request.count,
      // Uma chamada entrega todas as imagens, então a espera não cresce com a contagem como
      // no Gemini — cresce um pouco, porque o modelo trabalha mais.
      estimatedLatencyMs: this.model.estimatedLatencyMs + (request.count - 1) * 4_000,
    };
  }

  async generate(request: ProviderGenerationRequest): Promise<ProviderJobHandle> {
    this.assertCount(request.count);

    return this.submit(async () =>
      this.call(GENERATIONS, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model.name,
          prompt: request.prompt,
          n: request.count,
          size: this.sizeFor(request.aspectRatio),
          output_format: this.formatFor(request.format),
        }),
      }),
    );
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
    this.assertCount(request.count);

    return this.submit(async () => {
      const form = new FormData();
      form.set('model', this.model.name);
      form.set('prompt', request.prompt);
      form.set('n', String(request.count));
      form.set('size', this.sizeFor(request.aspectRatio));
      form.set('output_format', this.formatFor(request.format));

      form.set('image', await this.fileFrom(request.baseImageUrl, 'base.png'));

      /**
       * A máscara precisa ter o MESMO formato e tamanho da imagem base.
       *
       * Quem garante isso é o worker, que a converte para alfa e a redimensiona antes de
       * assinar a URL. Aqui só é enviada — validar de novo exigiria decodificar imagem, e
       * este pacote é deliberadamente livre de binário nativo.
       */
      if (request.maskUrl) {
        form.set('mask', await this.fileFrom(request.maskUrl, 'mask.png'));
      }

      for (const [index, reference] of request.references.slice(0, 3).entries()) {
        form.set(`image[${index + 1}]`, await this.fileFrom(reference.url, `ref-${index}.png`));
      }

      return this.call(EDITS, { body: form });
    });
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

    if (job.cancelled) return { providerJobId, state: 'cancelled', progress: 0, images: [] };

    if (job.error) {
      return {
        providerJobId,
        state: 'failed',
        progress: 1,
        images: [],
        errorCode: job.error.code,
        errorMessage: job.error.message,
      };
    }

    if (job.images) {
      return {
        providerJobId,
        state: 'succeeded',
        progress: 1,
        images: job.images,
        latencyMs: Date.now() - job.startedAt,
        externalCostCents: 0,
      };
    }

    // A API não reporta andamento. O teto de 0.95 evita a barra cheia com o job em aberto.
    const elapsed = Date.now() - job.startedAt;
    return {
      providerJobId,
      state: 'running',
      progress: Math.min(0.95, elapsed / this.model.estimatedLatencyMs),
      images: [],
    };
  }

  async cancel(providerJobId: string): Promise<void> {
    const job = this.jobs.get(providerJobId);
    if (job) job.cancelled = true;
  }

  // ── interno ────────────────────────────────────────────────────────────────

  private assertCount(count: number): void {
    const { maxOutputs } = this.getCapabilities();
    if (count > maxOutputs) {
      throw new ProviderError(
        'invalid_request',
        'COUNT_ABOVE_LIMIT',
        `Este provedor gera no máximo ${maxOutputs} imagens por pedido.`,
        this.id,
      );
    }
  }

  /**
   * Dispara o trabalho e devolve o identificador na hora.
   *
   * Esperar aqui anularia o limite de tempo do orquestrador, que é quem cancela um fornecedor
   * travado — o mesmo motivo do adapter do Google (D-075).
   */
  private submit(work: () => Promise<ProviderImage[]>): ProviderJobHandle {
    const providerJobId = `${this.id}_${(++this.counter).toString().padStart(6, '0')}`;
    const job: RunningJob = { images: null, error: null, cancelled: false, startedAt: Date.now() };

    work().then(
      (images) => {
        job.images = images;
      },
      (error: unknown) => {
        job.error =
          error instanceof ProviderError
            ? error
            : new ProviderError(
                'transient',
                'OPENAI_REQUEST_FAILED',
                error instanceof Error ? error.message : 'Falha ao falar com o provedor.',
                this.id,
              );
      },
    );

    this.jobs.set(providerJobId, job);
    return { providerJobId, provider: this.id, model: this.model.name };
  }

  private async call(
    url: string,
    init: { headers?: Record<string, string>; body: string | FormData },
  ) {
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        ...(init.headers ?? {}),
        // Header, não query string: chave em URL vaza em log de proxy e em histórico.
        authorization: `Bearer ${this.apiKey}`,
      },
      body: init.body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) throw await this.toProviderError(response);

    const payload = (await response.json()) as ImagesResponse;
    const images = (payload.data ?? []).filter((entry) => entry.b64_json);

    if (images.length === 0) {
      throw new ProviderError(
        'content_policy',
        'NO_IMAGE_RETURNED',
        'O provedor respondeu sem imagem. O pedido pode ter sido recusado pela política dele.',
        this.id,
      );
    }

    return images.map((entry) => {
      const data = Buffer.from(entry.b64_json ?? '', 'base64');
      const [width, height] = imageSize(data) ?? [0, 0];

      // O tipo vem dos bytes, não do que pedimos: `output_format` é um pedido, e gravar o
      // arquivo com a extensão errada quebraria a exibição sem quebrar nada antes.
      return { data, mimeType: mimeOf(data), width, height };
    });
  }

  /** Baixa da nossa URL assinada e embrulha para o multipart. */
  private async fileFrom(url: string, filename: string): Promise<File> {
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });

    if (!response.ok) {
      throw new ProviderError(
        'invalid_request',
        'REFERENCE_UNREACHABLE',
        `Não foi possível ler uma imagem de entrada (HTTP ${response.status}).`,
        this.id,
      );
    }

    // `Buffer` e não `ArrayBuffer`: o `File` do Node aceita as duas formas em runtime, mas os
    // tipos do `undici` só reconhecem a primeira.
    return new File([Buffer.from(await response.arrayBuffer())], filename, {
      type: response.headers.get('content-type') ?? 'image/png',
    });
  }

  private sizeFor(ratio: AspectRatio): string {
    // O roteador já descartou proporção não suportada; este padrão existe para o caso de
    // alguém forçar o provedor pela cena, e escolhe o quadrado por ser o menos distorcido.
    return SIZE_BY_RATIO[ratio] ?? '1024x1024';
  }

  private formatFor(format: ImageFormat): string {
    return format === 'jpeg' || format === 'webp' ? format : 'png';
  }

  /** Traduz o erro para o vocabulário que o orquestrador usa para decidir (D-075). */
  private async toProviderError(response: Response): Promise<ProviderError> {
    const body = await response.text().catch(() => '');
    const detail = extractMessage(body).slice(0, 300);

    if (response.status === 401 || response.status === 403) {
      return new ProviderError(
        'auth',
        'OPENAI_AUTH_FAILED',
        'A chave da OpenAI foi recusada. Confira em Chaves de IA se ela ainda é válida.',
        this.id,
      );
    }

    if (response.status === 429) {
      return new ProviderError(
        'quota',
        'OPENAI_RATE_LIMITED',
        `A OpenAI recusou por limite de uso. Costuma ser cota do projeto ou saldo esgotado — confira em platform.openai.com. ${detail}`,
        this.id,
      );
    }

    if (response.status >= 500) {
      return new ProviderError(
        'unavailable',
        'OPENAI_UNAVAILABLE',
        'A OpenAI está indisponível no momento.',
        this.id,
      );
    }

    return new ProviderError(
      'invalid_request',
      'OPENAI_REJECTED_REQUEST',
      `A OpenAI recusou o pedido (HTTP ${response.status}). ${detail}`,
      this.id,
    );
  }
}

/** A mensagem útil vem em `error.message`; corpo não-JSON volta como está. */
function extractMessage(body: string): string {
  try {
    return (JSON.parse(body) as ImagesResponse).error?.message ?? body;
  } catch {
    return body;
  }
}

/** Tipo lido da assinatura dos bytes. PNG é o padrão da API quando não pedimos outro. */
function mimeOf(data: Buffer): string {
  if (data.length > 3 && data.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (data.length > 2 && data.readUInt16BE(0) === 0xffd8) return 'image/jpeg';
  if (data.length > 12 && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return 'image/png';
}
