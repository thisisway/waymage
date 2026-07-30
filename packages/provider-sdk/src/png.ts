import { deflateSync } from 'node:zlib';

/**
 * Codificador PNG mínimo (RGB, 8 bits, sem filtro), usado apenas pelo FakeImageProvider.
 *
 * Existe para que o desenvolvimento não precise de dependência nativa de imagem: o
 * placeholder sai de `node:zlib` e mais nada. Quando o worker precisar de miniatura de
 * verdade (Fase 4), aí sim entra uma biblioteca de imagem — para uploads reais, não para
 * o fake.
 *
 * ponytail: sem suporte a alpha nem a paleta; se o fake precisar simular transparência,
 * trocar por RGBA (color type 6) é adicionar um canal aqui.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type PixelFn = (x: number, y: number) => readonly [number, number, number];

/** Gera um PNG RGB a partir de uma função de pixel. */
export function encodePng(width: number, height: number, pixel: PixelFn): Buffer {
  if (width < 1 || height < 1) throw new Error('Dimensões de PNG devem ser positivas.');

  // Cada scanline começa com o byte de filtro (0 = None).
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    let offset = y * stride + 1;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[offset++] = r & 0xff;
      raw[offset++] = g & 0xff;
      raw[offset++] = b & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
