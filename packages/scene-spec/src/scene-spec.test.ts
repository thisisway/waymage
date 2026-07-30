import { describe, expect, it } from 'vitest';
import * as fixtures from './fixtures';
import { createSceneSpec, parseSceneSpec, SceneSpecParseError, safeParseSceneSpec } from './parse';
import { SCENE_SPEC_VERSION } from './version';
import { hasBlockingIssues, validateSceneSpec, type ValidationContext } from './validate';

const capabilities: NonNullable<ValidationContext['capabilities']> = {
  supportedAspectRatios: ['1:1', '16:9', '9:16'],
  maxReferenceImages: 4,
  maxOutputs: 4,
  transparentBackground: true,
  seed: true,
  negativePrompt: true,
  maskedEdit: true,
  multipleReferences: true,
};

describe('parseSceneSpec', () => {
  it('aceita todas as fixtures', () => {
    for (const [name, fixture] of Object.entries(fixtures)) {
      expect(() => parseSceneSpec(fixture), `fixture "${name}"`).not.toThrow();
    }
  });

  it('preenche os defaults dos blocos omitidos', () => {
    const spec = parseSceneSpec(fixtures.emptySceneSpec);
    expect(spec.output).toEqual({
      aspectRatio: '1:1',
      quality: 'draft',
      count: 4,
      format: 'webp',
      transparentBackground: false,
    });
    expect(spec.locks.identity).toBe(false);
    expect(spec.references).toEqual([]);
    expect(spec.advanced.provider).toBe('auto');
  });

  it('preserva o SceneSpec completo do blueprint sem perder campos', () => {
    const spec = parseSceneSpec(fixtures.psychoanalystSceneSpec);
    expect(spec.subject.identityLock).toBe(0.9);
    expect(spec.style.palette).toEqual(['#A90045', '#163F46', '#EFE8D6']);
    expect(spec.references[0]).toMatchObject({ role: 'identity', weight: 0.95 });
    expect(spec.camera.lensMm).toBe(50);
  });

  it('rejeita versão desconhecida com mensagem explícita', () => {
    const attempt = () => parseSceneSpec({ ...fixtures.emptySceneSpec, version: '9.9' });
    expect(attempt).toThrow(SceneSpecParseError);
    expect(attempt).toThrow(/não suportada/);
  });

  it('rejeita campos desconhecidos em vez de descartá-los em silêncio', () => {
    expect(() => parseSceneSpec({ ...fixtures.emptySceneSpec, lighting_typo: {} })).toThrow(
      SceneSpecParseError,
    );
  });

  it('rejeita valores fora do intervalo', () => {
    const bad = { ...fixtures.emptySceneSpec, output: { count: 99 } };
    expect(() => parseSceneSpec(bad)).toThrow(SceneSpecParseError);
  });

  it('rejeita cor de paleta fora do formato hexadecimal', () => {
    const bad = { ...fixtures.emptySceneSpec, style: { palette: ['vermelho'] } };
    expect(() => parseSceneSpec(bad)).toThrow(SceneSpecParseError);
  });

  it('safeParse devolve o erro em vez de lançar', () => {
    const result = safeParseSceneSpec({ version: SCENE_SPEC_VERSION });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.length).toBeGreaterThan(0);
  });

  it('createSceneSpec injeta a versão corrente', () => {
    const spec = createSceneSpec({
      intent: { purpose: 'portrait' },
      subject: { type: 'person', description: 'x' },
      scene: { location: 'y' },
      camera: { shot: 'close_up' },
    });
    expect(spec.version).toBe(SCENE_SPEC_VERSION);
  });
});

