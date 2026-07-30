import { FakeImageProvider } from '@waymage/provider-sdk';
import { fixtures, parseSceneSpec, type SceneSpec } from '@waymage/scene-spec';
import { describe, expect, it } from 'vitest';
import { COMPILER_VERSION, promptCompiler } from './compiler';
import type { CompileMode } from './types';

const capabilities = new FakeImageProvider().getCapabilities();

function compile(spec: SceneSpec, mode: CompileMode = 'draft', overrides = {}) {
  return promptCompiler.compile({
    sceneSpec: spec,
    providerCapabilities: { ...capabilities, ...overrides },
    mode,
  });
}

const psychoanalyst = parseSceneSpec(fixtures.psychoanalystSceneSpec);
const product = parseSceneSpec(fixtures.productSceneSpec);

describe('estrutura do prompt', () => {
  it('mantém a ordem de seções do blueprint', async () => {
    const { prompt } = await compile(psychoanalyst);

    const order = [
      'Subject —',
      'Setting —',
      'Composition —',
      'Camera —',
      'Lighting —',
      'Art direction —',
      'Output —',
    ];
    const positions = order.map((marker) => prompt.indexOf(marker));

    // Modelos de difusão dão mais peso ao início: o que define a imagem precisa vir antes.
    expect(positions.every((position) => position > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('preserva o texto livre do usuário exatamente como foi escrito', async () => {
    const { prompt } = await compile(psychoanalyst);
    expect(prompt).toContain('psicanalista experiente');
    expect(prompt).toContain('consultório contemporâneo');
    expect(prompt).toContain('terno escuro elegante');
  });

  it('traduz enums para vocabulário fotográfico', async () => {
    const { prompt } = await compile(psychoanalyst);
    expect(prompt).toContain('waist-up shot');
    expect(prompt).toContain('50mm lens');
    expect(prompt).toContain('shallow depth of field');
    expect(prompt).toContain('rule of thirds');
    expect(prompt).toContain('rim light');
  });

  it('gera resumo legível em português para o usuário conferir', async () => {
    const { summary } = await compile(psychoanalyst);
    expect(summary).toContain('psicanalista experiente');
    expect(summary).toContain('4 imagens 16:9');
    expect(summary).toContain('rascunho');
  });

  it('registra a versão do compilador', async () => {
    expect((await compile(psychoanalyst)).compilerVersion).toBe(COMPILER_VERSION);
  });

  it('devolve o SceneSpec normalizado, não só o texto', async () => {
    const { normalizedSceneSpec } = await compile(psychoanalyst);
    // Guardar só o prompt perderia a rastreabilidade de o que gerou a imagem.
    expect(normalizedSceneSpec.version).toBe('1.0');
    expect(normalizedSceneSpec.camera.lensMm).toBe(50);
  });
});

describe('travas viram instrução de preservação', () => {
  it('descreve travas como afirmação, não como negação', async () => {
    const { prompt } = await compile(psychoanalyst);

    // "preserve X" funciona melhor que "não mude X": modelos lidam mal com negação.
    expect(prompt).toContain('Must preserve:');
    expect(prompt).toContain('identity');
    expect(prompt).toContain('clothing');
    expect(prompt).toContain('colour palette');
    expect(prompt).not.toContain("don't change");
  });

  it('sem travas, não inventa restrição', async () => {
    const semTravas = parseSceneSpec({ ...fixtures.emptySceneSpec });
    expect((await compile(semTravas)).prompt).not.toContain('Must preserve:');
  });

  it('identityLock alto implica preservação mesmo sem a trava explícita', async () => {
    const spec = parseSceneSpec({
      ...fixtures.emptySceneSpec,
      subject: { type: 'person', description: 'x', identityLock: 0.9 },
    });
    expect((await compile(spec)).prompt).toContain('identity');
  });
});

describe('negative prompt', () => {
  it('inclui os defeitos comuns e as restrições derivadas da cena', async () => {
    const { negativePrompt } = await compile(product);
    expect(negativePrompt).toContain('watermark');
    expect(negativePrompt).toContain('distorted hands');
    // Fundo transparente não convive com cenário nem sombra projetada.
    expect(negativePrompt).toContain('background scenery');
    expect(negativePrompt).toContain('cast shadows');
  });

  it('dobra os negativos no prompt principal quando o provedor não os aceita', async () => {
    const result = await compile(psychoanalyst, 'draft', { negativePrompt: false });

    expect(result.negativePrompt).toBeUndefined();
    expect(result.prompt).toContain('Avoid:');
    expect(result.prompt).toContain('watermark');
    // E avisa, em vez de perder as restrições em silêncio.
    expect(result.warnings.map((w) => w.code)).toContain('NEGATIVE_PROMPT_FOLDED');
  });
});

describe('instruções de referência', () => {
  it('traduz peso em intensidade e lista o que preservar', async () => {
    const { referenceInstructions } = await compile(psychoanalyst);

    const identity = referenceInstructions.find((r) => r.role === 'identity');
    expect(identity?.instruction).toContain('very strongly');
    expect(identity?.instruction).toContain('facial features');
    expect(identity?.instruction).toContain('skin tone');

    const style = referenceInstructions.find((r) => r.role === 'style');
    expect(style?.instruction).toContain('moderately');
  });

  it('assume rosto e tom de pele quando a referência de identidade não diz o quê', async () => {
    const spec = parseSceneSpec({
      ...fixtures.emptySceneSpec,
      references: [{ assetId: 'a', role: 'identity', weight: 0.9 }],
    });
    const result = await compile(spec);

    expect(result.warnings.map((w) => w.code)).toContain('IDENTITY_REFERENCE_WITHOUT_ASPECTS');
    expect(result.referenceInstructions[0]?.instruction).toContain('facial features');
  });

  it('descarta referências acima do limite do provedor e avisa', async () => {
    const result = await compile(psychoanalyst, 'draft', { maxReferenceImages: 1 });
    expect(result.referenceInstructions).toHaveLength(1);
    expect(result.warnings.map((w) => w.code)).toContain('REFERENCES_TRUNCATED');
  });
});

describe('modos', () => {
  it('rascunho e final produzem prompts diferentes', async () => {
    const draft = await compile(psychoanalyst, 'draft');
    const final = await compile(psychoanalyst, 'final');

    expect(draft.prompt).toContain('Concept draft');
    expect(draft.prompt).toContain('quick exploratory render');
    expect(final.prompt).toContain('maximum detail');
    expect(final.prompt).not.toContain('Concept draft');
  });

  it('edição coloca a instrução antes de tudo', async () => {
    const result = await promptCompiler.compile({
      sceneSpec: psychoanalyst,
      providerCapabilities: capabilities,
      mode: 'edit',
      editInstruction: 'trocar o terno por um blazer claro',
    });

    // O que muda agora vem primeiro; o resto da cena é contexto do que preservar.
    // O que muda agora vem primeiro; o resto da cena é contexto do que preservar.
    expect(result.prompt.startsWith('Edit the provided image:')).toBe(true);
    expect(result.prompt).toContain('blazer claro');
  });
});

describe('determinismo e snapshot', () => {
  it('a mesma cena produz sempre o mesmo prompt', async () => {
    const [a, b] = await Promise.all([compile(psychoanalyst), compile(psychoanalyst)]);
    expect(a.prompt).toBe(b.prompt);
  });

  it('cena do blueprint', async () => {
    expect((await compile(psychoanalyst)).prompt).toMatchSnapshot();
  });

  it('foto de produto com fundo transparente', async () => {
    expect((await compile(product, 'final')).prompt).toMatchSnapshot();
  });

  it('cena mínima', async () => {
    expect((await compile(parseSceneSpec(fixtures.emptySceneSpec))).prompt).toMatchSnapshot();
  });
});
