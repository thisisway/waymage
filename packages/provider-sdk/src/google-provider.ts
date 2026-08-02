import type { AspectRatio } from '@waymage/scene-spec';
import { ProviderError } from './errors';
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
 * Google Gemini — a família apelidada de Nano Banana.
 *
 * Fala com a **Interactions API** (`POST /v1beta/interactions`), que é síncrona: uma chamada
 * devolve a imagem. Nosso contrato é assíncrono, com submissão e acompanhamento, então o
 * adapter dispara a promessa em `generate()` e a resolve em `getStatus()`.
 *
 * Não é firula: `runProviderJob` impõe o próprio limite de tempo e cancela quem estoura. Se
 * `generate()` esperasse a resposta, esse limite não teria efeito nenhum — um fornecedor
 * travado seguraria o worker pelo tempo que quisesse.
 *
 * A chave vem do usuário (BYOK, docs/DECISIONS.md D-070): uma instância por workspace, criada
 * na hora do job. Ela nunca é registrada em log nem persistida fora da credencial cifrada.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/** Proporções que a API aceita. Coincide com o conjunto do SceneSpec. */
const ASPECT_RATIOS: readonly AspectRatio[] = [
  '1:1',
  '3:2',
  '2:3',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
];

export interface GoogleModel {
  /** Id do modelo na API. */
  name: string;
  /**
   * Custo relativo, não preço.
   *
   * O preço real muda sem aviso e não cabe a nós adivinhá-lo — quem paga a fatura é o
   * usuário, no painel do fornecedor. Este número existe só para o roteador conseguir
   * ordenar candidatos entre si.
   */
  relativeCost: number;
  estimatedLatencyMs: number;
}

/** Modelos de imagem, do mais barato ao mais caro. */
export const GOOGLE_MODELS = {
  flashLite: { name: 'gemini-3.1-flash-lite-image', relativeCost: 1, estimatedLatencyMs: 6_000 },
  flash: { name: 'gemini-3.1-flash-image', relativeCost: 2, estimatedLatencyMs: 12_000 },
  pro: { name: 'gemini-3-pro-image', relativeCost: 6, estimatedLatencyMs: 30_000 },
} as const satisfies Record<string, GoogleModel>;

export interface GoogleProviderOptions {
  /** Chave do usuário. Nunca sai daqui. */
  apiKey: string;
  id?: string;
  model?: GoogleModel;
  /** Injetável para teste: o contrato é exercitado sem tocar na rede. */
  fetchImpl?: typeof fetch;
  /** Teto por chamada. O orquestrador tem o seu, mas a requisição precisa do próprio. */
  timeoutMs?: number;
}

interface RunningJob {
  promise: Promise<ProviderImage[]>;
  images: ProviderImage[] | null;
  error: ProviderError | null;
  cancelled: boolean;
  startedAt: number;
  count: number;
}

/** Parte de entrada da Interactions API. */
type InputPart =
  { type: 'text'; text: string } | { type: 'image'; mime_type: string; data: string };

interface InteractionResponse {
  steps?: { type?: string; content?: { type?: string; mime_type?: string; data?: string }[] }[];
}

export class GoogleImageProvider implements ImageProvider {
  readonly id: string;

  private readonly apiKey: string;
  private readonly model: GoogleModel;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly jobs = new Map<string, RunningJob>();
  private counter = 0;

