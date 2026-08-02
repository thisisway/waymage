import type { AspectRatio, ImageFormat, SceneSpec } from '@waymage/scene-spec';

/**
 * Contrato de provedor de imagem (blueprint §11).
 *
 * O domínio conversa apenas com esta interface. Nenhum SDK de provedor pode vazar
 * daqui para cima — é a fronteira que permite trocar de fornecedor sem tocar no
 * orquestrador, no compilador ou no banco.
 */

/**
 * Como o provedor espera receber a máscara de edição.
 *
 * `luminance` — imagem opaca em preto e branco, onde o branco marca a região. É o que o
 * Gemini recebe, e ele a trata como mais uma imagem de entrada.
 *
 * `alpha` — a transparência é a máscara. É o que a OpenAI exige, e o que faz a máscara ser
 * usada COMO máscara em vez de deduzida.
 *
 * A diferença precisa ser declarada porque quem converte é o worker: mandar a forma errada
 * significa, num caso, edição sem efeito, e no outro, requisição recusada.
 */
export type MaskEncoding = 'luminance' | 'alpha';

export interface ProviderCapabilities {
  textToImage: boolean;
  imageToImage: boolean;
  maskedEdit: boolean;
  multipleReferences: boolean;
  transparentBackground: boolean;
  seed: boolean;
  negativePrompt: boolean;
  /** O provedor emite miniaturas parciais durante a geração? */
  partialStreaming: boolean;
  supportedAspectRatios: readonly AspectRatio[];
  supportedFormats: readonly ImageFormat[];
  maxReferenceImages: number;
  maxOutputs: number;
  /** Só relevante quando `maskedEdit`. Padrão `luminance`. */
  maskEncoding?: MaskEncoding;
}

export type GenerationMode = 'draft' | 'final' | 'edit';

/** Referência já resolvida: o adapter recebe bytes ou URL, nunca um id do nosso banco. */
export interface ProviderReference {
  role: string;
  weight: number;
  preserve: readonly string[];
  /** URL assinada de leitura, de expiração curta. */
  url: string;
}

export interface ProviderGenerationRequest {
  /** Correlaciona logs, ProviderRun e eventos SSE. */
  requestId: string;
  prompt: string;
  negativePrompt?: string;
  references: readonly ProviderReference[];
  aspectRatio: AspectRatio;
  format: ImageFormat;
  count: number;
  mode: GenerationMode;
  seed?: number;
  transparentBackground?: boolean;
  /** Parâmetros crus do provedor. Validados pelo adapter. */
  providerParams?: Readonly<Record<string, unknown>>;
  /** SceneSpec normalizado, para adapters que aproveitam campos estruturados. */
  sceneSpec?: SceneSpec;
}

export interface ProviderEditRequest extends ProviderGenerationRequest {
  /** URL assinada da imagem a editar. */
  baseImageUrl: string;
  /** URL assinada do PNG de máscara. Branco = editar, preto = preservar. */
  maskUrl?: string;
  /** Suavização da borda da máscara, em pixels — evita emenda visível na costura. */
  maskFeatherPx?: number;
  /** Inverte a máscara: edita tudo MENOS o que foi pintado. */
  maskInverted?: boolean;
}

export interface ProviderCostEstimate {
  /** Custo do provedor em centavos de USD. */
  externalCostCents: number;
  /** Créditos internos a reservar. */
  credits: number;
  estimatedLatencyMs: number;
}

export interface ProviderJobHandle {
  /** Identificador do job no provedor. */
  providerJobId: string;
  provider: string;
  model?: string;
}

export type ProviderJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ProviderImage {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  seed?: number;
}

export interface ProviderJobStatus {
  providerJobId: string;
  state: ProviderJobState;
  /** 0..1. Aproximado — nem todo provedor reporta progresso real. */
  progress: number;
  images: readonly ProviderImage[];
  errorCode?: string;
  errorMessage?: string;
  latencyMs?: number;
  externalCostCents?: number;
}

export interface ImageProvider {
  readonly id: string;

  getCapabilities(): ProviderCapabilities;

  estimateCost(request: ProviderGenerationRequest): Promise<ProviderCostEstimate>;

  generate(request: ProviderGenerationRequest): Promise<ProviderJobHandle>;

  edit(request: ProviderEditRequest): Promise<ProviderJobHandle>;

  getStatus(providerJobId: string): Promise<ProviderJobStatus>;

  cancel(providerJobId: string): Promise<void>;
}
