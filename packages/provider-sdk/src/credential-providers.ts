/**
 * Provedores que exigem chave do próprio usuário (BYOK).
 *
 * A lista vive aqui, e não na API, porque tanto a API (validar o que o usuário cadastra)
 * quanto o worker (montar o provedor na hora de gerar) precisam concordar sobre quais ids
 * existem. Duas listas divergiriam no dia em que um provedor fosse renomeado.
 *
 * Os provedores fake NÃO estão aqui: eles não têm fornecedor, não têm conta e não têm fatura.
 */

export interface CredentialProvider {
  id: string;
  label: string;
  /** Onde a pessoa obtém a chave. Vai para a tela, ao lado do campo. */
  helpUrl: string;
  /** Prefixo esperado, quando o fornecedor usa um. Só para errar cedo, nunca para autorizar. */
  keyPrefix?: string;
  /**
   * O que mais precisa estar em ordem além da chave.
   *
   * Chave válida não basta em todo fornecedor, e descobrir isso na primeira geração — por um
   * erro de cota — custa uma sessão inteira de confusão. Dizer antes é mais barato.
   */
  requirement?: string;
}

export const CREDENTIAL_PROVIDERS: readonly CredentialProvider[] = [
  {
    id: 'google-gemini',
    label: 'Google Gemini',
    helpUrl: 'https://aistudio.google.com/apikey',
    keyPrefix: 'AIza',
    requirement:
      'O projeto precisa de faturamento configurado. No nível gratuito os modelos de imagem respondem com erro de cota, e a chave parece inválida sem estar.',
  },
  {
    id: 'openai-image',
    label: 'OpenAI',
    helpUrl: 'https://platform.openai.com/api-keys',
    keyPrefix: 'sk-',
    requirement:
      'Gera em 1:1, 3:2 e 2:3 apenas — cenas noutras proporções continuam indo para outro provedor. Em compensação, a máscara de edição é usada como máscara de verdade.',
  },
];

export function isCredentialProvider(id: string): boolean {
  return CREDENTIAL_PROVIDERS.some((provider) => provider.id === id);
}

export function credentialProvider(id: string): CredentialProvider | undefined {
  return CREDENTIAL_PROVIDERS.find((provider) => provider.id === id);
}
