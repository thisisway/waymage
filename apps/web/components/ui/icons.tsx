/**
 * Ícones das seções.
 *
 * Escritos à mão em vez de uma biblioteca: são oito, cada um com 1–2 traços, e uma
 * dependência de ícones traria centenas que nunca serão usados. `currentColor` em tudo, para
 * herdarem a cor do contexto.
 */
const PATHS: Record<string, string> = {
  target: 'M12 2v4m0 12v4M2 12h4m12 0h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  person: 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM4 21a8 8 0 0 1 16 0',
  scene: 'M3 20V8l6-4 6 4 6-3v15M9 20v-8h6v8',
  camera: 'M4 8h3l2-2h6l2 2h3v11H4V8Zm8 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  light:
    'M12 2v3m6.4 1.6-2 2M22 13h-3M2 13h3M7.6 6.6l-2-2M9 18h6m-5 3h4M8 13a4 4 0 1 1 8 0c0 2-1 3-1 5H9c0-2-1-3-1-5Z',
  grid: 'M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18',
  palette:
    'M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-1.6 1-2 2-2H18a3 3 0 0 0 3-3 9 9 0 0 0-9-9Zm-4 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm3-4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5 1a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z',
  export: 'M12 15V3m0 0L8 7m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  layers: 'M12 3 2 8l10 5 10-5-10-5ZM2 14l10 5 10-5',
};

export function Icon({
  name,
  className = 'h-4 w-4',
}: {
  name: keyof typeof PATHS | string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name] ?? PATHS['layers']} />
    </svg>
  );
}
