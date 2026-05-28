/**
 * Phase 35 Plan 35-08 (GAME-04) — Settings → Leaderboards subtab.
 *
 * Lists all leaderboard-enabled cohorts the authenticated user belongs to.
 * For each cohort the user can:
 *   - Toggle opt-in / opt-out (calls set_leaderboard_optin RPC via Plan 35-04 wrapper)
 *   - Set a handle (validated client-side by validateHandle from Plan 35-04;
 *     server always re-validates via CHECK constraint + RPC)
 *   - Request a server-suggested default (suggest_leaderboard_handle RPC)
 *
 * Opt-out contract (D-15): active=false preserves the row; handle is kept so
 * the user can re-opt-in with the same handle. The matview excludes inactive
 * rows within the 15-min refresh window.
 *
 * Follows the NotificationsSubtab.tsx pattern (controlled form + supabase-backed
 * prefs + useToast).
 */
import { Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { validateHandle } from '@/lib/gamification/handle-validate';
import {
  LeaderboardApiError,
  setLeaderboardOptin,
  suggestLeaderboardHandle,
} from '@/lib/gamification/leaderboard';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

interface CohortEntry {
  id: string;
  name: string;
  hasOptedIn: boolean;
  currentHandle: string | null;
}

export function LeaderboardsSubtab() {
  const userId = useStore((s) => s.signedIn?.user?.id ?? null);
  const toast = useToast();
  const [cohorts, setCohorts] = useState<CohortEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingFor, setSubmittingFor] = useState<string | null>(null);
  const [handleDraft, setHandleDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      // Fetch leaderboard-enabled cohorts the user belongs to + their opt-in state.
      // The INNER JOIN on cohort_membership ensures we only see cohorts the user is a member of.
      const { data: rows } = await supabase
        .from('cohort_definitions')
        .select(
          'id, name, leaderboard_enabled, cohort_membership!inner(user_id), leaderboard_optin(user_id, handle, active)',
        )
        .eq('leaderboard_enabled', true)
        .eq('cohort_membership.user_id', userId);

      if (cancelled) return;

      const entries: CohortEntry[] = (rows ?? []).map((r) => {
        const optin = (
          r.leaderboard_optin as
            | Array<{ user_id: string; handle: string; active: boolean }>
            | undefined
        )?.find((o) => o.user_id === userId);
        return {
          id: r.id as string,
          name: r.name as string,
          hasOptedIn: optin?.active ?? false,
          currentHandle: optin?.handle ?? null,
        };
      });

      setCohorts(entries);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const onSuggest = async (cohortId: string): Promise<void> => {
    try {
      const suggested = await suggestLeaderboardHandle();
      setHandleDraft((prev) => ({ ...prev, [cohortId]: suggested }));
    } catch {
      toast('Could not suggest handle — try entering manually', 'error');
    }
  };

  const onToggle = async (cohort: CohortEntry, optIn: boolean): Promise<void> => {
    setSubmittingFor(cohort.id);
    try {
      const handle = optIn ? (handleDraft[cohort.id] ?? cohort.currentHandle ?? '') : '';
      if (optIn) {
        const v = validateHandle(handle);
        if (!v.ok) {
          toast(v.message, 'error');
          return;
        }
      }
      // Opt-out: pass null handle + active=false. Preserves the row for re-opt-in (D-15).
      await setLeaderboardOptin(cohort.id, optIn ? handle : null, optIn);
      toast(
        optIn
          ? `Joined ${cohort.name} leaderboard`
          : `Left ${cohort.name} leaderboard — changes may take up to 15 minutes to sync`,
        'success',
      );
      setCohorts((prev) =>
        prev.map((c) =>
          c.id === cohort.id
            ? { ...c, hasOptedIn: optIn, currentHandle: optIn ? handle : c.currentHandle }
            : c,
        ),
      );
    } catch (e) {
      if (e instanceof LeaderboardApiError) {
        toast(`Could not update: ${e.code}`, 'error');
      } else {
        toast('Could not update leaderboard settings', 'error');
      }
    } finally {
      setSubmittingFor(null);
    }
  };

  if (loading) {
    return <div className="text-[13px] text-[var(--color-text-secondary)]">Loading…</div>;
  }

  if (!userId) {
    return (
      <Card variant="flat">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Sign in to manage leaderboard preferences.
        </p>
      </Card>
    );
  }

  if (cohorts.length === 0) {
    return (
      <Card variant="elevated">
        <CardHeader title="Leaderboards" icon={<Trophy className="size-4" aria-hidden />} />
        <p className="text-sm text-[var(--color-text-secondary)]">
          No leaderboards are available for your cohorts yet. Admins enable leaderboards for
          specific cohorts; this page will populate when you&apos;re eligible.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {cohorts.map((cohort) => {
        const draft = handleDraft[cohort.id] ?? cohort.currentHandle ?? '';
        const v = draft ? validateHandle(draft) : null;
        const busy = submittingFor === cohort.id;

        return (
          <Card key={cohort.id} variant="elevated">
            <CardHeader title={cohort.name} icon={<Trophy className="size-4" aria-hidden />} />
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cohort.hasOptedIn}
                  disabled={busy}
                  onChange={(e) => void onToggle(cohort, e.target.checked)}
                  aria-label={`Join ${cohort.name} leaderboard`}
                  className="rounded"
                />
                <span className="text-[13px]">Show me on this leaderboard</span>
              </label>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Your handle is shown in place of your name. We never display your real name on
                leaderboards.
              </p>

              {/* Handle picker — shown when opted in or when handle is being edited */}
              {(cohort.hasOptedIn || draft) && (
                <div className="space-y-1">
                  <label htmlFor={`handle-${cohort.id}`} className="text-[13px] font-medium">
                    Handle
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id={`handle-${cohort.id}`}
                      aria-label={`Handle for ${cohort.name}`}
                      value={draft}
                      onChange={(e) =>
                        setHandleDraft((p) => ({ ...p, [cohort.id]: e.target.value }))
                      }
                      aria-invalid={v && !v.ok ? true : undefined}
                      placeholder={cohort.currentHandle ?? 'Pick a handle'}
                      disabled={busy}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void onSuggest(cohort.id)}
                      disabled={busy}
                      aria-label="Suggest a handle"
                    >
                      Suggest
                    </Button>
                  </div>
                  {v && !v.ok && (
                    <p className="text-[var(--color-error,#b91c1c)] text-[12px]" role="alert">
                      {v.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
