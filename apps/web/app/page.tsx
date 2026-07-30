import { fixtures, parseSceneSpec, validateSceneSpec } from '@waymage/scene-spec';
import { SystemStatus } from '../components/system-status';

/**
 * Shell do editor (blueprint §5.1): topbar, biblioteca à esquerda, canvas ao centro,
 * inspetor à direita, timeline embaixo.
 *
 * Fase 1 entrega a estrutura e prova que o SceneSpec compartilhado roda no front — os
 * painéis ganham comportamento nas Fases 3 a 8.
 */

const spec = parseSceneSpec(fixtures.psychoanalystSceneSpec);
const issues = validateSceneSpec(spec);

const LIBRARY_SECTIONS = [
  { label: 'Identidade', count: spec.references.filter((r) => r.role === 'identity').length },
  { label: 'Estilo', count: spec.references.filter((r) => r.role === 'style').length },
  { label: 'Roupa', count: 0 },
  { label: 'Cenário', count: 0 },
  { label: 'Paleta', count: spec.style.palette.length },
];

const TIMELINE = ['Brief', 'Cena inicial', 'Rascunho A', 'Variação A2', 'Final'];

export default function EditorPage() {
  return (
    <div className="flex h-screen flex-col">
      <TopBar />

      <div className="flex min-h-0 flex-1">
        <LibraryPanel />
        <Canvas />
        <InspectorPanel />
      </div>

      <Timeline />
    </div>
  );
}

function TopBar() {
  return (
    <header className="flex items-center justify-between border-b border-surface-border bg-surface-raised px-5 py-3">
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-semibold tracking-tight">Waymage</span>
        <span className="text-xs text-ink-muted">Projeto de demonstração · Fase 1</span>
      </div>

      <div className="flex items-center gap-5 text-xs text-ink-secondary">
        <span>
          créditos <span className="font-mono text-ink-primary">—</span>
        </span>
        <span>
          custo estimado <span className="font-mono text-ink-primary">—</span>
        </span>
        <button
          type="button"
          disabled
          title="Disponível na Fase 5"
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface-base disabled:cursor-not-allowed disabled:opacity-40"
        >
          Gerar
        </button>
      </div>
    </header>
  );
}

function LibraryPanel() {
  return (
    <aside className="w-60 shrink-0 overflow-y-auto border-r border-surface-border bg-surface-raised p-4">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-ink-muted">
        Biblioteca
      </h2>
      <ul className="space-y-1">
        {LIBRARY_SECTIONS.map((section) => (
          <li
            key={section.label}
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-ink-secondary hover:bg-surface-overlay"
          >
            {section.label}
            <span className="font-mono text-xs text-ink-muted">{section.count}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs leading-relaxed text-ink-muted">
        Upload de referências chega na Fase 4.
      </p>
    </aside>
  );
}

function Canvas() {
  return (
    <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="grid w-full max-w-3xl grid-cols-2 gap-3">
        {Array.from({ length: spec.output.count }, (_, i) => (
          <div
            key={i}
            className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-surface-border bg-surface-raised text-xs text-ink-muted"
          >
            rascunho {i + 1}
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-muted">
        {spec.output.count} rascunhos · {spec.output.aspectRatio} · {spec.output.quality}
      </p>
    </main>
  );
}

function InspectorPanel() {
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-surface-border bg-surface-raised p-4">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-ink-muted">
        Inspetor · Cena
      </h2>

      <dl className="space-y-2.5 text-sm">
        <Field label="Sujeito" value={spec.subject.description} />
        <Field label="Cenário" value={spec.scene.location} />
        <Field label="Enquadramento" value={spec.camera.shot} />
        <Field label="Iluminação" value={`${spec.lighting.key} · ${spec.lighting.contrast}`} />
        <Field label="Estilo" value={spec.style.preset} />
      </dl>

      <div className="mt-4 flex gap-1.5">
        {spec.style.palette.map((color) => (
          <span
            key={color}
            title={color}
            className="h-6 w-6 rounded border border-surface-border"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>

      <h3 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wider text-ink-muted">
        Validação
      </h3>
      {issues.length === 0 ? (
        <p className="text-xs text-state-ok">Nenhum conflito detectado.</p>
      ) : (
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li key={issue.code} className="text-xs leading-relaxed">
              <span
                className={
                  issue.level === 'error'
                    ? 'text-state-error'
                    : issue.level === 'warning'
                      ? 'text-state-warn'
                      : 'text-ink-muted'
                }
              >
                {issue.level}
              </span>{' '}
              <span className="text-ink-secondary">{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-ink-secondary">{value}</dd>
    </div>
  );
}

function Timeline() {
  return (
    <footer className="flex items-center justify-between border-t border-surface-border bg-surface-raised px-5 py-2.5">
      <ol className="flex items-center gap-2 text-xs text-ink-muted">
        {TIMELINE.map((step, index) => (
          <li key={step} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden>→</span>}
            <span className={index === 0 ? 'text-ink-secondary' : undefined}>{step}</span>
          </li>
        ))}
      </ol>
      <SystemStatus />
    </footer>
  );
}
