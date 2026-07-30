import { describe, expect, it } from 'vitest';
import { storageKeys, workspaceIdFromKey } from './keys';

describe('chaves de storage', () => {
  it('coloca o workspace no início de toda chave', () => {
    const keys = [
      storageKeys.assetOriginal('ws', 'pr', 'as', 'webp'),
      storageKeys.assetThumbnail('ws', 'pr', 'as'),
      storageKeys.mask('ws', 'pr', 'mk'),
      storageKeys.generationResult('ws', 'pr', 'jb', 0, 'png'),
      storageKeys.export('ws', 'pr', 'ex', 'zip'),
    ];
    for (const key of keys) {
      expect(key.startsWith('workspaces/ws/')).toBe(true);
      expect(workspaceIdFromKey(key)).toBe('ws');
    }
  });

  it('separa resultados por índice dentro do job', () => {
    expect(storageKeys.generationResult('w', 'p', 'j', 2, 'png')).toBe(
      'workspaces/w/projects/p/generations/j/2.png',
    );
  });

  it('devolve null para chave fora do padrão', () => {
    expect(workspaceIdFromKey('qualquer/coisa')).toBeNull();
  });
});
