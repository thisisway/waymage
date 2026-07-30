/**
 * Identificação de imagem pelo conteúdo, não pelo que o cliente declara.
 *
 * `Content-Type` e extensão são texto enviado pelo usuário: um `.png` pode ser um HTML com
 * script, um ZIP ou um executável. A única forma de saber o que é o arquivo é olhar os
 * primeiros bytes. Isto é fronteira de segurança, não conveniência — por isso mora num
 * package compartilhado, e API e worker usam exatamente a mesma função.
 */

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/**
 * SVG está fora deliberadamente: é XML, executa script e serve como vetor de XSS quando
 * servido de volta ao browser. GIF está fora por não acrescentar nada ao produto.
 */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}

/** Extensão canônica do tipo — nunca a que veio no nome do arquivo. */
export const EXTENSION_BY_TYPE: Record<AllowedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Lê a assinatura do arquivo e devolve o tipo real, ou `null` se não for imagem suportada.
 *
 * Assinaturas:
 *   JPEG  FF D8 FF
 *   PNG   89 50 4E 47 0D 0A 1A 0A
 *   WebP  "RIFF" .... "WEBP"
 */
export function detectImageType(bytes: Uint8Array): AllowedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && PNG.every((byte, index) => bytes[index] === byte)) {
    return 'image/png';
  }

  // WebP: "RIFF" nos bytes 0-3 e "WEBP" nos 8-11. O tamanho fica entre os dois.
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i] as number);
  return out;
}

/** Bytes suficientes para identificar qualquer um dos formatos aceitos. */
export const SIGNATURE_BYTES = 16;
