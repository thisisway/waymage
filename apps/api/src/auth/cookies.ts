import type { CookieSerializeOptions } from '@fastify/cookie';
import { env } from '../config/env';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from './tokens';

/**
 * Cookies de sessão.
 *
 * Access e refresh são `httpOnly`: o JavaScript da página nunca os enxerga, então um XSS não
 * consegue exfiltrar a sessão. O preço é precisar de proteção CSRF, resolvida pelo cookie
 * `csrf`, que é o único legível — ele não dá acesso a nada sozinho, serve só para o cliente
 * espelhar seu valor num header.
 */

export const COOKIE = {
  access: 'wm_at',
  refresh: 'wm_rt',
  csrf: 'wm_csrf',
} as const;

export const CSRF_HEADER = 'x-csrf-token';

/** `Secure` só fora de desenvolvimento: em http://localhost o browser descartaria o cookie. */
const secure = env.NODE_ENV === 'production';

const base: CookieSerializeOptions = {
  path: '/',
  sameSite: 'lax',
  secure,
};

export const accessCookieOptions: CookieSerializeOptions = {
  ...base,
  httpOnly: true,
  maxAge: ACCESS_TOKEN_TTL_SECONDS,
};

/**
 * O refresh só é enviado para `/auth/refresh` e `/auth/logout`.
 *
 * Restringir o `path` faz o browser omitir o token em todo o resto da API — se algum
 * endpoint vazar headers em log ou erro, o refresh não estava lá para vazar junto.
 */
export const refreshCookieOptions: CookieSerializeOptions = {
  ...base,
  httpOnly: true,
  path: '/auth',
  maxAge: REFRESH_TOKEN_TTL_SECONDS,
};

/** Legível por JavaScript de propósito: o cliente precisa copiá-lo para o header. */
export const csrfCookieOptions: CookieSerializeOptions = {
  ...base,
  httpOnly: false,
  maxAge: REFRESH_TOKEN_TTL_SECONDS,
};

/** Opções de remoção precisam bater com as de criação, senão o browser ignora. */
export const clearOptions = {
  access: { ...accessCookieOptions, maxAge: 0 },
  refresh: { ...refreshCookieOptions, maxAge: 0 },
  csrf: { ...csrfCookieOptions, maxAge: 0 },
} as const;
