import type { ModerationVerdict } from '@waymage/database';

/**
 * Moderação de conteúdo.
 *
 * ponytail: implementação mínima até a Fase 10. Uma lista de termos não é moderação de
 * verdade — não entende contexto, idioma nem intenção, e é trivial de contornar. Existe para
 * que o passo esteja no pipeline com o estado correspondente, e para que trocar por um
 * serviço externo seja substituir esta função, não reescrever o worker.
 *
 * Não confundir com segurança: isto NÃO protege contra uso malicioso.
 */

export interface ModerationResult {
  verdict: ModerationVerdict;
  reason?: string;
}

/** Termos que, sozinhos, já indicam pedido claramente fora de política. */
const BLOCKED_TERMS = ['child sexual', 'csam', 'pornografia infantil', 'bestialidade'];

export function moderate(input: { text: string }): ModerationResult {
  const normalized = input.text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const hit = BLOCKED_TERMS.find((term) => normalized.includes(term));
  if (hit) {
    // A razão devolvida ao usuário não repete o termo encontrado.
    return { verdict: 'BLOCK', reason: 'O conteúdo solicitado viola a política de uso.' };
  }

  return { verdict: 'ALLOW' };
}
