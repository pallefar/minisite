/**
 * GamificationCard — parent container that lazy-mounts the 4 gamification sub-cards.
 *
 * Phase 35 Plan 35-06 — GAME-01 (level-up burst) + GAME-06 (progress rings dashboard).
 *
 * Architecture:
 *   - Single useEffect batches all 3 RPC reads via fetchGamificationDashboard (Promise.all).
 *   - Level-up detection: compares new level to previously stored level; triggers LevelUpBurst.
 *   - Renders null until data is available (avoids flash of empty cards).
 *
 * Stubbed props (Plan 35-08 wires these):
 *   - cohortId: always null (Plan 35-08 threads user's primary leaderboard-enabled cohort)
 *   - hasOptedIn: always false (Plan 35-08 wires the store toggle)
 *   - nudgeDismissed: always false (Plan 35-08 wires the persisted preference)
 */
import { useEffect, useRef, useState } from 'react';
import {
  fetchGamificationDashboard,
  type GamificationDashboardData,
} from '@/lib/gamification/dashboard-data';
import { useStore } from '@/lib/store';
import { LevelUpBurst } from '../burst/LevelUpBurst';
import { LeaderboardCard } from './LeaderboardCard';
import { LevelProgressCard } from './LevelProgressCard';
import { StreakCard } from './StreakCard';
import { WeeklyChallengeCard } from './WeeklyChallengeCard';

export function GamificationCard() {
  // Use the Supabase auth user ID (from signedIn slice), not the Zustand User profile
  const userId = useStore((s) => s.signedIn?.user?.id ?? null);
  const [data, setData] = useState<GamificationDashboardData | null>(null);
  const [levelUpTarget, setLevelUpTarget] = useState<number | null>(null);
  // Track prior level across renders without triggering re-render
  const priorLevelRef = useRef<number | null>(null);

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

  if (!data) return null;

  return (
    <>
      <LevelProgressCard data={data} />
      <StreakCard data={data} />
      <WeeklyChallengeCard />
      {/* LeaderboardCard props stubbed — Plan 35-08 wires cohortId + hasOptedIn + nudgeDismissed */}
      <LeaderboardCard
        data={data}
        cohortId={null}
        hasOptedIn={false}
        nudgeDismissed={false}
        onOpenLeaderboardSettings={() => {}}
        onDismissNudge={() => {}}
      />
      <LevelUpBurst newLevel={levelUpTarget} onDismiss={() => setLevelUpTarget(null)} />
    </>
  );
}
