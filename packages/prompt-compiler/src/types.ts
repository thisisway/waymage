import type { ProviderCapabilities } from '@waymage/provider-sdk';
import type { SceneSpec } from '@waymage/scene-spec';

/** Contrato do blueprint §10.4. */

export type CompileMode = 'draft' | 'final' | 'edit';

export interface ReferenceInstruction {
  assetId: string;
  role: string;
  weight: number;
  /** Frase pronta para acompanhar a imagem no payload do provedor. */
  instruction: string;
}

export interface CompilationWarning {
  code: string;
  message: string;
}

export interface PromptCompilationResult {
  prompt: string;
  negativePrompt?: string;
  referenceInstructions: ReferenceInstruction[];
  warnings: CompilationWarning[];
  /**
   * SceneSpec depois da normalização — é ele que deve ser persistido junto do prompt.
   * Guardar só o texto perderia a rastreabilidade de o que gerou aquela imagem.
   */
  normalizedSceneSpec: SceneSpec;
  compilerVersion: string;
  /** Resumo legível, exibido ao usuário antes de gerar (blueprint §22). */
  summary: string;
}

export interface CompileInput {
  sceneSpec: SceneSpec;
  providerCapabilities: ProviderCapabilities;
  mode: CompileMode;
  /** Instrução de edição localizada, usada quando `mode` é `edit`. */
  editInstruction?: string;
}

export interface PromptCompiler {
  compile(input: CompileInput): Promise<PromptCompilationResult>;
}
