/**
 * Streak calculations — port of v1 getStreaks (leanshot.html:1847).
 * Walks backward from today; counts consecutive days where each
 * predicate is satisfied. Today may be empty without breaking streak.
 */
import { useMemo } from 'react';
import { SUPPS_DEFAULT } from '@/lib/constants';
import { useStore } from '@/lib/store';

export interface Streaks {
  weight: number;
  protein: number;
  supps: number;
  movement: number;
}

/**
 * Pure streak calculator: counts how many consecutive days (working backward
 * from `today`) the predicate returns true for. Today's miss is allowed but
 * a miss on any prior day breaks the streak.
 */
export function calcStreak(
  predicate: (ds: string) => boolean,
  today: Date = new Date(),
): number {
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    if (predicate(ds)) streak++;
    else if (i === 0) continue;
    else break;
  }
  return streak;
}

export function useStreaks(): Streaks {
  const weights = useStore((s) => s.weights);
  const meals = useStore((s) => s.meals);
  const supplements = useStore((s) => s.supplements);
  const workouts = useStore((s) => s.workouts);
  const steps = useStore((s) => s.steps);
  const proteinTarget = useStore((s) => s.user?.proteinTarget ?? 130);

  return useMemo(
    () => ({
      weight: calcStreak((ds) => weights.some((w) => w.date === ds)),
      protein: calcStreak((ds) => {
        const day = meals.filter((m) => m.date === ds);
        const total = day.reduce((acc, m) => acc + (m.protein || 0), 0);
        return total >= proteinTarget;
      }),
      supps: calcStreak((ds) => {
        const day = supplements[ds];
        if (!day) return false;
        return Object.values(day).filter(Boolean).length >= Math.ceil(SUPPS_DEFAULT.length * 0.6);
      }),
      movement: calcStreak((ds) => workouts.some((w) => w.date === ds) || (steps[ds] ?? 0) >= 7000),
    }),
    [weights, meals, supplements, workouts, steps, proteinTarget],
  );
}
