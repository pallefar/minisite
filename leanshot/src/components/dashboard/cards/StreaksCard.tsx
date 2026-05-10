import { Flame } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { useStreaks } from '@/hooks/useStreaks';
import { StreakBadge } from '@/illustrations/StreakBadge';

const ROWS: { key: keyof ReturnType<typeof useStreaks>; label: string }[] = [
  { key: 'weight', label: 'Weight log' },
  { key: 'protein', label: 'Protein hit' },
  { key: 'supps', label: 'Stack run' },
  { key: 'movement', label: 'Active days' },
];

export function StreaksCard() {
  const streaks = useStreaks();
  return (
    <Card span={12}>
      <CardHeader
        title="Your streaks"
        icon={<Flame className="size-4" />}
        action={<Badge tone="info">Keep it going</Badge>}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {ROWS.map((r) => {
          const count = streaks[r.key];
          const variant = count >= 90 ? '90d' : count >= 30 ? '30d' : '7d';
          const locked = count < 7;
          return (
            <div
              key={r.label}
              className="rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4 flex items-center gap-3"
            >
              <StreakBadge variant={variant} className="size-12 shrink-0" locked={locked} />
              <div className="min-w-0">
                <p className="text-[20px] font-bold leading-none numerals-tabular">
                  {count}
                  <span className="text-[12px] text-[var(--color-text-secondary)] font-medium ml-1">
                    {count === 1 ? 'day' : 'days'}
                  </span>
                </p>
                <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)] mt-0.5 font-semibold">
                  {r.label}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
