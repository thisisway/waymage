import { describe, expect, it } from 'vitest';
import { roleSatisfies } from './auth.guard';
import {
  hashRefreshToken,
  issueCsrfToken,
  issueRefreshToken,
  REFRESH_TOKEN_TTL_SECONDS,
} from './tokens';

describe('refresh token', () => {
  it('gera token com entropia suficiente e nunca repetido', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => issueRefreshToken().token));
    expect(tokens.size).toBe(200);
    // 32 bytes em base64url ≈ 43 caracteres.
    expect([...tokens][0]!.length).toBeGreaterThanOrEqual(43);
  });

  it('devolve hash, nunca o token, para persistência', () => {
    const issued = issueRefreshToken();
    expect(issued.tokenHash).toBe(hashRefreshToken(issued.token));
    expect(issued.tokenHash).not.toBe(issued.token);
    // O hash não pode conter o token: é o que protege a sessão se o banco vazar.
    expect(issued.tokenHash).not.toContain(issued.token);
  });

  it('mantém a família na rotação, para permitir detectar reuso', () => {
    const first = issueRefreshToken();
    const rotated = issueRefreshToken(first.family);
    expect(rotated.family).toBe(first.family);
    expect(rotated.token).not.toBe(first.token);
  });

  it('inicia famílias distintas por login', () => {
    expect(issueRefreshToken().family).not.toBe(issueRefreshToken().family);
  });

  it('expira em 7 dias a partir do momento informado', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const issued = issueRefreshToken('f', now);
    expect(issued.expiresAt.getTime() - now.getTime()).toBe(REFRESH_TOKEN_TTL_SECONDS * 1000);
  });

  it('token CSRF é aleatório', () => {
    expect(issueCsrfToken()).not.toBe(issueCsrfToken());
  });
});

describe('hierarquia de papéis', () => {
  it('papel mais alto satisfaz exigência de papel mais baixo', () => {
    expect(roleSatisfies('OWNER', 'VIEWER')).toBe(true);
    expect(roleSatisfies('ADMIN', 'MEMBER')).toBe(true);
    expect(roleSatisfies('MEMBER', 'MEMBER')).toBe(true);
  });

  it('papel mais baixo não satisfaz exigência de papel mais alto', () => {
    expect(roleSatisfies('VIEWER', 'MEMBER')).toBe(false);
    expect(roleSatisfies('MEMBER', 'ADMIN')).toBe(false);
    expect(roleSatisfies('ADMIN', 'OWNER')).toBe(false);
  });

  it('VIEWER não pode criar nem apagar nada', () => {
    expect(roleSatisfies('VIEWER', 'MEMBER')).toBe(false);
    expect(roleSatisfies('VIEWER', 'ADMIN')).toBe(false);
  });
});
