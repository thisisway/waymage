import { describe, expect, it } from 'vitest';
import { isBlocking, moderateText } from './moderation';

describe('moderateText', () => {
  it('deixa passar uma cena comum', () => {
    const result = moderateText('uma xícara de café numa mesa de madeira, luz da manhã');

    expect(result.verdict).toBe('ALLOW');
    expect(result.categories).toEqual([]);
  });

  it('bloqueia o que não tem contexto que salve', () => {
    const result = moderateText('csam');

    expect(result.verdict).toBe('BLOCK');
    expect(result.categories).toContain('csae');
    // A mensagem não repete o termo: ela vai para a tela e para o log.
    expect(result.reason).not.toContain('csam');
  });

  it('manda para revisão humana o que uma lista não decide sozinha', () => {
    // "Criança" e "sensual" na mesma cena podem ser uma descrição infeliz de foto de família
    // ou algo muito pior, e a diferença não está no texto.
    const result = moderateText('retrato de uma criança em pose sensual');

    expect(result.verdict).toBe('REVIEW_REQUIRED');
    expect(result.categories).toContain('minors_sexualized');
  });

  it('não confunde menor de idade sozinho com contexto sexual', () => {
    expect(moderateText('uma criança soltando pipa na praia').verdict).toBe('ALLOW');
    expect(moderateText('fotografia sensual em estúdio').verdict).toBe('ALLOW');
  });

  it('avisa sobre semelhança com pessoa real sem impedir', () => {
    const result = moderateText('uma celebridade segurando o produto');

    expect(result.verdict).toBe('ALLOW_WITH_WARNING');
    expect(isBlocking(result.verdict)).toBe(false);
    expect(result.reason).toContain('autorização');
  });

  it('avisa sobre marca de terceiro', () => {
    expect(moderateText('camiseta com o logo da concorrente').verdict).toBe('ALLOW_WITH_WARNING');
  });

  it('ignora acento e caixa', () => {
    expect(moderateText('PORNOGRAFIA INFANTIL').verdict).toBe('BLOCK');
    expect(moderateText('uma criança em pose sensual').verdict).toBe('REVIEW_REQUIRED');
  });

  it('o pior veredicto prevalece quando duas regras batem', () => {
    // Sem a ordem por gravidade, o aviso brando de "celebridade" apareceria primeiro e
    // encobriria o bloqueio.
    const result = moderateText('celebridade, csam');

    expect(result.verdict).toBe('BLOCK');
  });

  it('só BLOCK e REVIEW_REQUIRED impedem o job', () => {
    expect(isBlocking('BLOCK')).toBe(true);
    expect(isBlocking('REVIEW_REQUIRED')).toBe(true);
    expect(isBlocking('ALLOW_WITH_WARNING')).toBe(false);
    expect(isBlocking('ALLOW')).toBe(false);
  });
});
