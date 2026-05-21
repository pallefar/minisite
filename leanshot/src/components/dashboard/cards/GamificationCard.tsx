/**
 * GamificationCard — parent container that lazy-mounts the 4 gamification sub-cards.
 *
 * Phase 35 Plan 35-06 — GAME-01 (level-up burst) + GAME-06 (progress rings dashboard).
 * Phase 35 Plan 35-08 — GAME-04 wires: cohortId, hasOptedIn, nudgeDismissed,
 *   onDismissNudge, onOpenLeaderboardSettings (fills the stubs from 35-06).
 *
 * Architecture:
 *   - Single useEffect batches all 3 RPC reads via fetchGamificationDashboard (Promise.all).
 *   - Level-up detection: compares new level to previously stored level; triggers LevelUpBurst.
 *   - Renders null until data is available (avoids flash of empty cards).
 *   - primaryCohort: fetches user's first leaderboard-enabled cohort (alphabetical) on mount.
 *     Used to thread cohortId + hasOptedIn into LeaderboardCard.
 *   - nudgeDismissed: sourced from Zustand leaderboardNudgeDismissed (persisted +
 *     cross-device synced to user_leaderboard_prefs via setLeaderboardNudgeDismissed).
 */
import { useEffect, useRef, useState } from 'react';
import {
  fetchGamificationDashboard,
  type GamificationDashboardData,
} from '@/lib/gamification/dashboard-data';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { LevelUpBurst } from '../burst/LevelUpBurst';
import { LeaderboardCard } from './LeaderboardCard';
import { LevelProgressCard } from './LevelProgressCard';
import { StreakCard } from './StreakCard';
import { WeeklyChallengeCard } from './WeeklyChallengeCard';

interface PrimaryCohort {
  id: string;
  hasOptedIn: boolean;
}

export function GamificationCard() {
  // Use the Supabase auth user ID (from signedIn slice), not the Zustand User profile
  const userId = useStore((s) => s.signedIn?.user?.id ?? null);
  // Phase 35 Plan 35-08: nudge dismiss state (fast-paint via localStorage; DB-backed cross-device)
  const nudgeDismissed = useStore((s) => s.leaderboardNudgeDismissed);
  const setLeaderboardNudgeDismissed = useStore((s) => s.setLeaderboardNudgeDismissed);

  const [data, setData] = useState<GamificationDashboardData | null>(null);
  const [levelUpTarget, setLevelUpTarget] = useState<number | null>(null);
  // Track prior level across renders without triggering re-render
  const priorLevelRef = useRef<number | null>(null);

  // Phase 35 Plan 35-08: primary leaderboard-enabled cohort for the nudge widget.
  // Heuristic: alphabetically first leaderboard-enabled cohort the user belongs to.
  const [primaryCohort, setPrimaryCohort] = useState<PrimaryCohort | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchGamificationDashboard(userId)
      .then((d) => {
        if (cancelled) return;
        // Level-up detection: if we had a prior level and new level is higher, trigger burst
        if (priorLevelRef.current !== null && d.level > priorLevelRef.current) {
          setLevelUpTarget(d.level);
        }
        priorLevelRef.current = d.level;
        setData(d);
      })
      .catch((e: Error) => {
        console.error('[GamificationCard] fetchGamificationDashboard failed', e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Phase 35 Plan 35-08: fetch primary leaderboard cohort + opt-in status.
  // Runs once per userId change (sign-in). Best-effort; LeaderboardCard renders
  // the nudge even with cohortId=null (shows the "join a leaderboard" CTA).
  useEffect(() => {
    if (!userId) {
      setPrimaryCohort(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data: rows } = await supabase
          .from('cohort_definitions')
          .select(
            'id, name, leaderboard_enabled, cohort_membership!inner(user_id), leaderboard_optin(user_id, active)',
          )
          .eq('leaderboard_enabled', true)
          .eq('cohort_membership.user_id', userId)
          .order('name', { ascending: true })
          .limit(1);

        if (cancelled) return;
        const first = rows?.[0];
        if (!first) return;

        const optin = (
          first.leaderboard_optin as Array<{ user_id: string; active: boolean }> | undefined
        )?.find((o) => o.user_id === userId);

        setPrimaryCohort({ id: first.id as string, hasOptedIn: optin?.active ?? false });
      } catch {
        // Best-effort — LeaderboardCard renders gracefully with cohortId=null
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!data) return null;

  return (
    <>
      <LevelProgressCard data={data} />
      <StreakCard data={data} />
      <WeeklyChallengeCard />
      {/* Phase 35 Plan 35-08: cohortId + hasOptedIn + nudgeDismissed wired from store */}
      <LeaderboardCard
        data={data}
        cohortId={primaryCohort?.id ?? null}
        hasOptedIn={primaryCohort?.hasOptedIn ?? false}
        nudgeDismissed={nudgeDismissed}
        onOpenLeaderboardSettings={() => {
          // Opens the Settings modal; the user can navigate to the Leaderboards subtab.
          // D-12: landing on the default 'account' section is acceptable;
          // the nudge CTA copy says "Open Settings → Leaderboards" to guide the user.
          // A deep-link to 'leaderboards' section could be added via a store action
          // (settingsTargetSection) but is deferred to a polish pass (planner's note).
          window.dispatchEvent(new CustomEvent('leanshot:open-settings'));
        }}
        onDismissNudge={() => {
          void setLeaderboardNudgeDismissed();
        }}
      />
      <LevelUpBurst newLevel={levelUpTarget} onDismiss={() => setLevelUpTarget(null)} />
    </>
  );
}
