import { create } from 'zustand';

/** Seções do inspetor, na ordem do blueprint §5.1. */
export const INSPECTOR_SECTIONS = [
  'intent',
  'subject',
  'scene',
  'camera',
  'lighting',
  'composition',
  'style',
  'output',
] as const;

export type InspectorSection = (typeof INSPECTOR_SECTIONS)[number];

export const SECTION_LABELS: Record<InspectorSection, string> = {
  intent: 'Intenção',
  subject: 'Sujeito',
  scene: 'Cenário',
  camera: 'Câmera',
  lighting: 'Iluminação',
  composition: 'Composição',
  style: 'Estilo',
  output: 'Saída',
};

interface EditorState {
  section: InspectorSection;
  setSection: (section: InspectorSection) => void;

  /** Modo de complexidade progressiva (blueprint §2). */
  mode: 'quick' | 'guided' | 'pro';
  setMode: (mode: EditorState['mode']) => void;
}

/**
 * Estado local do editor: o que está selecionado, aberto ou ativo.
 *
 * Nada de dado do servidor aqui — cena, versões e projetos vivem no TanStack Query. Copiar
 * o SceneSpec para dentro deste store criaria duas fontes da verdade, e a divergência entre
 * elas é justamente a classe de bug que a separação do blueprint §23 evita.
 *
 * Ganha um store (em vez de useState) porque topbar, inspetor e canvas leem os mesmos
 * valores sem estarem no mesmo ramo da árvore.
 */
export const useEditorStore = create<EditorState>((set) => ({
  section: 'subject',
  setSection: (section) => set({ section }),

  mode: 'guided',
  setMode: (mode) => set({ mode }),
}));
