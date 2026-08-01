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
}

export const CREDENTIAL_PROVIDERS: readonly CredentialProvider[] = [
  {
    id: 'google-gemini',
    label: 'Google Gemini',
    helpUrl: 'https://aistudio.google.com/apikey',
    keyPrefix: 'AIza',
  },
];

export function isCredentialProvider(id: string): boolean {
  return CREDENTIAL_PROVIDERS.some((provider) => provider.id === id);
}

export function credentialProvider(id: string): CredentialProvider | undefined {
  return CREDENTIAL_PROVIDERS.find((provider) => provider.id === id);
}
