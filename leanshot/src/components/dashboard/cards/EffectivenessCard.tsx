import { ArrowUpRight, TrendingDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressRing';
import { SUPPS_DEFAULT } from '@/lib/constants';
import { todayStr, formatShort } from '@/lib/helpers';
import { useStore } from '@/lib/store';

export function EffectivenessCard() {
  // Phase 7 Plan 07-09 (D-06): nullable selector + early-return after hooks.
  const { t } = useTranslation('patient');
  const u = useStore((s) => s.user);
  const weights = useStore((s) => s.weights);
  const meals = useStore((s) => s.meals);
  const supplements = useStore((s) => s.supplements);
  const setTab = useStore((s) => s.setTab);

  if (!u) return null;

  const wU = u.units === 'metric' ? 'kg' : 'lb';
  const latest = weights[weights.length - 1];
  const lost = latest ? u.startWeight - latest.weight : 0;
  const lostAbs = Math.abs(lost);
  const curW = latest ? latest.weight : u.startWeight;
  const goalLoss = u.startWeight - u.goalWeight;
  const goalPct = goalLoss > 0 ? Math.min(100, Math.max(0, (lost / goalLoss) * 100)) : 0;
  const today = todayStr();
  const todayProtein = meals
    .filter((m) => m.date === today)
    .reduce((s, m) => s + (m.protein || 0), 0);
  const proteinPct = Math.min(100, (todayProtein / u.proteinTarget) * 100);

  // Adherence (last 7 days)
  let total = 0;
  let hits = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    total += SUPPS_DEFAULT.length;
    if (supplements[ds]) hits += Object.values(supplements[ds]).filter(Boolean).length;
  }
  const adherence = total > 0 ? Math.round((hits / total) * 100) : 0;
  const weeks = Math.floor((Date.now() - new Date(u.startDate).getTime()) / (7 * 86_400_000));

  return (
    <Card span={4} variant="default">
      <CardHeader
        title={t('patient:card.effectiveness.title')}
        icon={<TrendingDown className="size-4" />}
        action={
          <button
            onClick={() => setTab('body')}
            aria-label={t('patient:card.effectiveness.open_body_tab')}
            className="size-8 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <ArrowUpRight className="size-4" />
          </button>
        }
      />
      <div className="space-y-3.5">
        <Row
          name={t('patient:card.effectiveness.row_body_weight')}
          value={
            <>
              <span
                className={
                  lost >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'
                }
              >
                {lost >= 0 ? '↓' : '↑'} {lostAbs.toFixed(1)} {wU}
              </span>{' '}
              {curW.toFixed(1)} {wU}
            </>
          }
          pct={Math.min(100, Math.max(5, goalPct))}
          color="var(--color-primary)"
        />
        <Row
          name={t('patient:card.effectiveness.row_goal_progress')}
          value={`${Math.round(goalPct)}%`}
          pct={goalPct}
          color="var(--color-success)"
        />
        <Row
          name={t('patient:card.effectiveness.row_protein_today')}
          value={`${todayProtein}/${u.proteinTarget}g`}
          pct={proteinPct}
          color={proteinPct >= 100 ? 'var(--color-success)' : 'var(--color-rose)'}
        />
        <Row
          name={t('patient:card.effectiveness.row_adherence')}
          value={`${adherence}%`}
          pct={adherence}
          color="var(--color-primary)"
        />
      </div>
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--color-border)] text-[12px] text-[var(--color-text-tertiary)]">
        <span>
          {t('patient:card.effectiveness.since_week', { date: formatShort(u.startDate), week: weeks })}
        </span>
        <button
          onClick={() => setTab('insights')}
          className="text-[var(--color-primary)] font-semibold hover:underline focus-visible:outline-none focus-visible:underline"
        >
          {t('patient:card.effectiveness.full_report')}
        </button>
      </div>
    </Card>
  );
}

function Row({
  name,
  value,
  pct,
  color,
}: {
  name: string;
  value: React.ReactNode;
  pct: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-[var(--color-text-secondary)]">{name}</span>
        <span className="font-bold text-[var(--color-text)] numerals-tabular">{value}</span>
      </div>
      <ProgressBar
        value={pct}
        className="mt-1.5"
        color={color}
        thickness="thin"
        label={String(name)}
      />
    </div>
  );
}
