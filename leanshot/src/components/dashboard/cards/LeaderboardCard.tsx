/**
 * LeaderboardCard — top-10 + ±5 neighborhood from get_leaderboard_for_user RPC.
 *
 * Phase 35 Plan 35-06 — GAME-04 (leaderboard display).
 *
 * Features:
 *   - D-12: opt-in nudge after user reaches level 5 (one-time, dismissed via nudgeDismissed prop)
 *   - D-14: top-10 always + user's ±5 neighborhood
 *   - Returns null if user is not in any leaderboard-enabled cohort
 *
 * Props sourced by Plan 35-08 (Settings → Leaderboards subtab owns the toggle + cohortId).
 * cohortId / hasOptedIn / nudgeDismissed are stubbed in GamificationCard for now.
 */
import { Trophy, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader } from '@/components/ui/Card';
import type { GamificationDashboardData } from '@/lib/gamification/dashboard-data';
import { fetchLeaderboardForCohort, type LeaderboardRow } from '@/lib/gamification/leaderboard';

const NUDGE_THRESHOLD_LEVEL = 5; // D-12: one-time nudge after user reaches level 5

export interface LeaderboardCardProps {
  data: GamificationDashboardData;
  /** UUID of user's primary leaderboard-enabled cohort; null = no leaderboard available */
  cohortId: string | null;
  hasOptedIn: boolean;
  nudgeDismissed: boolean;
  onOpenLeaderboardSettings: () => void;
  onDismissNudge: () => void;
}

export function LeaderboardCard({
  data,
  cohortId,
  hasOptedIn,
  nudgeDismissed,
  onOpenLeaderboardSettings,
  onDismissNudge,
}: LeaderboardCardProps) {
  const { t } = useTranslation('patient');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cohortId || !hasOptedIn) return;
    setLoading(true);
    setError(null);
    fetchLeaderboardForCohort(cohortId)
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [cohortId, hasOptedIn]);

  // User not in any leaderboard-enabled cohort — render nothing
  if (!cohortId) return null;

  // D-12: one-time opt-in nudge after level 5, single-shot
  const showNudge = data.level >= NUDGE_THRESHOLD_LEVEL && !hasOptedIn && !nudgeDismissed;

  if (showNudge) {
    return (
      <Card span={8} variant="interactive">
        <CardHeader
          title={t('patient:card.leaderboard.nudge_title')}
          icon={<Users className="size-4" aria-hidden />}
        />
        <p className="text-sm text-[var(--color-text-secondary)]">
          {t('patient:card.leaderboard.nudge_body', { level: data.level })}
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            onClick={onOpenLeaderboardSettings}
          >
            {t('patient:card.leaderboard.nudge_cta_accept')}
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-xl text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:underline"
            onClick={onDismissNudge}
          >
            {t('patient:card.leaderboard.nudge_cta_dismiss')}
          </button>
        </div>
      </Card>
    );
  }

  if (!hasOptedIn) return null;

  return (
    <Card span={8} variant="elevated">
      <CardHeader
        title={t('patient:card.leaderboard.title')}
        icon={<Trophy className="size-4" aria-hidden />}
      />
      {loading && (
        <div className="text-sm text-[var(--color-text-secondary)]">
          {t('patient:card.leaderboard.loading')}
        </div>
      )}
      {error && (
        <div className="text-sm text-[var(--color-error)]">
          {t('patient:card.leaderboard.error')}
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <div className="text-sm text-[var(--color-text-secondary)]">
          {t('patient:card.leaderboard.empty')}
        </div>
      )}
      {rows.length > 0 && (
        <ol className="mt-2 space-y-1">
          {rows.map((r) => (
            <li
              key={`${r.rank_in_cohort}-${r.handle}`}
              className={
                r.is_self ? 'font-semibold text-[var(--color-primary)]' : 'text-[var(--color-text)]'
              }
            >
              <span className="inline-block w-8 text-right text-[var(--color-text-secondary)]">
                {r.rank_in_cohort}.
              </span>{' '}
              <span>{r.handle}</span>{' '}
              <span className="text-[var(--color-text-secondary)] text-sm">
                — {r.xp_7d.toLocaleString()} XP (7d)
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
