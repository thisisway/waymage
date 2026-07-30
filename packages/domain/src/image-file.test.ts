import { describe, expect, it } from 'vitest';
import { detectImageType, isAllowedImageType, MAX_UPLOAD_BYTES } from './image-file';

/** Constrói um buffer começando pelos bytes informados. */
function withSignature(...bytes: number[]): Uint8Array {
  const buffer = new Uint8Array(32);
  buffer.set(bytes, 0);
  return buffer;
}

const JPEG = withSignature(0xff, 0xd8, 0xff, 0xe0);
const PNG = withSignature(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function webp(): Uint8Array {
  const buffer = new Uint8Array(32);
  buffer.set(
    [...'RIFF'].map((c) => c.charCodeAt(0)),
    0,
  );
  buffer.set(
    [...'WEBP'].map((c) => c.charCodeAt(0)),
    8,
  );
  return buffer;
}

describe('detecção de tipo por assinatura', () => {
  it('identifica os formatos aceitos', () => {
    expect(detectImageType(JPEG)).toBe('image/jpeg');
    expect(detectImageType(PNG)).toBe('image/png');
    expect(detectImageType(webp())).toBe('image/webp');
  });

  it('rejeita SVG, que é XML e executa script', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(detectImageType(svg)).toBeNull();
  });

  it('rejeita HTML disfarçado de imagem', () => {
    expect(detectImageType(new TextEncoder().encode('<!DOCTYPE html><script>'))).toBeNull();
  });

  it('rejeita executável e arquivo compactado', () => {
    // MZ (PE do Windows) e PK (ZIP).
    expect(detectImageType(withSignature(0x4d, 0x5a))).toBeNull();
    expect(detectImageType(withSignature(0x50, 0x4b, 0x03, 0x04))).toBeNull();
  });

  it('rejeita GIF, que não está na lista de permitidos', () => {
    const gif = new TextEncoder().encode('GIF89a');
    expect(detectImageType(gif)).toBeNull();
  });

  it('não estoura com arquivo vazio ou truncado', () => {
    expect(detectImageType(new Uint8Array(0))).toBeNull();
    expect(detectImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
  });

  it('a lista de tipos permitidos não inclui svg', () => {
    expect(isAllowedImageType('image/svg+xml')).toBe(false);
    expect(isAllowedImageType('image/png')).toBe(true);
  });

  it('mantém um teto de tamanho', () => {
    expect(MAX_UPLOAD_BYTES).toBeGreaterThan(0);
    expect(MAX_UPLOAD_BYTES).toBeLessThanOrEqual(25 * 1024 * 1024);
  });
});
