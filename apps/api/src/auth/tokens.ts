import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * Refresh token: valor opaco aleatório, guardado no banco apenas como hash.
 *
 * Não é JWT de propósito. Refresh precisa ser revogável na hora, e JWT só expira. Como o
 * token é aleatório de 256 bits, SHA-256 sem salt basta — não há o que forçar por dicionário
 * num valor sem entropia baixa, e a busca precisa ser por igualdade indexada.
 */

export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface IssuedRefreshToken {
  /** Vai para o cookie do usuário. Nunca é persistido. */
  token: string;
  /** Vai para o banco. */
  tokenHash: string;
  family: string;
  expiresAt: Date;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** `family` novo inicia uma sessão; reaproveitá-lo mantém a linhagem de uma rotação. */
export function issueRefreshToken(
  family: string = randomUUID(),
  now: Date = new Date(),
): IssuedRefreshToken {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashRefreshToken(token),
    family,
    expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
  };
}

/** Conteúdo do access token. Deliberadamente mínimo: só identidade. */
export interface AccessTokenClaims {
  sub: string;
  email: string;
}

/**
 * O access token **não** carrega workspace nem papel.
 *
 * Se carregasse, remover alguém de um workspace ou rebaixar seu papel só teria efeito quando
 * o token expirasse — até 15 minutos de acesso indevido. A associação é lida do banco a cada
 * request, que é uma consulta indexada e barata perto do risco de autorização defasada.
 */
export const ACCESS_TOKEN_AUDIENCE = 'waymage-api';
export const ACCESS_TOKEN_ISSUER = 'waymage';

/** Token CSRF do esquema double-submit: valor aleatório em cookie legível + header espelhado. */
export function issueCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}
