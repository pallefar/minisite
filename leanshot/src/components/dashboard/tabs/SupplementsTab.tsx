import { Flame, RotateCcw, ChartLine, Check } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { SuppChart } from '@/components/dashboard/charts/SimpleCharts';
import { SUPPS_DEFAULT } from '@/lib/constants';
import { useStore } from '@/lib/store';
import { todayStr, cn } from '@/lib/helpers';

export function SupplementsTab() {
  const today = todayStr();
  const supplements = useStore((s) => s.supplements);
  const toggle = useStore((s) => s.toggleSupp);
  const reset = useStore((s) => s.resetSuppsForDate);
  const taken = supplements[today] ?? {};
  const count = Object.values(taken).filter(Boolean).length;

  return (
    <div className="grid grid-cols-12 gap-4 md:gap-5 stagger">
      <Card span={12}>
        <CardHeader
          title="Today's stack"
          icon={<Flame className="size-4" />}
          action={
            <div className="flex items-center gap-2">
              <Badge tone="info">{count} / {SUPPS_DEFAULT.length}</Badge>
              <Button variant="secondary" size="sm" onClick={() => reset(today)} leadingIcon={<RotateCcw className="size-3.5" />}>
                Reset
              </Button>
            </div>
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SUPPS_DEFAULT.map((s) => {
            const isTaken = !!taken[s.id];
            return (
              <div
                key={s.id}
                className={cn(
                  'rounded-2xl border p-4 transition-colors relative',
                  isTaken
                    ? 'bg-[var(--color-success-soft)] border-[var(--color-success)]'
                    : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)]',
                )}
              >
                {isTaken && (
                  <span className="absolute top-3 right-3 size-6 rounded-full bg-[var(--color-success)] text-white inline-flex items-center justify-center">
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                )}
                <div className="flex items-start gap-3 mb-2">
                  <span className="size-10 rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)] inline-flex items-center justify-center font-bold uppercase text-[12px]">
                    {s.name.slice(0, 2)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold leading-tight">{s.name}</p>
                    <p className="text-[11px] text-[var(--color-text-tertiary)] truncate">{s.brand}</p>
                  </div>
                </div>
                <p className="text-[12px] text-[var(--color-text-secondary)] leading-snug mb-3">{s.why}</p>
                <div className="flex gap-2">
                  <Button variant={isTaken ? 'ghost' : 'primary'} size="sm" onClick={() => toggle(today, s.id)}>
                    {isTaken ? 'Undo' : 'Logged'}
                  </Button>
                  <a
                    href={`https://www.amazon.com/s?k=${s.search}`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center justify-center h-8 px-3 rounded-pill bg-transparent border border-[var(--color-border-strong)] text-[13px] font-semibold hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                  >
                    Reorder
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card span={12}>
        <CardHeader title="Adherence · 14 days" icon={<ChartLine className="size-4" />} />
        <SuppChart />
      </Card>
    </div>
  );
}
