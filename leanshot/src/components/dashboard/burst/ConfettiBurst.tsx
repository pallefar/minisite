/**
 * ConfettiBurst — pure side-effect component.
 *
 * Phase 35 Plan 35-06 — GAME-01 (level-up climax) + GAME-06 (reduced-motion a11y).
 *
 * Defense-in-depth:
 *   #1 (React-level gate): useReducedMotion() — primary guard. If reduced, nothing fires.
 *   #2 (library-level gate): canvas-confetti disableForReducedMotion: true — inside gamification-defer.ts.
 *
 * Renders null (pure side-effect). Caller controls trigger prop to fire the burst.
 */
import { useEffect } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { fireLevelUpBurst, fireChallengeCompleteBurst } from '@/lib/gamification-defer';

export interface ConfettiBurstProps {
  trigger: 'level-up' | 'challenge-complete' | null;
  level?: number;
  rewardKind?: 'xp' | 'badge' | 'freeze' | 'combo';
}

export function ConfettiBurst({ trigger, level, rewardKind }: ConfettiBurstProps): null {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return; // defense-in-depth #1: React-level gate (T-35-06-02)
    if (!trigger) return;
    if (trigger === 'level-up') {
      fireLevelUpBurst(level ?? 1);
    } else {
      fireChallengeCompleteBurst(rewardKind ?? 'xp');
    }
  }, [reduced, trigger, level, rewardKind]);

  return null;
}
