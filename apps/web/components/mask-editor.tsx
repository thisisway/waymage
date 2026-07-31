'use client';

import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api, uploadAsset } from '../lib/api';
import { Button, Field, Slider, Toggle } from './ui/controls';
import { Icon, Spinner } from './ui/icons';
import { toast } from './ui/toast';

/**
 * Edição localizada: pinta onde mudar e descreve o que mudar.
 *
 * A máscara é pintada num `<canvas>` do tamanho real da imagem, não do tamanho exibido — o
 * provedor recebe pixels na resolução original, e escalar uma máscara pequena para cima
 * borraria a borda justo onde a precisão importa.
 *
 * Suavização e inversão ficam como parâmetros da operação, não gravados na pintura. Assim dá
 * para repetir a edição com outro valor sem repintar nada, e o registro do que foi pedido
 * continua legível meses depois.
 */

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

export function MaskEditor({
  resultId,
  projectId,
  imageUrl,
  width,
  height,
  onClose,
  onSubmit,
}: {
  resultId: string;
  projectId: string;
  imageUrl: string;
  width: number;
  height: number;
  onClose: () => void;
  onSubmit: (jobId: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [brush, setBrush] = useState(Math.max(16, Math.round(width / 12)));
  const [zoom, setZoom] = useState(1);
  const [feather, setFeather] = useState(8);
  const [inverted, setInverted] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Converte coordenada de tela em pixel da imagem, independentemente do zoom. */
  function pointAt(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * width,
      y: ((event.clientY - box.top) / box.height) * height,
    };
  }

  function stroke(from: { x: number; y: number } | null, to: { x: number; y: number }): void {
    const context = canvas.current?.getContext('2d');
    if (!context) return;

    // `destination-out` apaga de verdade em vez de pintar preto por cima: a exportação
    // decide pelo alfa, e um "preto pintado" seria indistinguível de área marcada.
    context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    context.strokeStyle = '#1D66FF';
    context.fillStyle = '#1D66FF';
    context.lineWidth = brush;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    if (from) {
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    } else {
      // Clique sem arrastar também marca: um toque preciso é um gesto legítimo.
      context.beginPath();
      context.arc(to.x, to.y, brush / 2, 0, Math.PI * 2);
      context.fill();
    }

    setPainted(true);
  }

  function clear(): void {
    canvas.current?.getContext('2d')?.clearRect(0, 0, width, height);
    setPainted(false);
  }

  /**
   * Converte a pintura na máscara que o provedor espera: branco onde editar, preto onde
   * preservar. A decisão é pelo alfa, então a cor usada na tela não contamina o resultado.
   */
  async function toMaskFile(): Promise<File> {
    const source = canvas.current;
    if (!source) throw new Error('Canvas indisponível');

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const context = out.getContext('2d');
    if (!context) throw new Error('Canvas indisponível');

    const strokes = source.getContext('2d')?.getImageData(0, 0, width, height);
    const mask = context.createImageData(width, height);
    for (let i = 0; i < mask.data.length; i += 4) {
      const on = (strokes?.data[i + 3] ?? 0) >= 128 ? 255 : 0;
      mask.data[i] = on;
      mask.data[i + 1] = on;
      mask.data[i + 2] = on;
      mask.data[i + 3] = 255;
    }
    context.putImageData(mask, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Falha ao gerar a máscara');

    return new File([blob], `mask-${resultId}.png`, { type: 'image/png' });
  }

  const submit = useMutation({
    mutationFn: async () => {
      const asset = await uploadAsset(projectId, await toMaskFile(), 'MASK');
      return api.edit(
        resultId,
        { maskAssetId: asset.id, instruction, featherPx: feather, inverted },
        crypto.randomUUID(),
      );
    },
    onSuccess: (job) => {
      toast.info('Edição na fila');
      onSubmit(job.id);
      onClose();
    },
    onError: (caught) => {
      toast.error(
        caught instanceof ApiError ? caught.message : 'Não foi possível enviar a edição.',
      );
    },
  });

  const ready = painted && instruction.trim().length >= 3;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Edição localizada"
      className="fixed inset-0 z-40 flex flex-col bg-surface-base/95 backdrop-blur"
    >
      <header className="flex items-center gap-3 border-b border-surface-border px-5 py-3">
        <Icon name="refine" className="h-4 w-4 text-accent-40" />
        <span className="text-h3 text-ink-primary">Editar região</span>
        <span className="text-micro text-ink-muted">
          pinte o que deve mudar · o resto permanece
        </span>

        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-all duration-fast ease-out hover:bg-surface-overlay hover:text-ink-primary"
        >
          <Icon name="close" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Área de pintura. `overflow-auto` entrega o pan de graça: com zoom acima de 100%
            o conteúdo excede o quadro e o navegador rola, sem matemática de arrasto. */}
        <div className="flex-1 overflow-auto bg-surface-overlay/40 p-6">
          <div className="relative mx-auto" style={{ width: width * zoom, height: height * zoom }}>
            <img
              src={imageUrl}
              alt="Imagem a editar"
              draggable={false}
              className="absolute inset-0 h-full w-full select-none rounded-md"
            />
            <canvas
              ref={canvas}
              width={width}
              height={height}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                painting.current = true;
                const point = pointAt(event);
                stroke(null, point);
                last.current = point;
              }}
              onPointerMove={(event) => {
                if (!painting.current) return;
                const point = pointAt(event);
                stroke(last.current, point);
                last.current = point;
              }}
              onPointerUp={() => {
                painting.current = false;
                last.current = null;
              }}
              onPointerLeave={() => {
                painting.current = false;
                last.current = null;
              }}
              className="absolute inset-0 h-full w-full cursor-crosshair rounded-md opacity-55"
            />
          </div>
        </div>

        <aside className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-surface-border p-4">
          <Field label="Ferramenta">
            <div className="flex gap-1.5">
              <ToolButton active={tool === 'brush'} onClick={() => setTool('brush')} icon="plus">
                pincel
              </ToolButton>
              <ToolButton active={tool === 'eraser'} onClick={() => setTool('eraser')} icon="close">
                borracha
              </ToolButton>
              <ToolButton active={false} onClick={clear} icon="trash">
                limpar
              </ToolButton>
            </div>
          </Field>

          <Slider
            label="Espessura"
            value={brush}
            min={4}
            max={Math.max(24, Math.round(Math.min(width, height) / 2))}
            step={2}
            format={(value) => `${value}px`}
            onChange={setBrush}
          />

          <Slider
            label="Zoom"
            value={zoom}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.25}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={setZoom}
          />

          <Slider
            label="Suavizar borda"
            value={feather}
            min={0}
            max={64}
            step={1}
            format={(value) => `${value}px`}
            hint="Evita emenda visível entre o que mudou e o que ficou."
            onChange={setFeather}
          />

          <Toggle
            label="Inverter"
            value={inverted}
            description="Edita tudo MENOS o que foi pintado."
            onChange={setInverted}
          />

          <Field label="O que mudar" hint="Descreva só a região pintada.">
            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="trocar o fundo por uma parede de concreto"
              className="w-full resize-none rounded-md border border-surface-border bg-surface-overlay px-2.5 py-2 text-[13px] text-ink-primary outline-none transition-all duration-fast ease-out placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/25"
            />
          </Field>

          <Button onClick={() => submit.mutate()} disabled={!ready || submit.isPending}>
            {submit.isPending ? <Spinner className="h-4 w-4" /> : <Icon name="sparkles" />}
            {submit.isPending ? 'enviando…' : 'Editar'}
          </Button>

          {!painted && (
            <p className="text-micro text-ink-muted">
              Nada pintado ainda — sem máscara não há o que editar.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: 'plus' | 'close' | 'trash';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 flex-col items-center gap-1 rounded-md border px-2 py-2 text-micro font-semibold transition-all duration-fast ease-out active:scale-[0.96] ${
        active
          ? 'border-accent bg-accent/10 text-ink-primary'
          : 'border-surface-border text-ink-muted hover:border-accent-40/60 hover:text-ink-secondary'
      }`}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}
