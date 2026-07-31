import type { AspectRatio, ImageFormat } from '@waymage/scene-spec';
import { ProviderError } from './errors';
import type { ProviderRegistry } from './registry';
import type { GenerationMode, ImageProvider, ProviderCapabilities } from './types';

/**
 * Escolha automática de provedor (blueprint §11.3).
 *
 * Duas decisões separadas, e confundi-las é o erro clássico:
 *
 * 1. **Elegibilidade** é binária. Um provedor que não faz edição por máscara não é uma opção
 *    ruim para uma edição por máscara — não é uma opção. Reprovar por pontuação baixa
 *    deixaria um empate improvável escolher alguém que vai falhar na submissão.
 * 2. **Pontuação** ordena quem sobrou, pelos pesos do blueprint.
 *
 * A função é pura: recebe capacidades, custos e confiabilidade e devolve a ordem. Quem
 * consulta o banco para saber a taxa de erro recente é o chamador, porque o roteador roda
 * tanto na API (estimativa) quanto no worker (execução), e cada um tem o seu acesso a dados.
 */

/** Pesos do blueprint §11.3. Somam 1. */
export const ROUTING_WEIGHTS = {
  capability: 0.35,
  quality: 0.25,
  cost: 0.15,
  latency: 0.1,
  reliability: 0.15,
} as const;

export interface RoutingRequest {
  operation: 'TEXT_TO_IMAGE' | 'IMAGE_TO_IMAGE' | 'VARIATION' | 'REFINE' | 'MASKED_EDIT';
  aspectRatio: AspectRatio;
  format: ImageFormat;
  count: number;
  mode: GenerationMode;
  referenceCount: number;
  transparentBackground: boolean;
  /** A cena define uma seed fixa? Sem suporte, a reprodutibilidade se perde em silêncio. */
  needsSeed: boolean;
  /** A cena tem restrições negativas a comunicar? */
  needsNegativePrompt: boolean;
  /**
   * Teto de créditos, quando já existe reserva.
   *
   * A API roteia ao criar o job e reserva o custo de quem venceu. O worker roteia de novo,
   * com dados de confiabilidade mais frescos — e sem este teto poderia escolher um provedor
   * mais caro do que o usuário viu na estimativa. Preço combinado é preço cobrado.
   */
  maxCredits?: number;
}

export interface RoutingContext {
  /**
   * Qualidade percebida por provedor, 0..1.
   *
   * Não vem do adapter: é julgamento nosso sobre o fornecedor, e muda sem que o código do
   * adapter mude. Fica num lugar só, editável sem tocar em integração.
   */
  quality?: Readonly<Record<string, number>>;
  /** Taxa de sucesso recente por provedor, 0..1. Ausente conta como 1. */
  reliability?: Readonly<Record<string, number>>;
  /** Provedores fora do ar ou desabilitados. */
  unavailable?: readonly string[];
}

export interface ProviderRanking {
  provider: string;
  eligible: boolean;
  /** 0..1. Só faz sentido comparar entre elegíveis. */
  score: number;
  credits: number;
  estimatedLatencyMs: number;
  breakdown: Record<keyof typeof ROUTING_WEIGHTS, number>;
  /** Por que foi descartado, ou o que pesou contra. Vai para a tela e para o log. */
  notes: string[];
}

const DEFAULT_QUALITY = 0.5;

export class ModelRouter {
  constructor(private readonly registry: ProviderRegistry) {}

