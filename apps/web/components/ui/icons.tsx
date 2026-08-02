/**
 * Conjunto de ícones arredondados.
 *
 * Regras que mantêm o conjunto coeso — e que são o que faz um ícone parecer "de design
 * system" em vez de avulso:
 *
 * - grade de 24×24, com o desenho respirando 2px das bordas;
 * - traço de 1.75, `round` em ponta e junção — nenhum canto vivo;
 * - retângulos com `rx` generoso, nunca cantos retos;
 * - contorno, não preenchimento: herdam a cor do contexto por `currentColor`.
 *
 * Escritos à mão em vez de uma biblioteca: são ~30, cada um com poucos traços, e importar um
 * pacote traria centenas que nunca serão usados junto com um estilo que não é o nosso.
 */

const PATHS = {
  // ── Seções do inspetor ────────────────────────────────────────────────────
  intent: 'M12 3a9 9 0 1 0 9 9M12 7.5a4.5 4.5 0 1 0 4.5 4.5M12 12l8-8M20 4V2m0 2h2',
  subject: 'M12 3.5a3.75 3.75 0 1 1 0 7.5 3.75 3.75 0 0 1 0-7.5ZM4.5 20.5a7.5 7.5 0 0 1 15 0',
  scene:
    'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm-1 11 4.5-4.5 3 3 3.5-3.5L21 15',
  camera:
    'M4.5 8h2.2l1.4-2h7.8l1.4 2h2.2a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-8A1.5 1.5 0 0 1 4.5 8Zm7.5 3a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z',
  light:
    'M12 3v2m6.4 1.6-1.4 1.4M21 13h-2M5 13H3m4-5-1.4-1.4M9.5 18.5h5M10 21.5h4M8.5 13a3.5 3.5 0 1 1 7 0c0 1.6-.8 2.4-1 3.5h-5c-.2-1.1-1-1.9-1-3.5Z',
  composition:
    'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm5.7 0v16m4.6-16v16M3 9.7h18M3 14.3h18',
  palette:
    'M12 3.5a8.5 8.5 0 1 0 0 17c.9 0 1.5-.7 1.5-1.5 0-1.5.9-2 1.9-2h1.4a3 3 0 0 0 3-3 8.5 8.5 0 0 0-7.8-10.5ZM8 12.5h.01M10.5 8.5h.01M15 9.5h.01',
  output:
    'M12 15.5V3.5m0 12-3.5-3.5M12 15.5l3.5-3.5M4 16v3a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3',

  // ── Ações ─────────────────────────────────────────────────────────────────
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  close: 'm6.5 6.5 11 11m0-11-11 11',
  chevronDown: 'm6.5 9.5 5.5 5.5 5.5-5.5',
  chevronLeft: 'm14.5 6.5-5.5 5.5 5.5 5.5',
  chevronRight: 'm9.5 6.5 5.5 5.5-5.5 5.5',
  upload: 'M12 16V4m0 0L8 8m4-4 4 4M4 16v3a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3',
  download: 'M12 4v12m0 0-4-4m4 4 4-4M4 16v3a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3',
  trash:
    'M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.8 12A1.5 1.5 0 0 0 8.8 20.5h6.4a1.5 1.5 0 0 0 1.5-1.5l.8-12',

  /** Gerar: o brilho de "algo novo aparecendo". */
  sparkles:
    'M12 4.5 13.6 9 18 10.5 13.6 12 12 16.5 10.4 12 6 10.5 10.4 9 12 4.5ZM18.5 16l.7 1.9 1.8.6-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.6.7-1.9Z',
  /** Variar: o mesmo ponto de partida, outro caminho. */
  variation: 'M4 7h4l8 10h4m0 0-3-3m3 3-3 3M4 17h4l1.8-2.2M20 7h-4l-1.8 2.2m5.8-2.2-3-3m3 3-3 3',
  /** Refinar: acrescentar detalhe ao que já existe. */
  refine:
    'M6 20.5 3.5 18l9-9 2.5 2.5-9 9ZM14 5.5 16 3.5l4.5 4.5-2 2M18 14l.6 1.6 1.6.6-1.6.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.6Z',
  compare: 'M12 4v16M4.5 7h4M4.5 12h4M4.5 17h4M15.5 7h4M15.5 12h4M15.5 17h4',
  /** Chave de API. */
  key: 'M14.5 9.5a4 4 0 1 1 4 4c-.5 0-1-.1-1.5-.3L15.5 15H13v2.5h-2.5V20H7v-3.2l5.8-5.8a4 4 0 0 1-.3-1.5ZM18 8.5h.01',
  /** Trava: o que não pode mudar. */
  lock: 'M6.5 10.5h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19v-7a1.5 1.5 0 0 1 1.5-1.5Zm1.5 0V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5',
  /** Editar região: pincel. */
  brush:
    'M20.8 3.2a2.1 2.1 0 0 1 0 3L12.2 14.8l-3-3L17.8 3.2a2.1 2.1 0 0 1 3 0ZM8.6 15.4a3 3 0 0 0-3 3c0 .9-.6 1.7-1.6 2.1.9.6 2 1 3.1 1a3.5 3.5 0 0 0 3.5-3.5 2.6 2.6 0 0 0-2-2.6Z',

  // ── Objetos ───────────────────────────────────────────────────────────────
  folder:
    'M3.5 7.5A1.5 1.5 0 0 1 5 6h3.8a1.5 1.5 0 0 1 1.2.6l.9 1.2a1.5 1.5 0 0 0 1.2.6H19a1.5 1.5 0 0 1 1.5 1.5v8.6A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-11Z',
  image:
    'M4.5 4.5h15a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Zm-1 11 4-4 3 3 3.5-3.5 6 6M9 9.5h.01',
  layers: 'M12 3.5 3.5 8 12 12.5 20.5 8 12 3.5ZM3.5 12.5 12 17l8.5-4.5M3.5 17 12 21.5l8.5-4.5',
  credit:
    'M12 3.5c4.7 0 8.5 1.6 8.5 3.5S16.7 10.5 12 10.5 3.5 8.9 3.5 7 7.3 3.5 12 3.5ZM3.5 7v10c0 1.9 3.8 3.5 8.5 3.5s8.5-1.6 8.5-3.5V7M3.5 12c0 1.9 3.8 3.5 8.5 3.5s8.5-1.6 8.5-3.5',
  user: 'M12 3.5a3.75 3.75 0 1 1 0 7.5 3.75 3.75 0 0 1 0-7.5ZM4.5 20.5a7.5 7.5 0 0 1 15 0',
  logout:
    'M15 8V6a1.5 1.5 0 0 0-1.5-1.5h-7A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 15 18v-2M10 12h10.5m0 0-3-3m3 3-3 3',

  // ── Visualização ──────────────────────────────────────────────────────────
  grid: 'M4.5 4.5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Zm10 0h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Zm-10 10h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Zm10 0h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z',
  list: 'M9 6.5h11.5M9 12h11.5M9 17.5h11.5M4 6.5h.01M4 12h.01M4 17.5h.01',

  // ── Estados ───────────────────────────────────────────────────────────────
  success: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Zm-3.5 8.8 2.5 2.5 4.5-4.6',
  warning: 'M12 4.2 21 19.5H3L12 4.2ZM12 10v4m0 2.8h.01',
  error: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17ZM12 8v4.5m0 3h.01',
  info: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17ZM12 11v5m0-8h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'h-4 w-4' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Indicador de atividade. Um anel girando diz "estou trabalhando" sem ocupar espaço. */
export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} animate-spin`} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
