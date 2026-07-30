import type { SceneSpec } from './schema';

/**
 * Validação de conflitos do SceneSpec (blueprint §9.2).
 *
 * Separada da validação de schema: o Zod garante que os campos existem e têm o tipo
 * certo; aqui verificamos se as escolhas fazem sentido juntas. Um SceneSpec pode ser
 * estruturalmente válido e semanticamente impossível.
 */

export type IssueLevel = 'error' | 'warning' | 'suggestion';

export interface ValidationIssue {
  /** Código estável, usado por UI e testes. Nunca traduzir. */
  code: string;
  level: IssueLevel;
  /** Caminho no SceneSpec, para destacar o campo na UI. */
  path: string;
  message: string;
  /** Correção automática sugerida, quando existir uma óbvia. */
  suggestion?: string;
}

/**
 * Restrições externas conhecidas no momento da validação.
 *
 * O formato de `capabilities` é um subconjunto estrutural de `ProviderCapabilities`
 * (packages/provider-sdk) — declarado aqui para que scene-spec não dependa de
 * provider-sdk e o grafo de dependências continue acíclico.
 */
export interface ValidationContext {
  capabilities?: {
    supportedAspectRatios: readonly string[];
    maxReferenceImages: number;
    maxOutputs: number;
    transparentBackground: boolean;
    seed: boolean;
    negativePrompt: boolean;
    maskedEdit: boolean;
    multipleReferences: boolean;
  };
  /** Teto de imagens por job no plano do workspace. */
  planMaxCount?: number;
  /** Há imagem base para operação de edição? */
  hasBaseImage?: boolean;
  /** Há máscara anexada? */
  hasMask?: boolean;
}

type Rule = (spec: SceneSpec, ctx: ValidationContext) => ValidationIssue[];

/** Planos abertos onde não há pixels suficientes para preservar um rosto. */
const WIDE_SHOTS = new Set(['wide', 'extreme_wide']);
/** Formatos com canal alpha. */
const ALPHA_FORMATS = new Set(['png', 'webp']);
const IDENTITY_ROLES = new Set(['identity', 'face']);
const HIGH_IDENTITY_WEIGHT = 0.6;