  constructor(options: GoogleProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? GOOGLE_MODELS.flash;
    this.id = options.id ?? 'google-gemini';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      textToImage: true,
      imageToImage: true,
      /**
       * Edição por máscara: sim, com uma ressalva honesta.
       *
       * A API não recebe canal de máscara — ela recebe imagens de referência e texto. A
       * máscara vai como imagem, com instrução dizendo o que ela significa. Funciona, e é
       * menos preciso do que um recorte por alfa.
       */
      maskedEdit: true,
      multipleReferences: true,
      // Não documentado. Declarar sem certeza faria o roteador escolher este provedor para
      // um pedido que ele não entrega.
      transparentBackground: false,
      seed: false,
      negativePrompt: false,
      partialStreaming: false,
      supportedAspectRatios: ASPECT_RATIOS,
      /**
       * Só JPEG.
       *
       * A API recusa qualquer outro valor em `response_format.mime_type`, com
       * `Supported values: 'image/jpeg'`. Declarar PNG aqui seria prometer o que o
       * fornecedor não entrega.
       *
       * Não limita o produto: o formato que o usuário escolhe na cena é aplicado na
       * exportação, por conversão. O que o provedor devolve é o arquivo de trabalho
       * (docs/DECISIONS.md D-056).
       */
      supportedFormats: ['jpeg'],
      maxReferenceImages: 14,
      /**
       * Uma imagem por chamada: quatro saídas são quatro requisições.
       *
       * O teto é baixo de propósito. Cada saída é uma cobrança na conta do usuário, e um
       * pedido distraído de dezesseis imagens viraria dezesseis chamadas pagas.
       */
      maxOutputs: 4,
    };
  }

  async estimateCost(request: ProviderGenerationRequest): Promise<ProviderCostEstimate> {
    return {
      // Zero, e não um palpite: não sabemos o preço, e inventar um número faria a tela
      // exibir uma previsão de fatura que não corresponde a nada.
      externalCostCents: 0,
      credits: this.model.relativeCost * request.count,
      estimatedLatencyMs: this.model.estimatedLatencyMs,
    };
  }

  async generate(request: ProviderGenerationRequest): Promise<ProviderJobHandle> {
    return this.submit(request, this.parts(request));
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

    const parts = async (): Promise<InputPart[]> => {
      const base = await this.download(request.baseImageUrl);
      const mask = request.maskUrl ? await this.download(request.maskUrl) : null;

      return [
        { type: 'text', text: request.prompt },
        // A ordem importa: a instrução explica o que cada imagem seguinte significa. Sem
        // isso o modelo trata a máscara como mais uma referência de estilo.
        { type: 'text', text: 'A primeira imagem é a original, a ser editada.' },
        base,
        ...(mask
          ? [
              {
                type: 'text' as const,
                text: request.maskInverted
                  ? 'A segunda imagem é uma máscara: preserve o que está em branco e altere o resto.'
                  : 'A segunda imagem é uma máscara: altere apenas o que está em branco e preserve o resto.',
              },
              mask,
            ]
          : []),
        ...(await this.references(request)),
      ];
    };

    return this.submit(request, parts());
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

    /**
     * Progresso estimado pelo relógio.
     *
     * A API não reporta andamento, e a alternativa seria uma barra parada em zero até tudo
     * aparecer de uma vez. O teto de 0.95 evita a barra cheia com o job em aberto, que é o
     * jeito mais rápido de fazer alguém achar que travou.
     */
    const elapsed = Date.now() - job.startedAt;
    const expected = this.model.estimatedLatencyMs * job.count;

    return {
      providerJobId,
      state: 'running',
      progress: Math.min(0.95, elapsed / Math.max(expected, 1)),
      images: [],
    };
  }

  async cancel(providerJobId: string): Promise<void> {
    const job = this.jobs.get(providerJobId);
    // A chamada já saiu e não há como retirá-la — cancelar aqui é parar de esperar. O custo
    // no fornecedor já foi incorrido, e fingir o contrário seria mentir sobre a fatura.
    if (job) job.cancelled = true;
  }

  // ── interno ────────────────────────────────────────────────────────────────

  private submit(
    request: ProviderGenerationRequest,
    parts: InputPart[] | Promise<InputPart[]>,
  ): ProviderJobHandle {
    const capabilities = this.getCapabilities();
    if (request.count > capabilities.maxOutputs) {
      throw new ProviderError(
        'invalid_request',
        'COUNT_ABOVE_LIMIT',
        `Este modelo gera no máximo ${capabilities.maxOutputs} imagens por pedido.`,
        this.id,
      );
    }

    const providerJobId = `${this.id}_${(++this.counter).toString().padStart(6, '0')}`;

    const job: RunningJob = {
      // Substituída logo abaixo. Nasce resolvida porque o objeto precisa existir antes de a
      // promessa poder referenciá-lo.
      promise: Promise.resolve([]),
      images: null,
      error: null,
      cancelled: false,
      startedAt: Date.now(),
      count: request.count,
    };

    job.promise = (async () => {
      const resolved = await parts;
      // Uma requisição por imagem: a API devolve uma por chamada. Em paralelo porque são
      // independentes, e serializar multiplicaria a espera pela contagem.
      return Promise.all(
        Array.from({ length: request.count }, () => this.callOnce(resolved, request)),
      );
    })();

    job.promise.then(
      (images) => {
        job.images = images;
      },
      (error: unknown) => {
        job.error =
          error instanceof ProviderError
            ? error
            : new ProviderError(
                'transient',
                'GOOGLE_REQUEST_FAILED',
                error instanceof Error ? error.message : 'Falha ao falar com o provedor.',
                this.id,
              );
      },
    );

    this.jobs.set(providerJobId, job);
    return { providerJobId, provider: this.id, model: this.model.name };
  }

  private async callOnce(
    input: InputPart[],
    request: ProviderGenerationRequest,
  ): Promise<ProviderImage> {
    // Fixo, e não derivado de `request.format`: a API recusa qualquer outro valor. A
    // conversão para o formato pedido acontece na exportação.
    const mimeType = 'image/jpeg';

    const response = await this.fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Header, não query string: chave em URL vaza em log de proxy e em histórico.
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        model: this.model.name,
        input,
        response_format: {
          type: 'image',
          mime_type: mimeType,
          aspect_ratio: request.aspectRatio,
          image_size: request.mode === 'draft' ? '1K' : '2K',
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) throw await this.toProviderError(response);

    const payload = (await response.json()) as InteractionResponse;
    const image = payload.steps
      ?.flatMap((step) => step.content ?? [])
      .find((part) => part.type === 'image' && part.data);

    if (!image?.data) {
      // Resposta 200 sem imagem quase sempre é recusa por política, devolvida como texto.
      throw new ProviderError(
        'content_policy',
        'NO_IMAGE_RETURNED',
        'O provedor respondeu sem imagem. O pedido pode ter sido recusado pela política dele.',
        this.id,
      );
    }

    const data = Buffer.from(image.data, 'base64');
    const [width, height] = imageSize(data) ?? [0, 0];

    return { data, mimeType: image.mime_type ?? mimeType, width, height };
  }

  /**
   * Traduz o erro do fornecedor para o vocabulário do orquestrador.
   *
   * A classificação decide o comportamento: `quota` e `transient` valem outra tentativa,
   * `auth` não vale nenhuma — insistir com chave inválida só gasta tempo e enche o log de
   * quem já tem um problema para resolver na conta dele.
   */
  private async toProviderError(response: Response): Promise<ProviderError> {
    const body = await response.text().catch(() => '');
    const detail = body.slice(0, 300);

    if (response.status === 401 || response.status === 403) {
      return new ProviderError(
        'auth',
        'GOOGLE_AUTH_FAILED',
        'A chave do Google foi recusada. Confira em Chaves de IA se ela ainda é válida.',
        this.id,
      );
    }

    if (response.status === 429) {
      /**
       * 429 quase nunca é rajada, nos modelos de imagem.
       *
       * "Tente de novo em instantes" é o que o status HTTP sugere, e estava enganando: no
       * nível gratuito a cota de imagem é baixa ou inexistente, e nenhuma espera resolve.
       * A mensagem precisa mandar a pessoa para onde o problema está.
       */
      return new ProviderError(
        'quota',
        'GOOGLE_RATE_LIMITED',
        `O Google recusou por limite de uso. Costuma ser cota do nível gratuito ou faturamento não habilitado no projeto — confira em aistudio.google.com. Se o faturamento já estiver ativo, é rajada e vale tentar em instantes. ${detail}`,
        this.id,
      );
    }

    if (response.status >= 500) {
      return new ProviderError(
        'unavailable',
        'GOOGLE_UNAVAILABLE',
        'O Google está indisponível no momento.',
        this.id,
      );
    }

    return new ProviderError(
      'invalid_request',
      'GOOGLE_REJECTED_REQUEST',
      `O Google recusou o pedido (HTTP ${response.status}). ${detail}`,
      this.id,
    );
  }

  private parts(request: ProviderGenerationRequest): Promise<InputPart[]> {
    return (async () => [
      { type: 'text' as const, text: request.prompt },
      ...(await this.references(request)),
    ])();
  }

  private async references(request: ProviderGenerationRequest): Promise<InputPart[]> {
    const limit = this.getCapabilities().maxReferenceImages;
    const chosen = request.references.slice(0, limit);

    return Promise.all(chosen.map((reference) => this.download(reference.url)));
  }

  /** Baixa uma referência da nossa URL assinada e a converte para o formato da API. */
  private async download(url: string): Promise<InputPart> {
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });

    if (!response.ok) {
      throw new ProviderError(
        'invalid_request',
        'REFERENCE_UNREACHABLE',
        `Não foi possível ler uma imagem de referência (HTTP ${response.status}).`,
        this.id,
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      type: 'image',
      mime_type: response.headers.get('content-type') ?? 'image/png',
      data: bytes.toString('base64'),
    };
  }
}