describe('validateSceneSpec', () => {
  const validate = (input: unknown, ctx?: ValidationContext) =>
    validateSceneSpec(parseSceneSpec(input), ctx);
  const codes = (input: unknown, ctx?: ValidationContext) =>
    validate(input, ctx).map((i) => i.code);

  it('não acusa conflito numa cena bem formada', () => {
    const issues = validate(fixtures.psychoanalystSceneSpec, { capabilities });
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it('detecta os conflitos da cena problemática', () => {
    const found = codes(fixtures.conflictingSceneSpec);
    expect(found).toContain('TRANSPARENCY_UNSUPPORTED_FORMAT');
    expect(found).toContain('NEGATIVE_SPACE_CONFLICT');
    expect(found).toContain('MULTIPLE_STRONG_IDENTITY_REFERENCES');
    expect(found).toContain('WARDROBE_LOCK_WITHOUT_SOURCE');
    expect(found).toContain('WIDE_SHOT_VS_FACE_DETAIL');
  });

  it('ordena erros antes de avisos e sugestões', () => {
    const levels = validate(fixtures.conflictingSceneSpec).map((i) => i.level);
    const rank = { error: 0, warning: 1, suggestion: 2 } as const;
    const ranks = levels.map((l) => rank[l]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('bloqueia apenas quando há erro', () => {
    expect(hasBlockingIssues(validate(fixtures.conflictingSceneSpec))).toBe(true);
    expect(hasBlockingIssues(validate(fixtures.emptySceneSpec))).toBe(false);
  });

  it('aceita transparência em png', () => {
    expect(codes(fixtures.productSceneSpec)).not.toContain('TRANSPARENCY_UNSUPPORTED_FORMAT');
  });

  it('rejeita proporção fora das capabilities do provedor', () => {
    const spec = { ...fixtures.emptySceneSpec, output: { aspectRatio: '21:9' } };
    expect(codes(spec, { capabilities })).toContain('ASPECT_RATIO_UNSUPPORTED');
    expect(codes(spec)).not.toContain('ASPECT_RATIO_UNSUPPORTED');
  });

  it('separa o limite do provedor do limite do plano', () => {
    const spec = { ...fixtures.emptySceneSpec, output: { count: 8 } };
    expect(codes(spec, { capabilities })).toContain('COUNT_ABOVE_PROVIDER_LIMIT');
    expect(codes(spec, { planMaxCount: 2 })).toContain('COUNT_ABOVE_PLAN_LIMIT');
  });

  it('avisa quando o provedor ignora seed ou negative prompt', () => {
    const spec = {
      ...fixtures.emptySceneSpec,
      advanced: { seed: 42, negativePrompt: 'sem texto' },
    };
    const found = codes(spec, {
      capabilities: { ...capabilities, seed: false, negativePrompt: false },
    });
    expect(found).toContain('SEED_UNSUPPORTED');
    expect(found).toContain('NEGATIVE_PROMPT_UNSUPPORTED');
  });

  it('exige imagem base quando há máscara', () => {
    expect(codes(fixtures.emptySceneSpec, { hasMask: true })).toContain('MASK_WITHOUT_BASE_IMAGE');
    expect(codes(fixtures.emptySceneSpec, { hasMask: true, hasBaseImage: true })).not.toContain(
      'MASK_WITHOUT_BASE_IMAGE',
    );
  });

  it('avisa sobre identidade travada sem referência de rosto', () => {
    const spec = { ...fixtures.emptySceneSpec, locks: { identity: true } };
    expect(codes(spec)).toContain('IDENTITY_LOCK_WITHOUT_REFERENCE');
  });

  it('avisa sobre paleta travada e vazia', () => {
    const spec = { ...fixtures.emptySceneSpec, locks: { palette: true } };
    expect(codes(spec)).toContain('PALETTE_LOCK_WITHOUT_COLORS');
  });

  it('sugere espaço negativo quando há área de texto reservada', () => {
    const spec = { ...fixtures.emptySceneSpec, composition: { reservedTextArea: true } };
    expect(codes(spec)).toContain('RESERVED_TEXT_WITHOUT_NEGATIVE_SPACE');
  });

  it('rejeita múltiplas referências quando o provedor só aceita uma', () => {
    const found = codes(fixtures.psychoanalystSceneSpec, {
      capabilities: { ...capabilities, multipleReferences: false },
    });
    expect(found).toContain('MULTIPLE_REFERENCES_UNSUPPORTED');
  });
});
