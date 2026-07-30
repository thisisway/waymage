/**
 * Erros de provedor classificados pelo que o orquestrador precisa decidir:
 * pode tentar de novo? deve trocar de provedor? deve devolver o crédito?
 */
export type ProviderErrorKind =
  /** Falha transitória — vale retry no mesmo provedor. */
  | 'transient'
  /** Provedor indisponível ou com erro persistente — vale fallback. */
  | 'unavailable'
  /** Estouro de tempo. */
  | 'timeout'
  /** Rejeitado por política de conteúdo — não tentar de novo. */
  | 'content_policy'
  /** Requisição inválida (nossa culpa) — não tentar de novo. */
  | 'invalid_request'
  /** Cota ou rate limit do provedor. */
  | 'quota'
  /** Credencial inválida. */
  | 'auth';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly code: string,
    message: string,
    readonly provider?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  /** Vale tentar de novo no mesmo provedor? */
  get retryable(): boolean {
    return this.kind === 'transient' || this.kind === 'timeout' || this.kind === 'quota';
  }

  /** Vale tentar em outro provedor? */
  get failoverable(): boolean {
    return this.kind === 'unavailable' || this.kind === 'quota' || this.kind === 'timeout';
  }

  /**
   * A reserva de créditos deve ser devolvida?
   * Só não devolvemos quando a falha é atribuível ao conteúdo pedido pelo usuário.
   */
  get refundable(): boolean {
    return this.kind !== 'content_policy';
  }
}
