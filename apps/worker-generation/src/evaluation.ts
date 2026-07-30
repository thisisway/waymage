import type { SceneSpec } from '@waymage/scene-spec';

/**
 * Avaliação automática do resultado (blueprint §18).
 *
 * ponytail: por enquanto só o que dá para verificar sem olhar a imagem — proporção entregue,
 * presença de espaço para texto conforme pedido, e se as travas *podiam* ser respeitadas
 * (havia referência para isso?). Medir consistência de identidade ou fidelidade de paleta
 * exige um modelo de visão, o que entra quando houver um.
 *
 * O formato de saída já é o do blueprint, então trocar a implementação não muda o contrato
 * com a interface nem o que está gravado no banco.
 */

export interface EvaluationIssue {
  code: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

export interface Evaluation {
  aspectRatioMatch: boolean;
  reservedTextAreaRequested: boolean;
  locksRespected: Record<string, boolean>;
  issues: EvaluationIssue[];
  /** 0..1. Média do que foi possível verificar; não é nota de qualidade visual. */
  score: number;
  /** Deixa explícito o que ainda não é medido, para ninguém ler o score como mais do que é. */
  notEvaluated: string[];
}

const ASPECT_TOLERANCE = 0.02;

export function evaluateResult(
  spec: SceneSpec,
  image: { width: number; height: number },
): Evaluation {
  const issues: EvaluationIssue[] = [];

  const [w, h] = spec.output.aspectRatio.split(':').map(Number);
  const expected = (w as number) / (h as number);
  const actual = image.width / image.height;
  const aspectRatioMatch = Math.abs(expected - actual) / expected <= ASPECT_TOLERANCE;

  if (!aspectRatioMatch) {
    issues.push({
      code: 'ASPECT_RATIO_MISMATCH',
      severity: 'medium',
      message: `A proporção entregue (${actual.toFixed(2)}) difere da pedida (${spec.output.aspectRatio}).`,
    });
  }

  // Uma trava só pode ser cumprida se houver referência que a sustente.
  const hasIdentityReference = spec.references.some(
    (r) => r.role === 'identity' || r.role === 'face',
  );
  const locksRespected: Record<string, boolean> = {
    identity: !spec.locks.identity || hasIdentityReference,
    wardrobe: !spec.locks.wardrobe || Boolean(spec.subject.wardrobe?.description),
    palette: !spec.locks.palette || spec.style.palette.length > 0,
  };

  for (const [lock, respected] of Object.entries(locksRespected)) {
    if (!respected) {
      issues.push({
        code: `LOCK_NOT_SUPPORTED_${lock.toUpperCase()}`,
        severity: 'high',
        message: `A trava de ${lock} foi pedida sem uma referência que permita cumpri-la.`,
      });
    }
  }

  const checks = [aspectRatioMatch, ...Object.values(locksRespected)];
  const score = checks.filter(Boolean).length / checks.length;

  return {
    aspectRatioMatch,
    reservedTextAreaRequested: spec.composition.reservedTextArea,
    locksRespected,
    issues,
    score,
    notEvaluated: [
      'consistência de identidade',
      'fidelidade de paleta',
      'aderência de composição',
      'defeitos visuais',
    ],
  };
}
