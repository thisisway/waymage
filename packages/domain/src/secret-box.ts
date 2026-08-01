import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Cifra de segredos guardados por nós em nome do usuário (blueprint §17.3).
 *
 * Existe para as chaves de API que o cliente traz. Elas não são dado nosso: são acesso à conta
 * de nuvem dele, e um vazamento do banco viraria fatura no cartão de outra pessoa. Guardar em
 * texto puro seria transferir esse risco para quem não pode avaliá-lo.
 *
 * **AES-256-GCM**, não CBC nem CTR: GCM autentica além de cifrar. Sem autenticação, quem
 * conseguisse escrever no banco poderia trocar o texto cifrado por outro e o servidor
 * decifraria lixo sem perceber — ou, pior, uma chave escolhida pelo atacante.
 *
 * **Nonce novo a cada operação.** Reusar nonce em GCM não vaza só a mensagem: quebra a
 * autenticação do modo inteiro. Por isso ele é sorteado aqui e viaja junto do texto cifrado,
 * em vez de ser configurado.
 *
 * **O que NÃO está aqui:** rotação de chave. Trocar `CREDENTIALS_ENCRYPTION_KEY` hoje torna
 * todo segredo existente ilegível, e a recuperação é o usuário cadastrar de novo. Uma versão
 * no prefixo permitiria decifrar com a chave antiga enquanto se cifra com a nova — entra
 * quando houver uma segunda chave para conviver com a primeira.
 */

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
/** Marca o formato. Um dia que houver rotação, é aqui que a versão entra. */
const PREFIX = 'v1';

/**
 * Deriva os 32 bytes da chave a partir do valor configurado.
 *
 * SHA-256 e não um KDF pesado de propósito: a entrada é um segredo aleatório de alta entropia
 * gerado por `openssl rand`, não uma senha humana. Alongar o cálculo protegeria contra força
 * bruta de senha fraca — problema que não existe aqui, e o custo recairia em cada geração.
 */
function keyFrom(secret: string): Buffer {
  if (secret.length < 32) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY precisa de ao menos 32 caracteres.');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** `v1.<nonce>.<tag>.<cifrado>`, tudo em base64url. */
export function sealSecret(plaintext: string, secret: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFrom(secret), nonce);

  const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [PREFIX, nonce, tag, sealed]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

export function openSecret(sealed: string, secret: string): string {
  const [version, nonce, tag, payload] = sealed.split('.');

  if (version !== PREFIX || !nonce || !tag || !payload) {
    throw new Error('Segredo em formato desconhecido.');
  }

  const decipher = createDecipheriv(ALGORITHM, keyFrom(secret), Buffer.from(nonce, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));

  // `final()` lança quando a tag não confere — texto adulterado ou chave errada. Deixar
  // propagar é o certo: decifrar "quase" não existe.
  return Buffer.concat([
    decipher.update(Buffer.from(payload, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Os últimos quatro caracteres, para a tela identificar a chave sem exibi-la.
 *
 * Quatro porque é o que basta para a pessoa reconhecer qual das suas chaves está ali, e pouco
 * demais para ajudar quem não a tem. Chave curta demais devolve vazio em vez de quase tudo.
 */
export function secretHint(plaintext: string): string {
  return plaintext.length >= 12 ? plaintext.slice(-4) : '';
}

/**
 * Compara segredos sem vazar tempo.
 *
 * Comparação com `===` para cedo no primeiro byte diferente, e a diferença de tempo entre
 * "errou no começo" e "errou no fim" é mensurável pela rede. Não é o gargalo deste sistema,
 * mas comparar segredo é onde essa disciplina custa uma linha.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
