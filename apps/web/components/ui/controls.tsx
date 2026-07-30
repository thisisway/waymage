'use client';

import { useState, type ReactNode } from 'react';

/**
 * Controles do editor.
 *
 * O princípio: **mostrar em vez de descrever**. Um `<select>` com "waist_up" obriga a pessoa
 * a saber o que isso significa; um diagrama do enquadramento dispensa a explicação. Onde a
 * opção tem forma visual, ela aparece — texto é o último recurso, não o primeiro.
 */

/**
 * Cartão colapsável de seção.
 *
 * O subtítulo mostra o valor atual com a seção fechada, o que é o ponto: dá para ler a cena
 * inteira rolando a coluna, sem abrir nada. Só o que está sendo mexido fica aberto.
 */
export function SectionCard({
  icon,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  icon: ReactNode;
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="overflow-hidden rounded-xl border border-surface-border bg-surface-raised transition-colors hover:border-surface-hover">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-overlay text-accent">
          {icon}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink-primary">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-muted">{summary}</span>
        </span>

        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className={`h-4 w-4 shrink-0 text-ink-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Grid de 0fr→1fr anima altura sem precisar medir o conteúdo em JavaScript. */}
      <div
        className={`grid transition-all duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="space-y-4 border-t border-surface-border px-3.5 pb-4 pt-3.5">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-ink-muted">{hint}</span>}
    </div>
  );
}

/** Botões lado a lado. Para 2–4 opções curtas, onde um dropdown esconderia as alternativas. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; badge?: string }[];
  onChange: (value: T) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-1 rounded-lg bg-surface-overlay p-1">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={active}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all ${
                active
                  ? 'bg-accent text-surface-base shadow-sm'
                  : 'text-ink-secondary hover:bg-surface-hover hover:text-ink-primary'
              }`}
            >
              {option.label}
              {option.badge && (
                <span className={`ml-1 text-[10px] ${active ? 'opacity-70' : 'text-ink-muted'}`}>
                  {option.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

/**
 * Grade de opções com pré-visualização.
 *
 * É o controle central do editor: cada opção mostra o que faz, em vez de nomeá-la. A legenda
 * fica abaixo do desenho porque o desenho é o que se lê primeiro.
 */
export function OptionGrid<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 3,
  hint,
}: {
  label: string;
  value: T | null | undefined;
  options: readonly { value: T; label: string; preview: ReactNode; caption?: string }[];
  onChange: (value: T) => void;
  columns?: 2 | 3 | 4;
  hint?: string;
}) {
  const gridClass = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }[columns];

  return (
    <Field label={label} hint={hint}>
      <div className={`grid gap-2 ${gridClass}`}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={active}
              title={option.caption ?? option.label}
              className={`group rounded-lg border p-2 transition-all ${
                active
                  ? 'border-accent bg-accent/10'
                  : 'border-surface-border bg-surface-overlay hover:border-ink-muted'
              }`}
            >
              <span className="flex h-11 items-center justify-center">{option.preview}</span>
              <span
                className={`mt-1.5 block truncate text-[11px] leading-tight ${
                  active ? 'text-ink-primary' : 'text-ink-secondary group-hover:text-ink-primary'
                }`}
              >
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </Field>
  );
}

export function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm text-ink-secondary">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{description}</span>
        )}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          value ? 'bg-accent' : 'bg-surface-overlay'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-ink-primary transition-transform ${
            value ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

/** Slider 0..1 com marcas de referência, para o número não ser um valor abstrato. */
export function Slider({
  label,
  value,
  onChange,
  hint,
  marks,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
  marks?: readonly [string, string];
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-surface-overlay accent-accent"
        />
        <span className="w-8 text-right font-mono text-xs text-ink-secondary">
          {Math.round(value * 100)}
        </span>
      </div>
      {marks && (
        <div className="mt-1 flex justify-between text-[10px] text-ink-muted">
          <span>{marks[0]}</span>
          <span>{marks[1]}</span>
        </div>
      )}
    </Field>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  hint?: string;
}) {
  const className =
    'w-full rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-ink-primary transition-colors placeholder:text-ink-muted hover:border-ink-muted focus:border-accent';

  return (
    <Field label={label} hint={hint}>
      {multiline ? (
        <textarea
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${className} resize-none leading-relaxed`}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={className}
        />
      )}
    </Field>
  );
}

/** Lista de termos curtos, editada como chips em vez de texto separado por vírgula. */
export function ChipList({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  function add() {
    const item = draft.trim();
    if (!item || value.includes(item)) return setDraft('');
    onChange([...value, item]);
    setDraft('');
  }

  return (
    <Field label={label}>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((item) => (
            <span
              key={item}
              className="flex items-center gap-1 rounded-md bg-surface-overlay px-2 py-1 text-xs text-ink-secondary"
            >
              {item}
              <button
                type="button"
                onClick={() => onChange(value.filter((current) => current !== item))}
                aria-label={`Remover ${item}`}
                className="text-ink-muted transition-colors hover:text-state-error"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        // Enter adiciona; sem isso a pessoa não descobre como confirmar o item.
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        className="w-full rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 text-sm text-ink-primary transition-colors placeholder:text-ink-muted hover:border-ink-muted focus:border-accent"
      />
    </Field>
  );
}

export function PaletteEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <Field label="Paleta" hint="Até 8 cores. Travar a paleta exige ao menos uma.">
      <div className="flex flex-wrap items-center gap-2">
        {value.map((color, index) => (
          <span key={`${color}-${index}`} className="group relative">
            <input
              type="color"
              value={color}
              aria-label={`Cor ${index + 1}`}
              onChange={(e) =>
                onChange(value.map((c, i) => (i === index ? e.target.value.toUpperCase() : c)))
              }
              className="h-9 w-9 cursor-pointer rounded-lg border border-surface-border bg-transparent transition-transform hover:scale-105"
            />
            <button
              type="button"
              aria-label={`Remover cor ${index + 1}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
              className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-state-error text-[10px] text-surface-base group-hover:flex"
            >
              ×
            </button>
          </span>
        ))}

        {value.length < 8 && (
          <button
            type="button"
            onClick={() => onChange([...value, '#888888'])}
            aria-label="Adicionar cor"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-surface-border text-ink-muted transition-colors hover:border-accent hover:text-accent"
          >
            +
          </button>
        )}
      </div>
    </Field>
  );
}
