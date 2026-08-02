import { describe, expect, it } from 'vitest';
import { PROVIDER_IDS, createWorkspaceRegistry } from './presets';

/**
 * A montagem do registro é onde a chave do usuário vira provedor.
 *
 * Errar aqui tem duas formas, e as duas são silenciosas: registrar um provedor sem credencial
 * faria a geração falhar só na chamada, já com o job em andamento; deixar os fakes ligados em
 * produção entregaria imagem de mentira para quem paga mensalidade.
 */
describe('createWorkspaceRegistry', () => {
  it('registra o provedor real quando há credencial', () => {
    const registry = createWorkspaceRegistry({
      credentials: [{ provider: PROVIDER_IDS.google, secret: 'AIzaSy-teste' }],
      includeFakes: false,
    });

    expect(registry.ids()).toEqual([PROVIDER_IDS.google]);
  });

  it('sem credencial, o registro fica vazio em produção', () => {
    const registry = createWorkspaceRegistry({ credentials: [], includeFakes: false });

    // Vazio é o que faz a API responder "cadastre uma chave" em vez de enfileirar um job que
    // não tem quem execute.
    expect(registry.ids()).toEqual([]);
  });

  it('os fakes entram só quando pedidos', () => {
    const dev = createWorkspaceRegistry({ credentials: [], includeFakes: true });

    expect(dev.ids()).toContain(PROVIDER_IDS.fast);
    expect(dev.ids()).toContain(PROVIDER_IDS.studio);
  });

  it('ignora credencial de provedor que não conhecemos', () => {
    // Um id órfão no banco — provedor removido do catálogo, por exemplo — não pode derrubar a
    // montagem do registro inteiro.
    const registry = createWorkspaceRegistry({
      credentials: [
        { provider: 'fornecedor-que-nao-existe', secret: 'x' },
        { provider: PROVIDER_IDS.google, secret: 'AIzaSy-teste' },
      ],
      includeFakes: false,
    });

    expect(registry.ids()).toEqual([PROVIDER_IDS.google]);
  });
});
