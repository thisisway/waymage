import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { THUMBNAIL_MAX_SIDE } from './asset-processor';

/**
 * Remoção de metadados e redimensionamento.
 *
 * Testa o pipeline do sharp isoladamente, sem banco nem storage: o que precisa ficar provado
 * é que os metadados somem e que a miniatura respeita o teto — e isso não depende de I/O.
 *
 * EXIF carrega coordenadas de GPS e modelo do aparelho. Um retrato enviado como referência
 * não deveria revelar onde a pessoa estava, então a ausência desses campos é requisito de
 * privacidade, não detalhe de implementação.
 */

/** Reproduz exatamente o pipeline de `processAssetJob`. */
function thumbnailPipeline(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(THUMBNAIL_MAX_SIDE, THUMBNAIL_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

async function jpegWithExif(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 80, b: 60 } },
  })
    .withExif({
      IFD0: { Make: 'ACME Camera', Model: 'X-1000' },
      IFD2: { GPSLatitudeRef: 'S', GPSLongitudeRef: 'W' },
    })
    .jpeg()
    .toBuffer();
}

describe('processamento de referência', () => {
  it('descarta EXIF, incluindo GPS e modelo do aparelho', async () => {
    const original = await jpegWithExif(800, 600);

    // Confirma que o original realmente tem o que precisa ser removido — sem isto, o teste
    // passaria mesmo se o sharp nunca tivesse gravado EXIF nenhum.
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const thumbnail = await thumbnailPipeline(original);
    const metadata = await sharp(thumbnail).metadata();

    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    // E os valores não sobrevivem em lugar nenhum do arquivo.
    expect(thumbnail.includes(Buffer.from('ACME Camera'))).toBe(false);
    expect(thumbnail.includes(Buffer.from('X-1000'))).toBe(false);
  });

  it('reduz a imagem ao teto da miniatura', async () => {
    const original = await jpegWithExif(2400, 1600);
    const metadata = await sharp(await thumbnailPipeline(original)).metadata();

    expect(metadata.width).toBe(THUMBNAIL_MAX_SIDE);
    expect(metadata.height).toBe(Math.round((THUMBNAIL_MAX_SIDE * 1600) / 2400));
    expect(metadata.format).toBe('webp');
  });

  it('não amplia imagem menor que o teto', async () => {
    // Ampliar não acrescenta informação e só aumenta o arquivo.
    const metadata = await sharp(await thumbnailPipeline(await jpegWithExif(120, 90))).metadata();
    expect(metadata.width).toBe(120);
    expect(metadata.height).toBe(90);
  });

  it('produz miniatura muito menor que o original', async () => {
    const original = await jpegWithExif(2400, 1600);
    const thumbnail = await thumbnailPipeline(original);
    // O ponto da miniatura é a biblioteca carregar rápido com dezenas de imagens.
    expect(thumbnail.length).toBeLessThan(original.length);
  });

  it('recusa arquivo que não é imagem em vez de gravar lixo', async () => {
    const naoImagem = Buffer.from('<!DOCTYPE html><script>alert(1)</script>');
    await expect(thumbnailPipeline(naoImagem)).rejects.toThrow();
  });
});