  /**
   * Ordena os provedores, do melhor para o pior.
   *
   * Devolve também os inelegíveis, no fim e com o motivo: a estimativa comparativa precisa
   * dizer "este não serve porque não faz máscara", que é mais útil do que uma lista curta
   * sem explicação.
   */
  async rank(
    request: RoutingRequest,
    context: RoutingContext = {},
  ): Promise<readonly ProviderRanking[]> {
    const providers = this.registry.all();
    if (providers.length === 0) {
      throw new ProviderError(
        'invalid_request',
        'NO_PROVIDER_REGISTERED',
        'Nenhum provedor registrado neste processo.',
      );
    }

    const measured = await Promise.all(
      providers.map(async (provider) => {
        const capabilities = provider.getCapabilities();
        const notes: string[] = [];

        const unavailable = context.unavailable?.includes(provider.id) ?? false;
        if (unavailable) notes.push('indisponível');

        const blocking = disqualify(capabilities, request);
        notes.push(...blocking);

        const estimate = await provider.estimateCost({
          requestId: 'routing',
          prompt: '',
          references: [],
          aspectRatio: request.aspectRatio,
          format: request.format,
          count: request.count,
          mode: request.mode,
        });

        const overBudget =
          request.maxCredits !== undefined && estimate.credits > request.maxCredits;
        if (overBudget) {
          notes.push(
            `custa ${estimate.credits} créditos, acima dos ${request.maxCredits} reservados`,
          );
        }

        return {
          provider,
          capabilities,
          notes,
          eligible: !unavailable && !overBudget && blocking.length === 0,
          credits: estimate.credits,
          latencyMs: estimate.estimatedLatencyMs,
        };
      }),
    );

    const eligible = measured.filter((entry) => entry.eligible);
    // Custo e latência são relativos: "caro" só existe comparado ao mais barato disponível.
    const cheapest = Math.min(...eligible.map((entry) => entry.credits || 1), Infinity);
    const fastest = Math.min(...eligible.map((entry) => entry.latencyMs || 1), Infinity);

    const ranked = measured.map((entry): ProviderRanking => {
      const capability = capabilityScore(entry.capabilities, request, entry.notes);
      const quality = context.quality?.[entry.provider.id] ?? DEFAULT_QUALITY;
      const cost = entry.eligible && entry.credits > 0 ? cheapest / entry.credits : 0;
      const latency = entry.eligible && entry.latencyMs > 0 ? fastest / entry.latencyMs : 0;
      const reliability = context.reliability?.[entry.provider.id] ?? 1;

      const breakdown = { capability, quality, cost, latency, reliability };
      const score = entry.eligible
        ? (Object.keys(ROUTING_WEIGHTS) as (keyof typeof ROUTING_WEIGHTS)[]).reduce(
            (total, key) => total + breakdown[key] * ROUTING_WEIGHTS[key],
            0,
          )
        : 0;

      return {
        provider: entry.provider.id,
        eligible: entry.eligible,
        score,
        credits: entry.credits,
        estimatedLatencyMs: entry.latencyMs,
        breakdown,
        notes: entry.notes,
      };
    });

    return ranked.sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      // Empate resolvido pelo id, para que a ordem não dependa da ordem de registro — um
      // roteamento que muda sozinho é impossível de investigar depois.
      return a.provider.localeCompare(b.provider);
    });
  }

  /** O melhor elegível. Erro claro quando ninguém serve, em vez de submeter e falhar. */
  async choose(request: RoutingRequest, context: RoutingContext = {}): Promise<ImageProvider> {
    const ranked = await this.rank(request, context);
    const best = ranked.find((entry) => entry.eligible);

    if (!best) {
      const why = ranked.map((entry) => `${entry.provider}: ${entry.notes.join(', ')}`).join('; ');
      throw new ProviderError(
        'invalid_request',
        'NO_ELIGIBLE_PROVIDER',
        `Nenhum provedor atende a este pedido. ${why}`,
      );
    }

    return this.registry.get(best.provider);
  }
}

/**
 * O que torna um provedor inviável para ESTE pedido.
 *
 * Tudo aqui é impossibilidade técnica, não preferência: submeter mesmo assim gastaria uma
 * chamada para receber um erro previsível.
 */
function disqualify(capabilities: ProviderCapabilities, request: RoutingRequest): string[] {
  const blocking: string[] = [];

  if (!capabilities.supportedAspectRatios.includes(request.aspectRatio)) {
    blocking.push(`não suporta proporção ${request.aspectRatio}`);
  }
  // Formato NÃO entra aqui de propósito. O que o provedor devolve é o arquivo de trabalho; o
  // formato que o usuário pediu é aplicado na exportação, por conversão. Descartar um
  // provedor por isso recusaria a cena inteira por uma diferença que já tem solução.
  if (request.count > capabilities.maxOutputs) {
    blocking.push(`gera no máximo ${capabilities.maxOutputs} imagens`);
  }
  if (request.referenceCount > capabilities.maxReferenceImages) {
    blocking.push(`aceita no máximo ${capabilities.maxReferenceImages} referências`);
  }
  if (request.referenceCount > 1 && !capabilities.multipleReferences) {
    blocking.push('aceita uma referência só');
  }
  if (request.operation === 'MASKED_EDIT' && !capabilities.maskedEdit) {
    blocking.push('não faz edição por máscara');
  }
  if (request.operation === 'IMAGE_TO_IMAGE' && !capabilities.imageToImage) {
    blocking.push('não faz imagem a partir de imagem');
  }
  // Fundo transparente não tem substituto: ou o provedor entrega alfa, ou a entrega está
  // errada. Recortar depois seria inventar um resultado que ninguém pediu.
  if (request.transparentBackground && !capabilities.transparentBackground) {
    blocking.push('não entrega fundo transparente');
  }

  return blocking;
}

/**
 * O quanto o provedor atende ao pedido além do mínimo.
 *
 * Só entram aqui as faltas com contorno: sem seed a imagem sai, mas não se repete; sem
 * negative prompt o compilador dobra as restrições dentro do prompt principal, e funciona
 * pior. São motivo para preferir outro, não para descartar.
 */
function capabilityScore(
  capabilities: ProviderCapabilities,
  request: RoutingRequest,
  notes: string[],
): number {
  let score = 1;

  if (request.needsSeed && !capabilities.seed) {
    score -= 0.4;
    notes.push('não reproduz por seed');
  }
  if (request.needsNegativePrompt && !capabilities.negativePrompt) {
    score -= 0.25;
    notes.push('restrições vão dentro do prompt principal');
  }
  if (request.referenceCount > 0 && !capabilities.multipleReferences) {
    score -= 0.1;
  }

  return Math.max(0, score);
}
