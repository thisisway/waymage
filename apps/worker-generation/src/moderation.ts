import type { ModerationTarget, ModerationVerdict, Prisma, PrismaClient } from '@waymage/database';

/**
 * Moderação de conteúdo (blueprint §17).
 *
 * ponytail: as regras são uma tabela de termos, não um classificador. Uma lista não entende
 * contexto, idioma nem intenção, e é trivial de contornar. Existe para que os quatro
 * veredictos sejam reais no pipeline e para que trocar por um serviço externo seja substituir
 * `moderateText` e `moderateImage`, não reescrever o worker.
 *
 * **Isto não é segurança.** Não protege contra uso malicioso, e não deve ser apresentado a
 * ninguém como se protegesse.
 *
 * Os quatro veredictos existem porque "pode ou não pode" é uma pergunta pobre:
 *
 * - `ALLOW` — segue sem ressalva.
 * - `ALLOW_WITH_WARNING` — segue, e o usuário precisa saber de algo. Semelhança com pessoa
 *   real e marca de terceiro entram aqui: são legítimos, mas a responsabilidade é de quem
 *   pede, e o aviso é o que torna essa responsabilidade explícita.
 * - `REVIEW_REQUIRED` — nem passa nem é recusado por uma lista de palavras. Precisa de gente.
 * - `BLOCK` — recusa imediata.
 */

export interface ModerationResult {
  verdict: ModerationVerdict;
  /** Categorias acionadas. Vai para o registro; nunca o texto que as acionou. */
  categories: string[];
  /** Mensagem para o usuário. Nunca repete o termo encontrado. */
  reason?: string;
}

interface Rule {
  category: string;
  verdict: ModerationVerdict;
  /** Todos os grupos precisam bater. Cada grupo aceita qualquer um dos seus termos. */
  all: readonly (readonly string[])[];
  reason: string;
}

const MINORS = ['crianca', 'criancas', 'menor de idade', 'child', 'minor', 'adolescente'] as const;
const SEXUAL = ['sexual', 'nudez', 'nude', 'erotico', 'erotica', 'sensual'] as const;

/**
 * Ordem importa: a primeira regra que bater decide.
 *
 * Do mais grave para o menos, para que um pedido que aciona duas categorias seja tratado pela
 * pior delas — o contrário deixaria um aviso brando encobrir um bloqueio.
 */
const RULES: readonly Rule[] = [
  {
    category: 'csae',
    verdict: 'BLOCK',
    all: [['child sexual', 'csam', 'pornografia infantil']],
    reason: 'O conteúdo solicitado viola a política de uso.',
  },
  {
    category: 'bestiality',
    verdict: 'BLOCK',
    all: [['bestialidade', 'bestiality', 'zoofilia']],
    reason: 'O conteúdo solicitado viola a política de uso.',
  },
  {
    // Separado do bloqueio direto: "criança" e "sensual" na mesma cena podem ser uma foto de
    // aniversário mal descrita ou algo muito pior, e a diferença não está no texto.
    category: 'minors_sexualized',
    verdict: 'REVIEW_REQUIRED',
    all: [MINORS, SEXUAL],
    reason: 'Cena com menor de idade em contexto sensível precisa de revisão humana.',
  },
  {
    category: 'graphic_violence',
    verdict: 'REVIEW_REQUIRED',
    all: [['mutilacao', 'decapitacao', 'gore', 'esquartejado', 'tortura']],
    reason: 'Cena com violência gráfica precisa de revisão humana.',
  },
  {
    category: 'real_person_likeness',
    verdict: 'ALLOW_WITH_WARNING',
    all: [['pessoa real', 'celebridade', 'famoso', 'presidente']],
    reason:
      'A cena parece descrever uma pessoa real. Use imagem de pessoa identificável apenas com autorização.',
  },
  {
    category: 'third_party_brand',
    verdict: 'ALLOW_WITH_WARNING',
    all: [['logotipo da', 'logo da', 'marca registrada', 'trademark']],
    reason: 'A cena menciona marca de terceiro. Verifique se você pode usá-la.',
  },
];

/** Minúsculas e sem acento: "criança" e "crianca" não podem ser regras diferentes. */
function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function moderateText(text: string): ModerationResult {
  const normalized = normalize(text);

  for (const rule of RULES) {
    if (rule.all.every((group) => group.some((term) => normalized.includes(term)))) {
      return { verdict: rule.verdict, categories: [rule.category], reason: rule.reason };
    }
  }

  return { verdict: 'ALLOW', categories: [] };
}

/**
 * Moderação de imagem.
 *
 * ponytail: sem classificador, devolve `ALLOW` sempre. O ponto de troca fica aqui — quando
 * entrar um serviço de visão, é esta função que muda, e os pontos do pipeline que a chamam
 * continuam iguais.
 */
export function moderateImage(_input: { bytes: Buffer; mimeType: string }): ModerationResult {
  return { verdict: 'ALLOW', categories: [] };
}

/** Veredictos que impedem o conteúdo de seguir. */
export function isBlocking(verdict: ModerationVerdict): boolean {
  return verdict === 'BLOCK' || verdict === 'REVIEW_REQUIRED';
}

/** Identifica quem decidiu, para que uma troca de moderador seja visível no histórico. */
export const MODERATOR_ID = 'rules@1';

/**
 * Registra a decisão — e só quando ela tem conteúdo.
 *
 * Uma linha por `ALLOW` seria uma linha dizendo que nada aconteceu, multiplicada por cada
 * imagem de cada job. Que o conteúdo passou já está dito pelo job ter avançado pelos estados
 * `MODERATING_INPUT` e `MODERATING_OUTPUT`, que são obrigatórios e validados.
 *
 * O texto avaliado nunca entra no registro: guardar o pedido rejeitado transformaria a tabela
 * de auditoria num arquivo do próprio conteúdo que se quis recusar.
 */
export async function recordDecision(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    target: ModerationTarget;
    result: ModerationResult;
    generationJobId?: string;
    assetId?: string;
  },
): Promise<void> {
  if (input.result.verdict === 'ALLOW') return;

  await prisma.moderationDecision.create({
    data: {
      workspaceId: input.workspaceId,
      target: input.target,
      verdict: input.result.verdict,
      ...(input.generationJobId ? { generationJobId: input.generationJobId } : {}),
      ...(input.assetId ? { assetId: input.assetId } : {}),
      // A razão é texto nosso, não do usuário: guardá-la deixa a tela mostrar o aviso sem
      // precisar reimplementar a tabela de regras no front.
      detail: {
        categories: input.result.categories,
        ...(input.result.reason ? { reason: input.result.reason } : {}),
      } as unknown as Prisma.InputJsonValue,
      moderator: MODERATOR_ID,
    },
  });
}
