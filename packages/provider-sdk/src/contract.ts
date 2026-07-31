import { describe, expect, it } from 'vitest';
import { ProviderError } from './errors';
import type { ImageProvider, ProviderGenerationRequest } from './types';

/**
 * Suíte de contrato: o que todo `ImageProvider` precisa cumprir.
 *
 * Existe porque a promessa da interface é trocar de fornecedor sem tocar no orquestrador — e
 * essa promessa só vale se cada adapter se comportar igual nas bordas. Um provedor que
 * devolve `succeeded` sem imagens, ou que aceita mais saídas do que declara, quebra o
 * orquestrador de um jeito que só aparece em produção.
 *
 * O adapter novo importa isto e roda contra si mesmo. Falhar aqui é falhar o contrato, não o
 * teste.
 *
 * O que NÃO é verificado: qualidade da imagem, aderência ao prompt e custo real. Nada disso
 * é verificável sem chamar o fornecedor de verdade, e um teste que precisa de chave paga não
 * roda em CI.
 */
export interface ProviderContractOptions {
  /** Fábrica: cada caso recebe uma instância limpa. */
  create: () => ImageProvider;
  /**
   * Espera o job terminar. Provedores com latência simulada precisam avançar o relógio;
   * adapters reais fazem polling de verdade.
   */
  settle?: (provider: ImageProvider, providerJobId: string) => Promise<void>;
}

export function runProviderContract(name: string, options: ProviderContractOptions): void {
  const settle = options.settle ?? (async () => undefined);

  function request(overrides: Partial<ProviderGenerationRequest> = {}): ProviderGenerationRequest {
    return {
      requestId: 'contract',
      prompt: 'uma cena de teste',
      references: [],
      aspectRatio: '1:1',
      format: 'png',
      count: 1,
      mode: 'draft',
      ...overrides,
    };
  }

  describe(`contrato de provedor: ${name}`, () => {
    it('declara capacidades coerentes', () => {
      const capabilities = options.create().getCapabilities();

      expect(capabilities.supportedAspectRatios.length).toBeGreaterThan(0);
      expect(capabilities.supportedFormats.length).toBeGreaterThan(0);
      expect(capabilities.maxOutputs).toBeGreaterThan(0);
      expect(capabilities.maxReferenceImages).toBeGreaterThanOrEqual(0);
      // Sem textToImage não há o que rotear: toda operação parte de um prompt.
      expect(capabilities.textToImage).toBe(true);
      // Edição por máscara sem imagem a partir de imagem é contradição.
      if (capabilities.maskedEdit) expect(capabilities.imageToImage).toBe(true);
    });

    it('estima custo positivo e proporcional à quantidade', async () => {
      const provider = options.create();

      const uma = await provider.estimateCost(request({ count: 1 }));
      const duas = await provider.estimateCost(request({ count: 2 }));

      expect(uma.credits).toBeGreaterThan(0);
      expect(uma.estimatedLatencyMs).toBeGreaterThanOrEqual(0);
      // Não precisa ser linear, mas não pode ficar mais barato pedindo mais.
      expect(duas.credits).toBeGreaterThanOrEqual(uma.credits);
    });

    it('devolve um identificador de job na submissão', async () => {
      const provider = options.create();

      const handle = await provider.generate(request());

      expect(handle.providerJobId).toBeTruthy();
      expect(handle.provider).toBe(provider.id);
    });

    it('recusa mais saídas do que declara suportar', async () => {
      const provider = options.create();
      const limit = provider.getCapabilities().maxOutputs;

      // Recusar na submissão é o ponto: descobrir isso no polling significa ter esperado por
      // um resultado que nunca viria.
      await expect(provider.generate(request({ count: limit + 1 }))).rejects.toBeInstanceOf(
        ProviderError,
      );
    });

    it('entrega imagens quando chega a succeeded', async () => {
      const provider = options.create();
      const handle = await provider.generate(request({ count: 1 }));
      await settle(provider, handle.providerJobId);

      const status = await provider.getStatus(handle.providerJobId);

      expect(status.state).toBe('succeeded');
      // `succeeded` sem imagem é o pior caso: o orquestrador captura o crédito e não entrega
      // nada. Ou há imagem, ou o estado não é esse.
      expect(status.images.length).toBeGreaterThan(0);
      for (const image of status.images) {
        expect(image.data.length).toBeGreaterThan(0);
        expect(image.width).toBeGreaterThan(0);
        expect(image.height).toBeGreaterThan(0);
        expect(image.mimeType).toMatch(/^image\//);
      }
    });

    it('progresso fica entre 0 e 1', async () => {
      const provider = options.create();
      const handle = await provider.generate(request());

      const inicio = await provider.getStatus(handle.providerJobId);
      expect(inicio.progress).toBeGreaterThanOrEqual(0);
      expect(inicio.progress).toBeLessThanOrEqual(1);

      await settle(provider, handle.providerJobId);
      const fim = await provider.getStatus(handle.providerJobId);
      expect(fim.progress).toBeLessThanOrEqual(1);
    });

    it('job desconhecido é erro, não status inventado', async () => {
      const provider = options.create();

      await expect(provider.getStatus('nao-existe')).rejects.toBeInstanceOf(ProviderError);
    });

    it('cancelamento leva a cancelled', async () => {
      const provider = options.create();
      const handle = await provider.generate(request());

      await provider.cancel(handle.providerJobId);
      const status = await provider.getStatus(handle.providerJobId);

      expect(status.state).toBe('cancelled');
      expect(status.images).toHaveLength(0);
    });

    it('cancelar duas vezes não explode', async () => {
      const provider = options.create();
      const handle = await provider.generate(request());

      // O orquestrador cancela por timeout e o usuário pode cancelar junto; a corrida entre
      // os dois é normal e não pode virar erro.
      await provider.cancel(handle.providerJobId);
      await expect(provider.cancel(handle.providerJobId)).resolves.toBeUndefined();
    });

    it('edição exige imagem base', async () => {
      const provider = options.create();
      if (!provider.getCapabilities().maskedEdit) return;

      await expect(
        provider.edit({ ...request({ mode: 'edit' }), baseImageUrl: '' }),
      ).rejects.toBeInstanceOf(ProviderError);
    });
  });
}
