/**
 * StreakCard — displays current streak + longest streak + freeze token count.
 *
 * Phase 35 Plan 35-06 — GAME-06 (progress rings on dashboard) + GAME-03 (freeze tokens).
 * Reuses v1.2 DS-9 ProgressRing for streak visualization.
 */
import { Flame, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader } from '@/components/ui/Card';
import { ProgressRing } from '@/components/ui/ProgressRing';
import type { GamificationDashboardData } from '@/lib/gamification/dashboard-data';

export interface StreakCardProps {
  data: GamificationDashboardData;
}

export function StreakCard({ data }: StreakCardProps) {
  const { t } = useTranslation('patient');
  const ringMax = Math.max(7, data.streak.longest);

  return (
    <Card span={4} variant="elevated">
      <CardHeader title={t('patient:card.streak.title')} icon={<Flame className="size-4" aria-hidden />} />
      <div className="flex items-center gap-4">
        <ProgressRing
          value={data.streak.current}
          max={ringMax}
          label={t('patient:card.streak.ring_label', { count: data.streak.current })}
          size={80}
        >
          <span className="text-[18px] font-bold text-[var(--color-text)]" aria-hidden>
            {data.streak.current}d
          </span>
        </ProgressRing>
        <div className="flex-1 min-w-0 text-sm">
          <div className="text-[var(--color-text-secondary)]">
            {t('patient:card.streak.longest', { days: data.streak.longest })}
          </div>
          <div className="mt-1 flex items-center gap-1 text-[var(--color-text-secondary)]">
            <Shield size={14} aria-hidden />
            {t('patient:freeze_token', { count: data.freezeTokens })}
          </div>
        </div>
      </div>
    </Card>
  );
}
