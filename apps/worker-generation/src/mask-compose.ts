import sharp from 'sharp';

/**
 * Composição por máscara — o que torna a edição localizada de fato localizada.
 *
 * O fornecedor não recebe canal de máscara: ele recebe imagens e texto, e devolve uma imagem
 * **inteira, nova**. Sem o que está aqui, "editar uma região" redesenha o quadro todo — a
 * iluminação desloca, o rosto varia, o fundo se refaz. Isso torna o verbo indistinguível de
 * "refinar", que já existe.
 *
 * Compondo o resultado através da máscara, fora dela os pixels originais permanecem
 * idênticos, não parecidos. É a diferença entre editar e regerar.
 */

/** Metade do feather vira sigma do desfoque: a transição cobre aproximadamente os dois lados. */
const SIGMA_PER_PIXEL = 0.5;
/** `sharp` recusa sigma abaixo disto; feather menor que isso não é transição, é serrilha. */
const MIN_SIGMA = 0.3;

/** Faixa do degradê que vira contorno. Estreita o bastante para ser linha, não faixa. */
const OUTLINE_LOW = 24;
const OUTLINE_HIGH = 232;

export interface MaskOptions {
  featherPx: number;
  inverted: boolean;
}

/**
 * Canal alfa a partir da máscara pintada.
 *
 * Branco vira opaco (a região que muda), preto vira transparente (a que fica). O desfoque é o
 * `featherPx` que o usuário escolheu, e sem ele a costura entre o novo e o original aparece
 * como uma borda dura — o defeito mais visível de uma composição.
 */
export async function maskAlpha(
  maskBytes: Buffer,
  width: number,
  height: number,
  options: MaskOptions,
): Promise<Buffer> {
  let pipeline = sharp(maskBytes)
    // `fill` e não `cover`: a máscara foi pintada sobre a imagem, então a correspondência é
    // ponto a ponto. Recortar para preservar proporção deslocaria a região.
    .resize(width, height, { fit: 'fill' })
    .greyscale();

  if (options.inverted) pipeline = pipeline.negate({ alpha: false });

  const sigma = options.featherPx * SIGMA_PER_PIXEL;
  if (sigma >= MIN_SIGMA) pipeline = pipeline.blur(sigma);

  return pipeline.toColourspace('b-w').raw().toBuffer();
}

/**
 * O resultado do fornecedor, colado sobre a original apenas onde a máscara manda.
 *
 * A imagem devolvida é redimensionada para o tamanho da original antes de tudo: o fornecedor
 * decide a resolução de saída, e compor tamanhos diferentes desalinharia a região editada de
 * onde ela deveria estar.
 */
export async function composeThroughMask(
  originalBytes: Buffer,
  editedBytes: Buffer,
  maskBytes: Buffer,
  options: MaskOptions,
): Promise<Buffer> {
  const { width, height } = await sharp(originalBytes).metadata();
  if (!width || !height) throw new Error('Imagem original sem dimensões legíveis.');

  const alpha = await maskAlpha(maskBytes, width, height, options);

  const layer = await sharp(await withAlpha(editedBytes, alpha, width, height), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();

  return sharp(originalBytes)
    .composite([{ input: layer, blend: 'over' }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * Intercala RGB e o alfa da máscara num buffer RGBA.
 *
 * Feito à mão em vez de `joinChannel`: o canal juntado por ele saiu como quarta banda comum,
 * não como transparência, e o PNG resultante voltava com três canais — a composição ignorava
 * a máscara inteira e trocava a imagem toda.
 *
 * Um laço sobre os pixels é previsível e custa milissegundos, mesmo em 2K.
 */
async function withAlpha(
  imageBytes: Buffer,
  alpha: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const rgb = await sharp(imageBytes)
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgb[i * 3] ?? 0;
    rgba[i * 4 + 1] = rgb[i * 3 + 1] ?? 0;
    rgba[i * 4 + 2] = rgb[i * 3 + 2] ?? 0;
    rgba[i * 4 + 3] = alpha[i] ?? 0;
  }

  return rgba;
}

/**
 * A original com a região a editar contornada.
 *
 * Mandar a máscara como uma segunda imagem em preto e branco e explicar por texto o que ela
 * significa é frágil: o modelo precisa correlacionar duas imagens sozinho. Um contorno
 * desenhado sobre a própria imagem elimina essa correlação — ele vê onde mexer.
 *
 * Contorno, e não preenchimento colorido: uma área tingida tende a ser reproduzida na saída,
 * e o tingido cairia justamente dentro da região editada, que é a que aparece no resultado
 * final. A linha fina é ignorada com muito mais frequência.
 */
export async function markRegion(
  baseBytes: Buffer,
  maskBytes: Buffer,
  options: { inverted: boolean },
): Promise<Buffer> {
  const { width, height } = await sharp(baseBytes).metadata();
  if (!width || !height) throw new Error('Imagem base sem dimensões legíveis.');

  const normalized = sharp(maskBytes).resize(width, height, { fit: 'fill' }).greyscale();
  const grey = await (options.inverted ? normalized.negate({ alpha: false }) : normalized)
    .png()
    .toBuffer();

  /**
   * A borda é a faixa de transição do desfoque.
   *
   * Desfocar a máscara transforma a fronteira dura num degradê; tudo o que ficou entre os dois
   * extremos é exatamente o contorno. Dilatar e erodir separadamente daria no mesmo, com duas
   * passagens a mais.
   *
   * Os limites são comparados aqui, e não pelo `threshold` do sharp: ele não teve efeito
   * nenhum nesta posição do pipeline — a saída voltava sendo o desfoque cru, e a borda saía
   * vazia. Marcação vazia é falha silenciosa, do tipo que só aparece olhando a imagem.
   */
  const blurred = await sharp(grey).blur(2).toColourspace('b-w').raw().toBuffer();

  const edge = Buffer.alloc(width * height);
  for (let i = 0; i < edge.length; i++) {
    const value = blurred[i] ?? 0;
    edge[i] = value > OUTLINE_LOW && value <= OUTLINE_HIGH ? 255 : 0;
  }

  // Verde: cor que quase não ocorre em pele, céu ou madeira, então some do resultado quando
  // o modelo a ignora — e salta aos olhos quando não ignora, o que facilita perceber.
  const solid = await sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 255, b: 90 } },
  })
    .png()
    .toBuffer();

  const outline = await sharp(await withAlpha(solid, edge, width, height), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();

  return sharp(baseBytes)
    .composite([{ input: outline, blend: 'over' }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
