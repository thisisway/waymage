import { describe, expect, it } from 'vitest';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password';

// scrypt com N=2^17 é lento de propósito — é o ponto do algoritmo.
const TIMEOUT = 30_000;

describe('hash de senha', () => {
  it(
    'aceita a senha correta e recusa a errada',
    async () => {
      const hash = await hashPassword('uma frase longa de senha');
      expect(await verifyPassword('uma frase longa de senha', hash)).toBe(true);
      expect(await verifyPassword('uma frase longa de senhA', hash)).toBe(false);
      expect(await verifyPassword('', hash)).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'gera hashes diferentes para a mesma senha',
    async () => {
      const [a, b] = await Promise.all([
        hashPassword('mesma senha aqui'),
        hashPassword('mesma senha aqui'),
      ]);
      // Salt aleatório: dois usuários com a mesma senha não podem ter o mesmo hash, senão
      // um vazamento revela quem compartilha senha.
      expect(a).not.toBe(b);
      expect(await verifyPassword('mesma senha aqui', b)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'guarda os parâmetros no próprio hash, para permitir rotação futura',
    async () => {
      const hash = await hashPassword('senha de exemplo longa');
      const [algo, N, r, p] = hash.split('$');
      expect(algo).toBe('scrypt');
      expect(Number(N)).toBe(131072);
      expect([r, p]).toEqual(['8', '1']);
      expect(hash.split('$')).toHaveLength(6);
    },
    TIMEOUT,
  );

  it(
    'nunca guarda a senha em claro',
    async () => {
      const hash = await hashPassword('canario-secreto-123456');
      expect(hash).not.toContain('canario-secreto-123456');
    },
    TIMEOUT,
  );

  it('devolve false para hash malformado em vez de lançar', async () => {
    // Lançar viraria 500 e distinguiria "usuário existe" de "não existe".
    for (const bad of ['', 'lixo', 'scrypt$1$2$3', 'bcrypt$1$2$3$4$5', 'scrypt$x$y$z$a$b']) {
      await expect(verifyPassword('qualquer', bad)).resolves.toBe(false);
    }
  });

  it(
    'o hash dummy tem formato válido e não casa com nada',
    async () => {
      // Se o dummy fosse malformado, verifyPassword sairia cedo e o login com e-mail
      // inexistente responderia rápido — exatamente o vazamento de tempo que ele evita.
      expect(DUMMY_PASSWORD_HASH.split('$')).toHaveLength(6);
      expect(await verifyPassword('qualquer senha', DUMMY_PASSWORD_HASH)).toBe(false);
    },
    TIMEOUT,
  );
});
