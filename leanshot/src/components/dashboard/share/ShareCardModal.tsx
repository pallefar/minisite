import { useEffect, useRef, useState } from 'react';
import { Download, Copy } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useStore } from '@/lib/store';
import { useToast } from '@/hooks/useToast';
import { useStreaks } from '@/hooks/useStreaks';
import { medLabelShort } from '@/lib/pharmacology';
import { todayStr, cn } from '@/lib/helpers';
import { boldTemplate } from '@/lib/share-card/template-bold';
import { minimalTemplate } from '@/lib/share-card/template-minimal';
import { milestoneTemplate } from '@/lib/share-card/template-milestone';
import type { ShareData, Template, TemplateId } from '@/lib/share-card/renderer';

const TEMPLATES: Template[] = [boldTemplate, minimalTemplate, milestoneTemplate];

export function ShareCardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const u = useStore((s) => s.user!);
  const weights = useStore((s) => s.weights);
  const injections = useStore((s) => s.injections);
  const nsvs = useStore((s) => s.nsvs);
  const streaks = useStreaks();
  const toast = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tplId, setTplId] = useState<TemplateId>('bold');

  const latest = weights[weights.length - 1];
  const data: ShareData = {
    name: u.name,
    medication: medLabelShort(u.medication),
    dose: u.dose,
    doseUnit: u.doseUnit,
    weeks: Math.floor((Date.now() - new Date(u.startDate).getTime()) / (7 * 86_400_000)),
    startWeight: u.startWeight,
    currentWeight: latest?.weight ?? u.startWeight,
    goalWeight: u.goalWeight,
    injections: injections.length,
    bestStreak: Math.max(...Object.values(streaks)),
    units: u.units,
    nsv: nsvs[0]?.text ?? null,
  };

  useEffect(() => {
    if (!open) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const tpl = TEMPLATES.find((t) => t.id === tplId)!;
    tpl.draw(ctx, data);
  }, [open, tplId, data]);

  const download = (): void => {
    const c = canvasRef.current;
    if (!c) return;
    const link = document.createElement('a');
    link.download = `leanshot-${tplId}-${todayStr()}.png`;
    link.href = c.toDataURL('image/png');
    link.click();
    toast('Card downloaded');
  };
  const copy = async (): Promise<void> => {
    const c = canvasRef.current;
    if (!c) return;
    try {
      c.toBlob(async (blob) => {
        if (!blob) return;
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('Copied to clipboard');
      });
    } catch {
      toast('Copy not supported — use Download', 'error');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Your progress card" size="md" mobileFullscreen>
      <div className="flex flex-col gap-4 items-center">
        <div className="w-full max-w-[340px] aspect-[9/16] rounded-2xl overflow-hidden shadow-lg bg-[var(--color-hero-bg)]">
          <canvas ref={canvasRef} width={540} height={960} className="w-full h-full block" />
        </div>
        <div role="radiogroup" aria-label="Template" className="flex gap-2 w-full max-w-[340px]">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={tplId === t.id}
              onClick={() => setTplId(t.id)}
              className={cn(
                'flex-1 px-3 py-2 rounded-xl border text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                tplId === t.id
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]',
              )}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div className="flex gap-2 w-full max-w-[340px]">
          <Button block onClick={download} leadingIcon={<Download className="size-4" />}>Download</Button>
          <Button variant="secondary" block onClick={copy} leadingIcon={<Copy className="size-4" />}>Copy</Button>
        </div>
        <p className="text-[11px] text-[var(--color-text-tertiary)] text-center">
          Share to Instagram, Reddit, or your community.
        </p>
      </div>
    </Modal>
  );
}
