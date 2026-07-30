import { create } from 'zustand';

interface EditorState {
  /** Modo de complexidade progressiva (blueprint §2). */
  mode: 'quick' | 'guided' | 'pro';
  setMode: (mode: EditorState['mode']) => void;
}

/**
 * Estado local do editor: o que está selecionado, aberto ou ativo.
 *
 * Nada de dado do servidor aqui — cena, versões e projetos vivem no TanStack Query. Copiar o
 * SceneSpec para dentro deste store criaria duas fontes da verdade, e a divergência entre
 * elas é a classe de bug que a separação do blueprint §23 evita.
 *
 * A seção aberta do inspetor saiu daqui: cada cartão colapsável guarda o próprio estado, que
 * é local a ele e não interessa a mais ninguém.
 */
export const useEditorStore = create<EditorState>((set) => ({
  mode: 'guided',
  setMode: (mode) => set({ mode }),
}));
