import { useState } from 'react';
import { FileText, Sparkles, Trophy, Star, Lightbulb, ChartLine, X, BookOpen } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ShareCardModal } from '@/components/dashboard/share/ShareCardModal';
import { useStore } from '@/lib/store';
import { useToast } from '@/hooks/useToast';
import { generateInsights } from '@/lib/insights';
import { todayStr, formatShort } from '@/lib/helpers';

interface InsightsTabProps {
  onOpenReport?: () => void;
}

export function InsightsTab({ onOpenReport }: InsightsTabProps) {
  const u = useStore((s) => s.user!);
  const nsvs = useStore((s) => s.nsvs);
  const addNSV = useStore((s) => s.addNSV);
  const removeNSV = useStore((s) => s.removeNSV);
  const meals = useStore((s) => s.meals);
  const weights = useStore((s) => s.weights);
  const workouts = useStore((s) => s.workouts);
  const injections = useStore((s) => s.injections);
  const insights = useStore(generateInsights);
  const toast = useToast();

  const [shareOpen, setShareOpen] = useState(false);
  const [nsv, setNsv] = useState('');

  const wU = u.units === 'metric' ? 'kg' : 'lb';
  const weekAgo = Date.now() - 7 * 86_400_000;
  const recentW = weights.filter((w) => new Date(w.date).getTime() > weekAgo);
  const recentMeals = meals.filter((m) => new Date(m.date).getTime() > weekAgo);
  const recentWorkouts = workouts.filter((w) => new Date(w.date).getTime() > weekAgo);
  const recentInj = injections.filter((i) => new Date(i.datetime).getTime() > weekAgo);
  const wDelta = recentW.length >= 2 ? recentW[0]!.weight - recentW[recentW.length - 1]!.weight : 0;
  const proteinAvg = recentMeals.length > 0
    ? Math.round(recentMeals.reduce((s, m) => s + (m.protein || 0), 0) / Math.max(1, new Set(recentMeals.map((m) => m.date)).size))
    : 0;

  return (
    <div className="grid grid-cols-12 gap-4 md:gap-5 stagger">
      <Card span={6}>
        <CardHeader title="Doctor-ready report" icon={<FileText className="size-4" />} />
        <p className="text-[13px] text-[var(--color-text-secondary)] mb-4">
          A clean printable summary — injections, weight, side effects, trends. Bring this to every visit.
        </p>
        <Button block onClick={() => onOpenReport?.()}>Generate report</Button>
      </Card>

      <Card span={6}>
        <CardHeader title="Shareable progress card" icon={<Sparkles className="size-4" />} />
        <p className="text-[13px] text-[var(--color-text-secondary)] mb-4">
          A beautiful 9:16 image with three templates. For Instagram stories, your community, or your fridge.
        </p>
        <Button block onClick={() => setShareOpen(true)}>Create progress card</Button>
      </Card>

      <Card span={6}>
        <CardHeader title="Add a non-scale victory" icon={<Trophy className="size-4" />} />
        <p className="text-[12px] text-[var(--color-text-secondary)] mb-3">
          Rings fit. Energy up. Old jeans button. These are wins.
        </p>
        <div className="flex gap-2">
          <Input placeholder="e.g. Wedding ring fits" value={nsv} onChange={(e) => setNsv(e.target.value)} className="flex-1" />
          <Button onClick={() => {
            const t = nsv.trim();
            if (!t) return toast('Type a win', 'error');
            addNSV(t, todayStr());
            setNsv('');
            toast('Win added');
          }}>Save</Button>
        </div>
      </Card>

      <Card span={6}>
        <CardHeader title="Your wins" icon={<Star className="size-4" />} />
        {nsvs.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-tertiary)] text-center py-4">No wins logged yet.</p>
        ) : (
          <ul className="space-y-2">
            {nsvs.slice(0, 8).map((n, i) => (
              <li key={n.text + i} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)]">
                <span className="size-8 rounded-lg bg-[var(--color-amber)]/15 text-[var(--color-amber)] inline-flex items-center justify-center shrink-0">
                  <Star className="size-4" strokeWidth={2} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold leading-tight">{n.text}</p>
                  <p className="text-[11px] text-[var(--color-text-tertiary)]">{formatShort(n.date)}</p>
                </div>
                <button onClick={() => removeNSV(i)} aria-label="Delete win" className="size-7 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface)] inline-flex items-center justify-center">
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card span={12}>
        <CardHeader title="Smart insights" icon={<Lightbulb className="size-4" />} />
        {insights.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-tertiary)] text-center py-6">
            Insights appear as you log more data.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {insights.map((ins, i) => (
              <li key={i} className={`rounded-2xl px-4 py-3.5 flex gap-3 ${
                ins.tone === 'success' ? 'bg-[var(--color-success-soft)]'
                : ins.tone === 'warning' ? 'bg-[var(--color-warning-soft)]'
                : 'bg-[var(--color-info-soft)]'
              }`}>
                <span className={`size-8 rounded-xl text-white inline-flex items-center justify-center shrink-0 ${
                  ins.tone === 'success' ? 'bg-[var(--color-success)]'
                  : ins.tone === 'warning' ? 'bg-[var(--color-warning)]'
                  : 'bg-[var(--color-info)]'
                }`}>
                  <Lightbulb className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] font-bold">{ins.title}</p>
                  <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5 leading-snug">{ins.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card span={12}>
        <CardHeader title="Weekly summary" icon={<ChartLine className="size-4" />} />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <Tile label="Weight" value={`${wDelta < 0 ? '↓' : ''}${Math.abs(wDelta).toFixed(1)} ${wU}`} />
          <Tile label="Avg protein" value={`${proteinAvg}g`} />
          <Tile label="Workouts" value={recentWorkouts.length} />
          <Tile label="Injections" value={recentInj.length} />
          <Tile label="Meals" value={recentMeals.length} />
          <Tile label="Wins" value={nsvs.filter((n) => new Date(n.date).getTime() > weekAgo).length} />
        </div>
      </Card>

      <Card span={12} className="bg-[var(--color-hero-bg)] text-white border-transparent shadow-hero">
        <div className="flex flex-wrap items-center gap-5">
          <span className="size-14 rounded-2xl bg-white/12 inline-flex items-center justify-center">
            <BookOpen className="size-7" strokeWidth={1.6} />
          </span>
          <div className="flex-1 min-w-[220px]">
            <h3 className="text-[18px] font-bold tracking-tight mb-1">The GLP-1 Survival Guide</h3>
            <p className="text-[13px] opacity-85 mb-3 leading-snug">
              90 pages. Side-effect playbook, muscle-preservation protocol, plateau breakers, 28-day high-protein meal plan.
            </p>
            <Button variant="inverse" size="sm" onClick={() => alert('Connect your payment provider here.')}>
              Get the guide →
            </Button>
          </div>
        </div>
      </Card>

      <ShareCardModal open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[var(--color-text-tertiary)]">{label}</p>
      <p className="text-[20px] font-bold tracking-tight numerals-tabular mt-0.5">{value}</p>
    </div>
  );
}
