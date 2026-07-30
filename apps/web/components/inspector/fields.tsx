'use client';

/** Controles do inspetor. Sem estado próprio: recebem valor e devolvem alteração. */

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  // `| undefined` explícito: com `exactOptionalPropertyTypes`, passar `hint={undefined}`
  // não é o mesmo que omitir a prop.
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

const inputClass =
  'w-full rounded-md border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted';

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <Row label={label}>
      {multiline ? (
        <textarea
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} resize-none`}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )}
    </Row>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
  allowEmpty,
}: {
  label: string;
  value: T | null | undefined;
  /** Vem direto de `schema.options` do Zod: a UI não pode oferecer valor que a API recusa. */
  options: readonly T[];
  labels: Partial<Record<string, string>>;
  onChange: (value: T | null) => void;
  allowEmpty?: boolean;
}) {
  return (
    <Row label={label}>
      <select
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value || null) as T | null)}
        className={inputClass}
      >
        {allowEmpty && <option value="">—</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option] ?? option}
          </option>
        ))}
      </select>
    </Row>
  );
}

export function SliderField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
}) {
  return (
    <Row label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-accent"
        />
        <span className="w-9 text-right font-mono text-xs text-ink-secondary">
          {value.toFixed(2)}
        </span>
      </div>
    </Row>
  );
}

export function ToggleField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3.5 w-3.5 accent-accent"
        />
        <span className="text-sm text-ink-secondary">{label}</span>
      </label>
      {hint && <span className="mt-1 block pl-6 text-xs text-ink-muted">{hint}</span>}
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  hint,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  hint?: string;
}) {
  return (
    <Row label={label} hint={hint}>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={inputClass}
      />
    </Row>
  );
}

/** Paleta: cores como chips editáveis, porque hexadecimal digitado à mão erra fácil. */
export function PaletteField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <Row label="Paleta">
      <div className="flex flex-wrap items-center gap-2">
        {value.map((color, index) => (
          <span key={`${color}-${index}`} className="flex items-center gap-1">
            <input
              type="color"
              value={color}
              aria-label={`Cor ${index + 1}`}
              onChange={(e) =>
                onChange(value.map((c, i) => (i === index ? e.target.value.toUpperCase() : c)))
              }
              className="h-7 w-7 cursor-pointer rounded border border-surface-border bg-transparent"
            />
            <button
              type="button"
              aria-label={`Remover cor ${index + 1}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
              className="text-xs text-ink-muted hover:text-state-error"
            >
              ×
            </button>
          </span>
        ))}
        {value.length < 8 && (
          <button
            type="button"
            onClick={() => onChange([...value, '#888888'])}
            className="rounded border border-dashed border-surface-border px-2 py-1 text-xs text-ink-muted hover:text-ink-secondary"
          >
            + cor
          </button>
        )}
      </div>
    </Row>
  );
}

/** Lista de textos curtos (props do cenário). */
export function TagsField({
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
  return (
    <Row label={label} hint="Separe por vírgula.">
      <input
        type="text"
        value={value.join(', ')}
        placeholder={placeholder}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
        className={inputClass}
      />
    </Row>
  );
}