const rules: Rule[] = [
  // 1. Transparência exige formato com canal alpha.
  (spec) => {
    if (!spec.output.transparentBackground) return [];
    if (ALPHA_FORMATS.has(spec.output.format)) return [];
    return [
      {
        code: 'TRANSPARENCY_UNSUPPORTED_FORMAT',
        level: 'error',
        path: 'output.format',
        message: `Fundo transparente não é possível em ${spec.output.format.toUpperCase()}, que não tem canal alpha.`,
        suggestion: 'Use png ou webp.',
      },
    ];
  },

  // 2. Plano aberto com exigência de detalhe facial.
  (spec) => {
    if (!WIDE_SHOTS.has(spec.camera.shot)) return [];
    const demandsFace = spec.locks.face || spec.locks.identity || spec.subject.identityLock >= 0.7;
    if (!demandsFace) return [];
    return [
      {
        code: 'WIDE_SHOT_VS_FACE_DETAIL',
        level: 'warning',
        path: 'camera.shot',
        message:
          'Plano muito aberto reduz a área do rosto; a consistência de identidade tende a cair.',
        suggestion: 'Feche o enquadramento para waist_up ou reduza identityLock.',
      },
    ];
  },

  // 3. Espaço negativo não pode ficar onde o sujeito está.
  (spec) => {
    const { negativeSpace, subjectPosition } = spec.composition;
    if (negativeSpace === 'none') return [];
    if (negativeSpace !== subjectPosition) return [];
    return [
      {
        code: 'NEGATIVE_SPACE_CONFLICT',
        level: 'error',
        path: 'composition.negativeSpace',
        message: `O espaço negativo está em "${negativeSpace}", exatamente onde o sujeito foi posicionado.`,
        suggestion: 'Mova o sujeito para o lado oposto ou desloque o espaço negativo.',
      },
    ];
  },

  // 4. Múltiplas referências de identidade com peso alto se anulam.
  (spec) => {
    const strong = spec.references.filter(
      (r) => IDENTITY_ROLES.has(r.role) && r.weight > HIGH_IDENTITY_WEIGHT,
    );
    if (strong.length <= 1) return [];
    return [
      {
        code: 'MULTIPLE_STRONG_IDENTITY_REFERENCES',
        level: 'error',
        path: 'references',
        message: `${strong.length} referências de identidade com peso acima de ${HIGH_IDENTITY_WEIGHT} competem entre si e produzem um rosto misturado.`,
        suggestion: 'Mantenha uma referência dominante e reduza o peso das demais.',
      },
    ];
  },

  // 5. Trava de roupa precisa de algo que descreva a roupa.
  (spec) => {
    if (!spec.locks.wardrobe && !spec.subject.wardrobe?.lock) return [];
    const hasReference = spec.references.some((r) => r.role === 'wardrobe');
    const hasDescription = Boolean(spec.subject.wardrobe?.description);
    if (hasReference || hasDescription) return [];
    return [
      {
        code: 'WARDROBE_LOCK_WITHOUT_SOURCE',
        level: 'error',
        path: 'locks.wardrobe',
        message: 'A roupa está travada, mas não há referência de roupa nem descrição para travar.',
        suggestion:
          'Anexe uma referência com role "wardrobe" ou descreva a roupa em subject.wardrobe.',
      },
    ];
  },

  // 6. Máscara exige imagem base.
  (_spec, ctx) => {
    if (!ctx.hasMask || ctx.hasBaseImage) return [];
    return [
      {
        code: 'MASK_WITHOUT_BASE_IMAGE',
        level: 'error',
        path: 'output',
        message: 'Há uma máscara anexada, mas nenhuma imagem base para editar.',
        suggestion: 'Selecione um resultado antes de editar por máscara.',
      },
    ];
  },

  // 7. Proporção suportada pelo provedor.
  (spec, ctx) => {
    const caps = ctx.capabilities;
    if (!caps) return [];
    if (caps.supportedAspectRatios.includes(spec.output.aspectRatio)) return [];
    return [
      {
        code: 'ASPECT_RATIO_UNSUPPORTED',
        level: 'error',
        path: 'output.aspectRatio',
        message: `O provedor selecionado não suporta a proporção ${spec.output.aspectRatio}.`,
        suggestion: `Proporções disponíveis: ${caps.supportedAspectRatios.join(', ')}.`,
      },
    ];
  },

  // 8. Quantidade dentro do provedor e do plano.
  (spec, ctx) => {
    const issues: ValidationIssue[] = [];
    const caps = ctx.capabilities;
    if (caps && spec.output.count > caps.maxOutputs) {
      issues.push({
        code: 'COUNT_ABOVE_PROVIDER_LIMIT',
        level: 'error',
        path: 'output.count',
        message: `O provedor gera no máximo ${caps.maxOutputs} imagens por execução.`,
        suggestion: `Reduza para ${caps.maxOutputs}.`,
      });
    }
    if (ctx.planMaxCount !== undefined && spec.output.count > ctx.planMaxCount) {
      issues.push({
        code: 'COUNT_ABOVE_PLAN_LIMIT',
        level: 'error',
        path: 'output.count',
        message: `Seu plano permite no máximo ${ctx.planMaxCount} imagens por geração.`,
        suggestion: `Reduza para ${ctx.planMaxCount}.`,
      });
    }
    return issues;
  },

  // 9. Campos profissionais não suportados pelo provedor são ignorados silenciosamente — avisar.
  (spec, ctx) => {
    const caps = ctx.capabilities;
    if (!caps) return [];
    const issues: ValidationIssue[] = [];
    if (spec.advanced.seed !== null && !caps.seed) {
      issues.push({
        code: 'SEED_UNSUPPORTED',
        level: 'warning',
        path: 'advanced.seed',
        message: 'O provedor selecionado ignora seed; o resultado não será reproduzível.',
      });
    }
    if (spec.advanced.negativePrompt !== null && !caps.negativePrompt) {
      issues.push({
        code: 'NEGATIVE_PROMPT_UNSUPPORTED',
        level: 'warning',
        path: 'advanced.negativePrompt',
        message:
          'O provedor selecionado não aceita negative prompt; as restrições irão para o prompt principal.',
      });
    }
    return issues;
  },

  // 10. Limite de referências do provedor.
  (spec, ctx) => {
    const caps = ctx.capabilities;
    if (!caps || spec.references.length === 0) return [];
    if (spec.references.length > 1 && !caps.multipleReferences) {
      return [
        {
          code: 'MULTIPLE_REFERENCES_UNSUPPORTED',
          level: 'error',
          path: 'references',
          message: 'O provedor selecionado aceita apenas uma imagem de referência.',
        },
      ];
    }
    if (spec.references.length > caps.maxReferenceImages) {
      return [
        {
          code: 'REFERENCES_ABOVE_PROVIDER_LIMIT',
          level: 'error',
          path: 'references',
          message: `O provedor aceita no máximo ${caps.maxReferenceImages} referências; há ${spec.references.length}.`,
        },
      ];
    }
    return [];
  },

  // 11. Identidade travada sem referência de identidade não tem como ser cumprida.
  (spec) => {
    const wantsIdentity = spec.locks.identity || spec.subject.identityLock >= 0.5;
    if (!wantsIdentity) return [];
    if (spec.references.some((r) => IDENTITY_ROLES.has(r.role))) return [];
    return [
      {
        code: 'IDENTITY_LOCK_WITHOUT_REFERENCE',
        level: 'warning',
        path: 'subject.identityLock',
        message:
          'Consistência de identidade foi solicitada, mas não há referência de rosto para preservar.',
        suggestion: 'Anexe uma referência com role "identity".',
      },
    ];
  },

  // 12. Paleta travada e vazia é uma trava sem conteúdo.
  (spec) => {
    if (!spec.locks.palette || spec.style.palette.length > 0) return [];
    return [
      {
        code: 'PALETTE_LOCK_WITHOUT_COLORS',
        level: 'warning',
        path: 'locks.palette',
        message: 'A paleta está travada, mas nenhuma cor foi definida.',
        suggestion: 'Defina as cores em style.palette ou destrave a paleta.',
      },
    ];
  },

  // 13. Área de texto reservada sem espaço negativo — provável esquecimento.
  (spec) => {
    if (!spec.composition.reservedTextArea) return [];
    if (spec.composition.negativeSpace !== 'none') return [];
    return [
      {
        code: 'RESERVED_TEXT_WITHOUT_NEGATIVE_SPACE',
        level: 'suggestion',
        path: 'composition.negativeSpace',
        message:
          'Você reservou área para texto sem definir onde ela fica; o resultado tende a ficar cheio.',
        suggestion: 'Defina um espaço negativo no lado oposto ao sujeito.',
      },
    ];
  },

  // 14. Rascunho com contagem alta gasta crédito à toa.
  (spec) => {
    if (spec.output.quality !== 'final' || spec.output.count <= 2) return [];
    return [
      {
        code: 'FINAL_QUALITY_HIGH_COUNT',
        level: 'suggestion',
        path: 'output.count',
        message: `Gerar ${spec.output.count} imagens em qualidade final custa caro para explorar.`,
        suggestion: 'Explore em draft e promova apenas o resultado escolhido para final.',
      },
    ];
  },
];

/** Executa todas as regras de conflito. Ordem estável: erros, avisos, sugestões. */
export function validateSceneSpec(spec: SceneSpec, ctx: ValidationContext = {}): ValidationIssue[] {
  const issues = rules.flatMap((rule) => rule(spec, ctx));
  const order: Record<IssueLevel, number> = { error: 0, warning: 1, suggestion: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}

/** Atalho: o job pode ser enfileirado? */
export function hasBlockingIssues(issues: readonly ValidationIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
