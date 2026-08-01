import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret, secretHint, secretsMatch } from './secret-box';

const KEY = 'uma chave de cifra com mais de trinta e dois caracteres';
const OTHER = 'outra chave de cifra igualmente longa o suficiente';

describe('sealSecret / openSecret', () => {
  it('vai e volta', () => {
    const secret = 'AIzaSyD-exemplo-de-chave-do-google-1234567';

    expect(openSecret(sealSecret(secret, KEY), KEY)).toBe(secret);
  });

  it('nunca produz o mesmo texto cifrado duas vezes', () => {
    const secret = 'chave-repetida';

    // Nonce novo a cada operação. Se dois selos do mesmo valor saíssem iguais, o banco
    // revelaria quais workspaces usam a mesma chave — e reusar nonce quebra a autenticação
    // do GCM inteiro.
    expect(sealSecret(secret, KEY)).not.toBe(sealSecret(secret, KEY));
  });

  it('não guarda o segredo em claro', () => {
    const sealed = sealSecret('AIzaSy-segredo-visivel', KEY);

    expect(sealed).not.toContain('AIzaSy');
    expect(sealed).not.toContain('segredo');
  });

  it('recusa a chave errada', () => {
    const sealed = sealSecret('qualquer coisa', KEY);

    expect(() => openSecret(sealed, OTHER)).toThrow();
  });

  it('recusa texto adulterado', () => {
    const sealed = sealSecret('qualquer coisa', KEY);
    const parts = sealed.split('.');
    const payload = Buffer.from(parts[3] ?? '', 'base64url');
    payload[0] = (payload[0] ?? 0) ^ 0xff;

    // É isto que o GCM compra e o CBC não: adulterar o texto cifrado falha em vez de
    // decifrar para outra coisa sem ninguém perceber.
    expect(() =>
      openSecret([parts[0], parts[1], parts[2], payload.toString('base64url')].join('.'), KEY),
    ).toThrow();
  });

  it('recusa formato desconhecido', () => {
    expect(() => openSecret('nada disso', KEY)).toThrow(/formato desconhecido/i);
    expect(() => openSecret('v2.a.b.c', KEY)).toThrow(/formato desconhecido/i);
  });

  it('exige chave de cifra com tamanho mínimo', () => {
    expect(() => sealSecret('x', 'curta demais')).toThrow(/32 caracteres/);
  });
});

describe('secretHint', () => {
  it('devolve os últimos quatro caracteres', () => {
    expect(secretHint('AIzaSyD-exemplo-1234')).toBe('1234');
  });

  it('devolve vazio quando a chave é curta', () => {
    // Mostrar quatro de uma chave de seis entregaria a maior parte dela.
    expect(secretHint('abc123')).toBe('');
  });
});

describe('secretsMatch', () => {
  it('compara sem vazar tempo', () => {
    expect(secretsMatch('igual', 'igual')).toBe(true);
    expect(secretsMatch('igual', 'outro')).toBe(false);
    expect(secretsMatch('curto', 'muito mais longo')).toBe(false);
  });
});
