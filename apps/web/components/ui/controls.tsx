'use client';

import { useState, type ReactNode } from 'react';

/**
 * Controles do editor, no vocabulário do Way Cloud Design System.
 *
 * Dois princípios governam tudo aqui:
 *
 * 1. **Mostrar em vez de descrever.** Um `<select>` com "waist_up" obriga a pessoa a saber o
 *    que isso significa; um diagrama do enquadramento dispensa a explicação.
 * 2. **Movimento que informa.** Cada transição existe para responder uma pergunta — "o que
 *    mudou?", "isso é clicável?", "meu clique registrou?". Animação que não responde nada
 *    sai.
 */

/**
 * Cartão colapsável de seção.
 *
 * O subtítulo mostra o valor atual com a seção fechada: dá para ler a cena inteira rolando a
 * coluna, sem abrir nada. Só o que está sendo mexido fica aberto.
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
    <section
      className={`overflow-hidden rounded-lg border bg-surface-raised transition-all duration-fast ease-out ${
        open
          ? 'border-accent/30 shadow-sm'
          : 'border-surface-border hover:border-surface-hover hover:shadow-xs'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="group flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-all duration-fast ease-out ${
            open
              ? 'bg-accent text-white shadow-glow-sm'
              : 'bg-surface-overlay text-accent-40 group-hover:bg-surface-hover'
          }`}
        >
          {icon}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold leading-tight text-ink-primary">
            {title}
          </span>
          <span className="mt-0.5 block truncate text-micro text-ink-muted">{summary}</span>
        </span>

        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className={`h-4 w-4 shrink-0 transition-all duration-fast ease-out ${
            open ? 'rotate-180 text-accent' : 'text-ink-muted group-hover:text-ink-secondary'
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Grid 0fr→1fr anima a altura sem precisar medir o conteúdo em JavaScript. */}
      <div
        className={`grid transition-all duration-base ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="space-y-5 border-t border-surface-border px-4 pb-5 pt-4">{children}</div>
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
      <span className="mb-2 block text-label uppercase text-ink-muted">{label}</span>
      {children}
      {hint && <span className="mt-2 block text-micro leading-relaxed text-ink-muted">{hint}</span>}
    </div>
  );
}

/**
 * Botões lado a lado.
 *
 * Duas formas, escolhidas pelo conteúdo — porque a versão de largura igual **cortava o
 * texto** quando havia seis opções num painel estreito, e rótulo cortado é pior que rótulo
 * em duas linhas:
 *
 * - até 4 opções curtas: segmentos de largura igual, com indicador que desliza entre as
 *   posições para o olho acompanhar de onde para onde a seleção foi;
 * - acima disso: pílulas que quebram linha, cada uma do tamanho do próprio rótulo.
 */
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
  const longest = Math.max(...options.map((option) => option.label.length));
  const wraps = options.length > 4 || longest > 10;

  if (wraps) {
    return (
      <Field label={label} hint={hint}>
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(option.value)}
                aria-pressed={active}
                className={`rounded-pill px-3 py-1.5 text-micro font-semibold transition-all duration-fast ease-out active:scale-[0.96] ${
                  active
                    ? 'bg-accent text-white shadow-glow-sm'
                    : 'bg-surface-overlay text-ink-secondary hover:bg-surface-hover hover:text-ink-primary'
                }`}
              >
                {option.label}
                {option.badge && (
                  <span className={`ml-1.5 font-mono ${active ? 'opacity-70' : 'text-ink-muted'}`}>
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

  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  return (
    <Field label={label} hint={hint}>
      <div className="relative flex rounded-md bg-surface-overlay p-1">
        <span
          aria-hidden
          className="absolute inset-y-1 rounded-sm bg-accent shadow-glow-sm transition-all duration-fast ease-spring"
          style={{
            width: `calc((100% - 8px) / ${options.length})`,
            left: `calc(4px + (100% - 8px) * ${index} / ${options.length})`,
          }}
        />

        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={active}
              className={`relative z-10 flex-1 truncate rounded-sm px-2 py-1.5 text-micro font-semibold transition-colors duration-fast ${
                active ? 'text-white' : 'text-ink-secondary hover:text-ink-primary'
              }`}
            >
              {option.label}
              {option.badge && (
                <span className={`ml-1 font-mono ${active ? 'opacity-70' : 'text-ink-muted'}`}>
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
 * Grade de opções com pré-visualização — o controle central do editor.
 *
 * Cada opção mostra o que faz em vez de nomeá-la. A borda azul e o leve recuo no clique
 * confirmam a escolha sem precisar de texto de estado.
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
              className={`group rounded-md border p-2 transition-all duration-fast ease-out active:scale-[0.97] ${
                active
                  ? 'border-accent bg-accent/[0.12] shadow-glow-sm'
                  : 'border-surface-border bg-surface-overlay hover:-translate-y-px hover:border-accent-40/50 hover:shadow-sm'
              }`}
            >
              <span className="flex h-11 items-center justify-center">{option.preview}</span>
              <span
                className={`mt-2 block truncate text-micro font-medium leading-tight transition-colors ${
                  active ? 'text-accent-40' : 'text-ink-secondary group-hover:text-ink-primary'
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
    <div className="flex items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink-secondary">{label}</span>
        {description && (
          <span className="mt-1 block text-micro leading-relaxed text-ink-muted">
            {description}
          </span>
        )}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 shrink-0 rounded-pill transition-all duration-fast ease-out ${
          value ? 'bg-accent shadow-glow-sm' : 'bg-surface-overlay hover:bg-surface-hover'
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-pill bg-white shadow-sm transition-transform duration-fast ease-spring ${
            value ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

/** Slider 0..1 com marcas nomeadas, para o número não ser um valor abstrato. */
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
        <span className="relative flex-1">
          {/* Trilha preenchida: mostra a proporção, não só a posição do botão. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-pill bg-surface-overlay"
          >
            <span
              className="block h-full rounded-pill bg-accent transition-all duration-instant ease-out"
              style={{ width: `${value * 100}%` }}
            />
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={value}
            aria-label={label}
            onChange={(e) => onChange(Number(e.target.value))}
            className="relative h-6 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-pill [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-accent [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110"
          />
        </span>
        <span className="w-9 text-right font-mono text-code text-ink-secondary">
          {Math.round(value * 100)}
        </span>
      </div>
      {marks && (
        <div className="mt-1 flex justify-between text-micro text-ink-muted">
          <span>{marks[0]}</span>
          <span>{marks[1]}</span>
        </div>
      )}
    </Field>
  );
}

const INPUT_CLASS =
  'w-full rounded-md border border-surface-border bg-surface-overlay px-3 py-2.5 text-[14px] text-ink-primary transition-all duration-fast ease-out placeholder:text-ink-muted hover:border-surface-hover focus:border-accent focus:bg-surface-hover focus:outline-none';

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
  return (
    <Field label={label} hint={hint}>
      {multiline ? (
        <textarea
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CLASS} resize-none leading-relaxed`}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLASS}
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
              className="animate-rise flex items-center gap-1.5 rounded-pill border border-accent/20 bg-accent/10 py-1 pl-3 pr-2 text-micro font-medium text-accent-40"
            >
              {item}
              <button
                type="button"
                onClick={() => onChange(value.filter((current) => current !== item))}
                aria-label={`Remover ${item}`}
                className="text-accent-40/60 transition-colors hover:text-state-error"
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
        className={INPUT_CLASS}
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
              className="h-10 w-10 cursor-pointer rounded-md border-2 border-surface-border bg-transparent transition-all duration-fast ease-spring hover:scale-110 hover:border-accent-40"
            />
            <button
              type="button"
              aria-label={`Remover cor ${index + 1}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
              className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-pill bg-state-error text-micro text-white shadow-sm group-hover:flex"
            >
              ×
            </button>
          </span>
        ))}

        {value.length < 8 && (
          <button
            type="button"
            onClick={() => onChange([...value, '#1D66FF'])}
            aria-label="Adicionar cor"
            className="flex h-10 w-10 items-center justify-center rounded-md border-2 border-dashed border-surface-border text-ink-muted transition-all duration-fast ease-out hover:border-accent hover:text-accent"
          >
            +
          </button>
        )}
      </div>
    </Field>
  );
}

/** Botão primário do DS. Usado no que compromete crédito ou cria algo. */
export function Button({
  variant = 'primary',
  size = 'md',
  children,
  ...props
}: {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants = {
    primary:
      'bg-accent text-white shadow-glow-sm hover:bg-accent-80 hover:shadow-glow disabled:shadow-none',
    secondary:
      'border border-surface-border bg-surface-overlay text-ink-secondary hover:border-accent-40/50 hover:text-ink-primary',
    ghost: 'text-ink-secondary hover:bg-surface-overlay hover:text-ink-primary',
    danger: 'bg-state-error text-white hover:opacity-90',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-micro',
    md: 'px-4 py-2 text-[13px]',
    lg: 'px-6 py-3 text-[15px]',
  };

  return (
    <button
      type="button"
      {...props}
      className={`rounded-md font-semibold transition-all duration-fast ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}
