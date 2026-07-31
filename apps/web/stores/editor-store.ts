import { create } from 'zustand';

/** Seções do inspetor, na ordem em que aparecem. */
export const SECTIONS = [
  'intent',
  'subject',
  'scene',
  'camera',
  'lighting',
  'composition',
  'style',
  'locks',
  'output',
  'advanced',
] as const;

export type SectionId = (typeof SECTIONS)[number];
export type EditorMode = 'quick' | 'guided' | 'pro';

/**
 * Complexidade progressiva (blueprint §2).
 *
 * O modo não muda o SceneSpec — muda o que está à vista. Quem só quer uma imagem não deveria
 * atravessar iluminação e composição para chegar em "Gerar"; quem sabe o que quer não deveria
 * ter os controles avançados escondidos.
 *
 * O que fica de fora continua valendo: os campos ocultos mantêm seus valores, e trocar de
 * modo revela em vez de reconfigurar.
 */
const VISIBLE: Record<EditorMode, readonly SectionId[]> = {
  /** O mínimo para gerar algo: o que se quer, de quem, e em que formato. */
  quick: ['intent', 'subject', 'output'],
  guided: [
    'intent',
    'subject',
    'scene',
    'camera',
    'lighting',
    'composition',
    'style',
    'locks',
    'output',
  ],
  pro: SECTIONS,
};

export const MODE_LABELS: Record<EditorMode, { label: string; description: string }> = {
  quick: { label: 'Rápido', description: 'Só o essencial para gerar' },
  guided: { label: 'Guiado', description: 'Cena completa, passo a passo' },
  pro: { label: 'Pro', description: 'Inclui seed, negative prompt e provedor' },
};

export function isSectionVisible(mode: EditorMode, section: SectionId): boolean {
  return VISIBLE[mode].includes(section);
}

interface EditorState {
  mode: EditorMode;
  setMode: (mode: EditorMode) => void;
}

/**
 * Estado local do editor.
 *
 * Nada de dado do servidor aqui — cena, versões e projetos vivem no TanStack Query. Copiar o
 * SceneSpec para dentro deste store criaria duas fontes da verdade, e a divergência entre
 * elas é a classe de bug que a separação do blueprint §23 evita.
 *
 * A seção aberta do inspetor não vive aqui: cada cartão colapsável guarda o próprio estado,
 * que é local a ele e não interessa a mais ninguém.
 */
export const useEditorStore = create<EditorState>((set) => ({
  mode: 'guided',
  setMode: (mode) => set({ mode }),
}));
