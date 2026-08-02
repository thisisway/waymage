/**
 * Largura e altura lidas do cabeçalho, sem decodificar a imagem.
 *
 * Existe porque o contrato de provedor exige que a saída venha com dimensões, e um adapter não
 * pode carregar um decodificador para isso — este pacote roda em qualquer lugar, e trazer
 * binário nativo custaria muito mais do que estas linhas.
 *
 * O worker ainda mede com `sharp` quando isto devolve `null`: dimensão errada não falha alto,
 * vira uma legenda "0×0" e uma avaliação de aderência sem sentido.
 */
export function imageSize(data: Buffer): [number, number] | null {
  return png(data) ?? jpeg(data) ?? webp(data);
}

/** PNG: o IHDR vem sempre no mesmo lugar. */
function png(data: Buffer): [number, number] | null {
  if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47) return null;
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

/**
 * JPEG: percorre os segmentos até o SOF.
 *
 * Não há deslocamento fixo — antes do SOF vêm metadados de tamanho variável (EXIF, perfil de
 * cor, miniatura), e cada fornecedor inclui os seus.
 */
function jpeg(data: Buffer): [number, number] | null {
  if (data.length < 4 || data.readUInt16BE(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = data[offset + 1] ?? 0;
    // SOF0..SOF15, exceto DHT (C4), JPG (C8) e DAC (CC), que não descrevem o quadro.
    const describesFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

    if (describesFrame) return [data.readUInt16BE(offset + 7), data.readUInt16BE(offset + 5)];

    offset += 2 + data.readUInt16BE(offset + 2);
  }

  return null;
}

/**
 * WebP: três variantes de contêiner, cada uma guardando o tamanho de um jeito.
 *
 * `VP8 ` (com perda), `VP8L` (sem perda) e `VP8X` (estendido, usado quando há alfa ou
 * animação). Um leitor que só entendesse a primeira devolveria `null` justamente nas imagens
 * com transparência.
 */
function webp(data: Buffer): [number, number] | null {
  if (data.length < 30) return null;
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }

  const chunk = data.toString('ascii', 12, 16);

  if (chunk === 'VP8 ') {
    // 14 bits cada, logo após o marcador de início de quadro.
    return [data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff];
  }

  if (chunk === 'VP8L') {
    // 14 bits empacotados em quatro bytes, e o valor gravado é a dimensão menos um.
    const bits = data.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }

  if (chunk === 'VP8X') {
    // 24 bits cada, também guardados como dimensão menos um.
    const width = data.readUIntLE(24, 3) + 1;
    const height = data.readUIntLE(27, 3) + 1;
    return [width, height];
  }

  return null;
}
