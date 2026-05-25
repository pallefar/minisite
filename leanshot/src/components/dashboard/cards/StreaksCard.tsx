import { useTranslation } from 'react-i18next';
import { Flame } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { useStreaks } from '@/hooks/useStreaks';
import { AchievementShield } from '@/illustrations/AchievementShield';
import { StreakBadge, type StreakTier } from '@/illustrations/StreakBadge';
import type { TFunction } from 'i18next';

type StreakKey = 'weight' | 'protein' | 'supps' | 'movement';

const ROWS: { key: StreakKey }[] = [
  { key: 'weight' },
  { key: 'protein' },
  { key: 'supps' },
  { key: 'movement' },
];

// Exhaustive switch helper — static keys so i18next-parser can extract them.
function getStreakRowLabel(t: TFunction, key: StreakKey): string {
  switch (key) {
    case 'weight':
      return t('patient:card.streaks.row_weight');
    case 'protein':
      return t('patient:card.streaks.row_protein');
    case 'supps':
      return t('patient:card.streaks.row_supps');
    case 'movement':
      return t('patient:card.streaks.row_movement');
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

export function StreaksCard() {
  const { t } = useTranslation('patient');
  const streaks = useStreaks();
  const hasMilestone =
    streaks.weight >= 30 ||
    streaks.protein >= 30 ||
    streaks.supps >= 30 ||
    streaks.movement >= 30;
  return (
    <Card span={12}>
      <CardHeader
        title={t('patient:card.streaks.title')}
        icon={<Flame className="size-4" />}
        action={<Badge tone="info">{t('patient:card.streaks.badge_keep_going')}</Badge>}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {ROWS.map((r) => {
          const count = streaks[r.key];
          const tier: StreakTier =
            count < 7
              ? 'locked'
              : count >= 90
                ? 'gold'
                : count >= 30
                  ? 'silver'
                  : 'bronze';
          const label = getStreakRowLabel(t, r.key);
          return (
            <div
              key={r.key}
              className="rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-4 flex items-center gap-3"
            >
              <StreakBadge tier={tier} className="size-12 shrink-0" />
              <div className="min-w-0">
                <p className="text-[20px] font-bold leading-none numerals-tabular">
                  {count}
                  <span className="text-[12px] text-[var(--color-text-secondary)] font-medium ms-1">
                    {t('patient:streak_day', { count })}
                  </span>
                </p>
                <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)] mt-0.5 font-semibold">
                  {label}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      {hasMilestone && (
        <div className="mt-4 p-4 rounded-2xl bg-[var(--color-primary-soft)] border border-[var(--color-primary)] flex items-center gap-3">
          <AchievementShield className="w-12 h-12 shrink-0" />
          <div>
            <p className="text-[13px] font-bold">{t('patient:card.streaks.milestone_title')}</p>
            <p className="text-[11px] text-[var(--color-text-secondary)]">
              {t('patient:card.streaks.milestone_body')}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
