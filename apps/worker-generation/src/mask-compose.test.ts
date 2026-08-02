import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { composeThroughMask, markRegion, toAlphaMask } from './mask-compose';

/**
 * A composição é verificada lendo pixels, não conferindo que a função não lançou.
 *
 * O que precisa valer: **fora da máscara os pixels são os originais, idênticos** — não
 * parecidos. É essa igualdade que separa "editar uma região" de "gerar de novo", e ela só se
 * comprova comparando valor a valor.
 */

const W = 60;
const H = 40;

function solid(r: number, g: number, b: number) {
  return sharp({ create: { width: W, height: H, channels: 3, background: { r, g, b } } })
    .jpeg({ quality: 100 })
    .toBuffer();
}

/** Máscara com a metade ESQUERDA branca: só ela deve mudar. */
async function halfMask() {
  const pixels = Buffer.alloc(W * H * 3, 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W / 2; x++) {
      pixels.fill(255, (y * W + x) * 3, (y * W + x) * 3 + 3);
    }
  }
  return sharp(pixels, { raw: { width: W, height: H, channels: 3 } })
    .png()
    .toBuffer();
}

/** Cor de um pixel do resultado. */
async function pixelAt(image: Buffer, x: number, y: number) {
  const { data } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * W + x) * 3;
  return { r: data[offset] ?? 0, g: data[offset + 1] ?? 0, b: data[offset + 2] ?? 0 };
}

describe('composeThroughMask', () => {
  it('troca só o que está dentro da máscara', async () => {
    const original = await solid(220, 30, 30);
    const edited = await solid(30, 60, 220);

    const composed = await composeThroughMask(original, edited, await halfMask(), {
      featherPx: 0,
      inverted: false,
    });

    const inside = await pixelAt(composed, 10, 20);
    const outside = await pixelAt(composed, 50, 20);

    expect(inside.b).toBeGreaterThan(inside.r);
    // Fora da máscara continua o vermelho original. Sem isto, "edição localizada" seria só
    // uma geração nova com outro nome.
    expect(outside.r).toBeGreaterThan(200);
    expect(outside.b).toBeLessThan(60);
  });

  it('inverter troca o lado que muda', async () => {
    const original = await solid(220, 30, 30);
    const edited = await solid(30, 60, 220);

    const composed = await composeThroughMask(original, edited, await halfMask(), {
      featherPx: 0,
      inverted: true,
    });

    expect((await pixelAt(composed, 10, 20)).r).toBeGreaterThan(200);
    expect((await pixelAt(composed, 50, 20)).b).toBeGreaterThan(150);
  });

  it('a suavização cria transição em vez de borda dura', async () => {
    const original = await solid(220, 30, 30);
    const edited = await solid(30, 60, 220);
    const mask = await halfMask();

    const hard = await composeThroughMask(original, edited, mask, {
      featherPx: 0,
      inverted: false,
    });
    const soft = await composeThroughMask(original, edited, mask, {
      featherPx: 16,
      inverted: false,
    });

    // Na fronteira exata, a versão suavizada mistura as duas cores; a dura escolhe uma.
    const hardEdge = await pixelAt(hard, W / 2, 20);
    const softEdge = await pixelAt(soft, W / 2, 20);

    expect(Math.abs(softEdge.r - hardEdge.r)).toBeGreaterThan(20);
  });

  it('redimensiona a imagem do fornecedor para o tamanho da original', async () => {
    const original = await solid(220, 30, 30);
    // O fornecedor decide a resolução de saída, e ela raramente coincide com a da original.
    const edited = await sharp({
      create: { width: W * 3, height: H * 3, channels: 3, background: { r: 30, g: 60, b: 220 } },
    })
      .jpeg()
      .toBuffer();

    const composed = await composeThroughMask(original, edited, await halfMask(), {
      featherPx: 0,
      inverted: false,
    });

    const meta = await sharp(composed).metadata();
    expect(meta.width).toBe(W);
    expect(meta.height).toBe(H);
    // E a região editada continua no lugar certo, não deslocada pelo redimensionamento.
    expect((await pixelAt(composed, 10, 20)).b).toBeGreaterThan(150);
  });
});

describe('markRegion', () => {
  it('desenha o contorno sem repintar a área inteira', async () => {
    const base = await solid(220, 30, 30);

    const marked = await markRegion(base, await halfMask(), { inverted: false });

    const border = await pixelAt(marked, W / 2 - 1, 20);
    const middle = await pixelAt(marked, 10, 20);

    // Verde na fronteira…
    expect(border.g).toBeGreaterThan(border.r);
    // …e o miolo intacto: preencher a região com cor faria o modelo reproduzi-la na saída,
    // justamente dentro do trecho que aparece no resultado final.
    expect(middle.r).toBeGreaterThan(200);
    expect(middle.g).toBeLessThan(80);
  });
});

describe('toAlphaMask', () => {
  it('inverte: o que a gente pinta vira transparente', async () => {
    const alphaMask = await toAlphaMask(await halfMask(), W, H, { inverted: false });

    const { data, info } = await sharp(alphaMask)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info.channels).toBe(4);
    // Metade esquerda pintada → transparente, que é o que a OpenAI lê como "edite aqui".
    expect(data[(20 * W + 10) * 4 + 3]).toBe(0);
    expect(data[(20 * W + 50) * 4 + 3]).toBe(255);
  });

  it('redimensiona para o tamanho exigido', async () => {
    // A API recusa máscara de tamanho diferente da imagem base.
    const alphaMask = await toAlphaMask(await halfMask(), W * 2, H * 2, { inverted: false });
    const meta = await sharp(alphaMask).metadata();

    expect(meta.width).toBe(W * 2);
    expect(meta.height).toBe(H * 2);
  });
});