/**
 * Largura e altura, lidas do cabeçalho.
 *
 * Uma varredura de bytes em vez de uma dependência de decodificação de imagem: só precisamos
 * de dois números, que o `GenerationResult` guarda e o cálculo de aderência usa. Trazer um
 * decodificador para isso colocaria binário nativo num pacote que hoje roda em qualquer lugar.
 *
 * O worker ainda mede com `sharp` quando isto devolver zero — cinto e suspensório, porque
 * dimensão errada não falha alto: ela vira uma legenda "0×0" e uma avaliação sem sentido.
 */
function imageSize(data: Buffer): [number, number] | null {
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47) {
    // PNG: IHDR vem sempre no mesmo lugar.
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
  }

  if (data.length < 4 || data.readUInt16BE(0) !== 0xffd8) return null;

  /**
   * JPEG: percorre os segmentos até o SOF, que carrega as dimensões.
   *
   * Não dá para ler de um deslocamento fixo como no PNG — antes do SOF vêm metadados de
   * tamanho variável (EXIF, perfil de cor, miniatura), e o fornecedor decide quais inclui.
   */
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = data[offset + 1] ?? 0;
    // SOF0..SOF15, exceto DHT (C4), JPG (C8) e DAC (CC), que não descrevem o quadro.
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

    if (isFrameHeader) return [data.readUInt16BE(offset + 7), data.readUInt16BE(offset + 5)];

    offset += 2 + data.readUInt16BE(offset + 2);
  }

  return null;
}
