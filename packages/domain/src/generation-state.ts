/**
 * Máquina de estados do `GenerationJob` (blueprint §12.1).
 *
 * Existe porque um job de geração custa dinheiro: cada transição indevida é um crédito
 * capturado duas vezes, uma reserva nunca liberada ou um resultado gravado num job que já
 * havia falhado. Deixar o fluxo implícito em `if`s espalhados pelo worker torna esses casos
 * invisíveis até acontecerem em produção.
 *
 * Mora em `packages/domain` porque API e worker precisam concordar: a API cria em `QUEUED` e
 * cancela; o worker conduz o resto.
 */

export const GENERATION_STATES = [
  'DRAFT',
  'QUEUED',
  'VALIDATING',
  'MODERATING_INPUT',
  'COMPILING',
  'ROUTING',
  'SUBMITTING',
  'PROCESSING',
  'DOWNLOADING',
  'MODERATING_OUTPUT',
  'EVALUATING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type GenerationState = (typeof GENERATION_STATES)[number];

/** Estados dos quais não se sai. Chegar a um deles encerra o job para sempre. */
export const TERMINAL_STATES: readonly GenerationState[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

/** Falha e cancelamento podem chegar a qualquer momento, então acompanham todo estado vivo. */
function withFailure(...states: GenerationState[]): readonly GenerationState[] {
  return [...states, 'FAILED', 'CANCELLED'];
}

const TRANSITIONS: Record<GenerationState, readonly GenerationState[]> = {
  DRAFT: withFailure('QUEUED'),
  QUEUED: withFailure('VALIDATING'),
  VALIDATING: withFailure('MODERATING_INPUT'),
  MODERATING_INPUT: withFailure('COMPILING'),
  COMPILING: withFailure('ROUTING'),
  ROUTING: withFailure('SUBMITTING'),
  // O provedor pode devolver tudo pronto na primeira consulta, sem PROCESSING observável.
  SUBMITTING: withFailure('PROCESSING', 'DOWNLOADING'),
  PROCESSING: withFailure('DOWNLOADING'),
  DOWNLOADING: withFailure('MODERATING_OUTPUT'),
  MODERATING_OUTPUT: withFailure('EVALUATING'),
  EVALUATING: withFailure('COMPLETED'),
  // Terminais: não se sai deles. Reabrir um job concluído significaria capturar crédito
  // duas vezes ou anexar resultado a um job que já falhou.
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isTerminal(state: GenerationState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function canTransition(from: GenerationState, to: GenerationState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStates(from: GenerationState): readonly GenerationState[] {
  return TRANSITIONS[from];
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: GenerationState,
    readonly to: GenerationState,
  ) {
    super(
      `Transição inválida de ${from} para ${to}. Permitidas: ${nextStates(from).join(', ') || 'nenhuma (estado terminal)'}.`,
    );
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(from: GenerationState, to: GenerationState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/**
 * Progresso aproximado por estado, para a barra do editor.
 *
 * Números escolhidos pela percepção de tempo, não pela contagem de passos: submeter e
 * processar consomem a maior parte do relógio, então ocupam a maior parte da barra.
 */
export const STATE_PROGRESS: Record<GenerationState, number> = {
  DRAFT: 0,
  QUEUED: 0.02,
  VALIDATING: 0.05,
  MODERATING_INPUT: 0.1,
  COMPILING: 0.15,
  ROUTING: 0.2,
  SUBMITTING: 0.25,
  PROCESSING: 0.6,
  DOWNLOADING: 0.85,
  MODERATING_OUTPUT: 0.9,
  EVALUATING: 0.95,
  COMPLETED: 1,
  FAILED: 1,
  CANCELLED: 1,
};

/** Rótulos em português para a interface. */
export const STATE_LABELS: Record<GenerationState, string> = {
  DRAFT: 'rascunho',
  QUEUED: 'na fila',
  VALIDATING: 'validando a cena',
  MODERATING_INPUT: 'verificando o conteúdo',
  COMPILING: 'compilando o prompt',
  ROUTING: 'escolhendo o provedor',
  SUBMITTING: 'enviando ao provedor',
  PROCESSING: 'gerando',
  DOWNLOADING: 'salvando as imagens',
  MODERATING_OUTPUT: 'verificando o resultado',
  EVALUATING: 'avaliando aderência',
  COMPLETED: 'concluído',
  FAILED: 'falhou',
  CANCELLED: 'cancelado',
};
