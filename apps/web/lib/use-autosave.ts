'use client';

import type { SceneSpec } from '@waymage/scene-spec';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, type Scene } from './api';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';

export interface AutosaveState {
  status: SaveStatus;
  /** Mensagem para exibição quando `status` é `error` ou `conflict`. */
  message: string | null;
  /** Última gravação bem-sucedida. */
  savedAt: Date | null;
}

const DEBOUNCE_MS = 800;

/**
 * Autosave do editor (blueprint §24).
 *
 * Três coisas que este hook resolve e que uma chamada direta não resolveria:
 *
 * 1. **Debounce de 800 ms** — digitar um nome dispararia uma requisição por tecla.
 * 2. **Uma gravação por vez** — sem isso, duas respostas podem voltar fora de ordem e a
 *    mais antiga sobrescrever a mais nova. Enquanto uma está no ar, a próxima fica na fila
 *    e é enviada com a revisão que o servidor acabou de devolver.
 * 3. **Conflito é estado, não exceção** — 409 significa que outra aba salvou. O editor
 *    para de tentar e avisa, em vez de insistir e sobrescrever trabalho alheio.
 *
 * A revisão vive num ref, e não em state: ela muda a cada resposta do servidor e não deve
 * provocar re-render nem entrar como dependência dos efeitos.
 */
export function useAutosave(scene: Scene | undefined, onSaved: (scene: Scene) => void) {
  const [state, setState] = useState<AutosaveState>({
    status: 'idle',
    message: null,
    savedAt: null,
  });

  const revisionRef = useRef(scene?.revision ?? 0);
  const pendingRef = useRef<{ name?: string; sceneSpec?: SceneSpec } | null>(null);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneIdRef = useRef(scene?.id);
  const conflictRef = useRef(false);

  // Trocar de cena reinicia tudo: a revisão da cena anterior não vale para a nova.
  useEffect(() => {
    if (scene && sceneIdRef.current !== scene.id) {
      sceneIdRef.current = scene.id;
      revisionRef.current = scene.revision;
      pendingRef.current = null;
      conflictRef.current = false;
      setState({ status: 'idle', message: null, savedAt: null });
    }
  }, [scene]);

  const flush = useCallback(async () => {
    const sceneId = sceneIdRef.current;
    const changes = pendingRef.current;

    if (!sceneId || !changes || inFlightRef.current || conflictRef.current) return;

    pendingRef.current = null;
    inFlightRef.current = true;
    setState((s) => ({ ...s, status: 'saving', message: null }));

    try {
      const saved = await api.saveScene(sceneId, {
        revision: revisionRef.current,
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.sceneSpec === undefined ? {} : { sceneSpec: changes.sceneSpec }),
      });

      revisionRef.current = saved.revision;
      onSaved(saved);
      setState({ status: 'saved', message: null, savedAt: new Date() });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Trava o autosave: continuar tentando sobrescreveria o trabalho da outra aba.
        conflictRef.current = true;
        setState({
          status: 'conflict',
          message: 'Esta cena foi alterada em outro lugar. Recarregue para ver a versão atual.',
          savedAt: null,
        });
      } else {
        setState((s) => ({
          ...s,
          status: 'error',
          message:
            error instanceof ApiError
              ? error.message
              : 'Não foi possível salvar. Verifique a conexão.',
        }));
      }
    } finally {
      inFlightRef.current = false;
      // Alterações que chegaram durante a gravação vão agora, já com a revisão nova.
      if (pendingRef.current && !conflictRef.current) void flush();
    }
  }, [onSaved]);

  /** Registra uma alteração. Só a última dentro da janela de debounce é enviada. */
  const save = useCallback(
    (changes: { name?: string; sceneSpec?: SceneSpec }) => {
      if (conflictRef.current) return;

      pendingRef.current = { ...pendingRef.current, ...changes };
      setState((s) => ({ ...s, status: 'dirty' }));

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [flush],
  );

  // Fechar a aba com alteração pendente perderia o trabalho silenciosamente.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (pendingRef.current || inFlightRef.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { ...state, save };
}
