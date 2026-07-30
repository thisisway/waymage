import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  GENERATION_STATES,
  InvalidTransitionError,
  isTerminal,
  nextStates,
  STATE_LABELS,
  STATE_PROGRESS,
  TERMINAL_STATES,
  type GenerationState,
} from './generation-state';

const NON_TERMINAL = GENERATION_STATES.filter((state) => !isTerminal(state));

describe('máquina de estados da geração', () => {
  it('percorre o caminho feliz do início ao fim', () => {
    const happyPath: GenerationState[] = [
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
    ];

    for (let i = 0; i < happyPath.length - 1; i++) {
      const from = happyPath[i] as GenerationState;
      const to = happyPath[i + 1] as GenerationState;
      expect(canTransition(from, to), `${from} → ${to}`).toBe(true);
    }
  });

  it('permite falhar ou cancelar de qualquer estado não terminal', () => {
    // Falha e cancelamento chegam a qualquer momento; a máquina não pode impedi-los.
    for (const state of NON_TERMINAL) {
      expect(canTransition(state, 'FAILED'), `${state} → FAILED`).toBe(true);
      expect(canTransition(state, 'CANCELLED'), `${state} → CANCELLED`).toBe(true);
    }
  });

  it('não permite sair de estado terminal', () => {
    // Reabrir um job concluído significaria capturar crédito duas vezes ou anexar
    // resultado a um job que já falhou.
    for (const terminal of TERMINAL_STATES) {
      expect(nextStates(terminal)).toHaveLength(0);
      for (const state of GENERATION_STATES) {
        expect(canTransition(terminal, state), `${terminal} → ${state}`).toBe(false);
      }
    }
  });

  it('não permite pular etapas do caminho feliz', () => {
    expect(canTransition('QUEUED', 'COMPLETED')).toBe(false);
    expect(canTransition('VALIDATING', 'PROCESSING')).toBe(false);
    expect(canTransition('COMPILING', 'DOWNLOADING')).toBe(false);
    expect(canTransition('QUEUED', 'EVALUATING')).toBe(false);
  });

  it('não permite voltar atrás', () => {
    expect(canTransition('PROCESSING', 'COMPILING')).toBe(false);
    expect(canTransition('EVALUATING', 'SUBMITTING')).toBe(false);
    expect(canTransition('DOWNLOADING', 'QUEUED')).toBe(false);
  });

  it('aceita concluir direto de SUBMITTING quando o provedor responde na hora', () => {
    // Provedor rápido devolve tudo pronto na primeira consulta, sem PROCESSING observável.
    expect(canTransition('SUBMITTING', 'DOWNLOADING')).toBe(true);
  });

  it('assertTransition lança com mensagem que diz o que era permitido', () => {
    expect(() => assertTransition('QUEUED', 'COMPLETED')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('QUEUED', 'COMPLETED')).toThrow(/VALIDATING/);
    expect(() => assertTransition('COMPLETED', 'QUEUED')).toThrow(/estado terminal/);
    expect(() => assertTransition('QUEUED', 'VALIDATING')).not.toThrow();
  });

  it('identifica os estados terminais', () => {
    expect(TERMINAL_STATES).toEqual(['COMPLETED', 'FAILED', 'CANCELLED']);
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('PROCESSING')).toBe(false);
  });
});

describe('apresentação do progresso', () => {
  it('todo estado tem progresso e rótulo', () => {
    for (const state of GENERATION_STATES) {
      expect(STATE_PROGRESS[state], state).toBeGreaterThanOrEqual(0);
      expect(STATE_PROGRESS[state], state).toBeLessThanOrEqual(1);
      expect(STATE_LABELS[state], state).toBeTruthy();
    }
  });

  it('o progresso nunca anda para trás no caminho feliz', () => {
    const path: GenerationState[] = [
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
    ];
    const values = path.map((state) => STATE_PROGRESS[state]);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it('estados terminais marcam a barra como cheia', () => {
    for (const terminal of TERMINAL_STATES) expect(STATE_PROGRESS[terminal]).toBe(1);
  });
});
