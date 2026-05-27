/**
 * Phase 35 Plan 35-05 — D-11 LeaderboardEnable admin component.
 *
 * Displays a list of all cohorts with a toggle to enable/disable leaderboards.
 * D-11 ethical advisory: only enable for cohorts with strong psychological fit
 * (e.g., GLP-1 Veterans 6mo+). Do NOT enable for newly-diagnosed or vulnerable cohorts.
 *
 * Surface gate: admin.gamification.cohorts.enable_leaderboard (support_lead/superadmin).
 */
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/hooks/useToast';
import { setCohortLeaderboardEnabled, ChallengeApiError } from '@/lib/gamification/admin-api';
import { supabase } from '@/lib/supabase';

interface CohortRow {
  id: string;
  name: string;
  leaderboard_enabled: boolean;
}

export default function LeaderboardEnable() {
  const toast = useToast();
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    void loadCohorts();
  }, []);

  async function loadCohorts() {
    setLoading(true);
    const { data, error } = await supabase
      .from('cohort_definitions')
      .select('id, name, leaderboard_enabled')
      .order('name');
    if (error) {
      toast('Could not load cohorts', 'error');
    } else {
      setCohorts((data as CohortRow[]) ?? []);
    }
    setLoading(false);
  }

  async function handleToggle(cohortId: string, current: boolean) {
    setToggling(cohortId);
    try {
      await setCohortLeaderboardEnabled(cohortId, !current);
      setCohorts((prev: CohortRow[]) =>
        prev.map((c: CohortRow) =>
          c.id === cohortId ? { ...c, leaderboard_enabled: !current } : c,
        ),
      );
      toast(
        !current
          ? 'Leaderboard enabled for this cohort'
          : 'Leaderboard disabled for this cohort',
        'success',
      );
    } catch (err) {
      if (err instanceof ChallengeApiError && err.code === 'not_admin') {
        toast('You need support_lead or superadmin access', 'error');
      } else {
        toast('Could not update leaderboard setting', 'error');
      }
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* D-11 ethical advisory */}
      <Card variant="flat" padding="lg" className="border-l-4 border-[var(--color-warning)] bg-[var(--color-surface-elevated)]">
        <p className="text-sm font-semibold mb-1">Ethical responsibility — admin-curated only</p>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Only enable leaderboards for cohorts with strong psychological fit
          (e.g., GLP-1 Veterans 6mo+). Do NOT enable for newly-diagnosed or
          vulnerable cohorts where competitive framing could cause harm.
        </p>
        <a
          href="/runbooks/leaderboard-cohort-criteria.md"
          className="text-xs font-medium text-[var(--color-primary)] hover:underline mt-2 inline-block"
          target="_blank"
          rel="noreferrer"
        >
          View leaderboard cohort criteria runbook →
        </a>
      </Card>

      <Card variant="elevated" padding="lg">
        <h3 className="text-base font-semibold mb-4">Cohort leaderboard settings</h3>
        {loading ? (
          <p className="text-sm text-[var(--color-text-secondary)]">Loading cohorts…</p>
        ) : cohorts.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No cohorts found.</p>
        ) : (
          <ul className="space-y-3">
            {cohorts.map((cohort) => (
              <li key={cohort.id} className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium">{cohort.name}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={cohort.leaderboard_enabled}
                  aria-label={`Enable leaderboard for ${cohort.name}`}
                  disabled={toggling === cohort.id}
                  onClick={() => void handleToggle(cohort.id, cohort.leaderboard_enabled)}
                  className={[
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 disabled:opacity-50',
                    cohort.leaderboard_enabled
                      ? 'bg-[var(--color-primary)]'
                      : 'bg-[var(--color-border)]',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                      cohort.leaderboard_enabled ? 'translate-x-6' : 'translate-x-1',
                    ].join(' ')}
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
