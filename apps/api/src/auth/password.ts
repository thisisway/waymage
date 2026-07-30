import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** `promisify` perde a sobrecarga com `options`, então o wrapper é escrito à mão. */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/**
 * Hash de senha com scrypt do `node:crypto`.
 *
 * scrypt é um KDF memory-hard e consta na lista de algoritmos aceitáveis do OWASP. Foi
 * escolhido no lugar de argon2id porque este não existe na stdlib e as implementações
 * disponíveis são módulos nativos — binário por plataforma, glibc vs musl, compilação em
 * imagem Docker. Zero dependências vale mais aqui do que a diferença marginal entre os dois.
 *
 * Parâmetros conforme recomendação OWASP: N=2^17, r=8, p=1.
 */
const SCRYPT_PARAMS = {
  N: 1 << 17,
  r: 8,
  p: 1,
  keyLength: 64,
  saltLength: 32,
  /** scrypt precisa de mais memória do que o default de 32 MiB do Node com N=2^17. */
  maxmem: 256 * 1024 * 1024,
} as const;

const PREFIX = 'scrypt';

/** Formato: `scrypt$N$r$p$salt$hash`, tudo em base64url. Autodescritivo para rotação futura. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_PARAMS.saltLength);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, SCRYPT_PARAMS.keyLength, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });

  return [
    PREFIX,
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

/**
 * Verifica a senha em tempo constante.
 *
 * Nunca lança por hash malformado: devolve `false`. Um erro aqui viraria 500 e distinguiria
 * "usuário existe com hash quebrado" de "usuário não existe" — canal de enumeração.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(parts[4] as string, 'base64url');
  const expected = Buffer.from(parts[5] as string, 'base64url');
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_PARAMS.maxmem,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Hash descartável usado quando o e-mail não existe.
 *
 * Sem isto, login com e-mail inexistente responde na hora e login com e-mail válido demora o
 * tempo do scrypt — a diferença revela quais e-mails estão cadastrados. Gastar o mesmo tempo
 * nos dois casos fecha o canal.
 */
export const DUMMY_PASSWORD_HASH =
  'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
