'use client';

import { Field } from './controls';

/**
 * Seletor de posição num quadro.
 *
 * Substitui a lista de botões "Nenhum · Esquerda · Direita · Topo · Base · Centro", que além
 * de não caber no painel comunicava mal: posição é informação **espacial**, e a pessoa
 * precisava traduzir palavra em lugar. Aqui a região clicada É a resposta.
 *
 * Usado para posição do texto, espaço negativo e posição do sujeito — os três respondem à
 * mesma pergunta: onde, dentro do quadro?
 */

/** Onde cada valor fica na grade 3×3, em `[coluna, linha]` começando em 1. */
const CELLS: Record<string, { col: number; row: number; span?: 'col' | 'row' }> = {
  top: { col: 1, row: 1, span: 'col' },
  left: { col: 1, row: 1, span: 'row' },
  center: { col: 2, row: 2 },
  right: { col: 3, row: 1, span: 'row' },
  bottom: { col: 1, row: 3, span: 'col' },
};

const LABELS: Record<string, string> = {
  none: 'Nenhum',
  left: 'Esquerda',
  right: 'Direita',
  top: 'Topo',
  bottom: 'Base',
  center: 'Centro',
};

export function PositionPicker<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  hint?: string;
}) {
  const spatial = options.filter((option) => option !== 'none');
  const allowsNone = options.includes('none' as T);

  return (
    <Field label={label} hint={hint}>
      <div className="flex items-start gap-3">
        {/* O quadro. Cada região é um alvo de clique com a forma da própria área. */}
        <div
          role="group"
          aria-label={label}
          className="relative grid aspect-[4/3] w-32 shrink-0 grid-cols-3 grid-rows-3 gap-1 rounded-md border border-surface-border bg-surface-overlay p-1"
        >
          {spatial.map((option) => {
            const cell = CELLS[option];
            if (!cell) return null;

            const active = option === value;
            const style =
              cell.span === 'col'
                ? { gridColumn: '1 / -1', gridRow: cell.row }
                : cell.span === 'row'
                  ? { gridColumn: cell.col, gridRow: '1 / -1' }
                  : { gridColumn: cell.col, gridRow: cell.row };

            return (
              <button
                key={option}
                type="button"
                style={style}
                onClick={() => onChange(option)}
                aria-pressed={active}
                aria-label={LABELS[option] ?? option}
                title={LABELS[option] ?? option}
                className={`rounded-sm transition-all duration-fast ease-out ${
                  active ? 'bg-accent shadow-glow-sm' : 'bg-surface-hover/60 hover:bg-surface-hover'
                }`}
              />
            );
          })}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-[13px] font-semibold text-ink-primary">{LABELS[value] ?? value}</p>

          {allowsNone && (
            <button
              type="button"
              onClick={() => onChange('none' as T)}
              aria-pressed={value === 'none'}
              className={`rounded-md px-2.5 py-1 text-micro font-semibold transition-all duration-fast ease-out ${
                value === 'none'
                  ? 'bg-surface-hover text-ink-primary'
                  : 'text-ink-muted hover:bg-surface-overlay hover:text-ink-secondary'
              }`}
            >
              Nenhum
            </button>
          )}
        </div>
      </div>
    </Field>
  );
}
