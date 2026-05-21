/**
 * LevelUpBurst — level-up celebration overlay.
 *
 * Phase 35 Plan 35-06 — GAME-01 (visible reward climax) + GAME-06 (reduced-motion).
 *
 * Behavior:
 *   - When newLevel is non-null, renders a centered modal overlay with the new level number.
 *   - Fires ConfettiBurst (canvas-confetti via gamification-defer.ts) unless reduced-motion.
 *   - Under reduced-motion: opacity-only fade (no scale, no pulse) per must_haves.truths.
 *   - Auto-dismisses after 5 seconds.
 *   - Click-outside / Dismiss button also triggers onDismiss.
 *   - Fires server-side PostHog event via xp-event Edge Function (D-05).
 *
 * Bundle note: framer-motion is already in the vendor-motion chunk (not counted
 * against gamification-burst ceiling). canvas-confetti is lazy-loaded via
 * gamification-defer.ts (T-35-06-03).
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { fireXpEvent } from '@/lib/gamification/xp-event-client';
import { ConfettiBurst } from './ConfettiBurst';

export interface LevelUpBurstProps {
  /** null = no level-up overlay; non-null = show the overlay for this level */
  newLevel: number | null;
  onDismiss: () => void;
}

export function LevelUpBurst({ newLevel, onDismiss }: LevelUpBurstProps) {
  const reduced = useReducedMotion();
  const [confettiTrigger, setConfettiTrigger] = useState<'level-up' | null>(null);

  useEffect(() => {
    if (newLevel === null) {
      setConfettiTrigger(null);
      return;
    }
    setConfettiTrigger('level-up');
    // D-05: server-side PostHog event capture via xp-event Edge Function
    fireXpEvent('level_up', { level: newLevel });
    // Auto-dismiss after 5s
    const t = setTimeout(onDismiss, 5_000);
    return () => clearTimeout(t);
  }, [newLevel, onDismiss]);

  return (
    <>
      <ConfettiBurst trigger={confettiTrigger} level={newLevel ?? undefined} />
      <AnimatePresence>
        {newLevel !== null && (
          <motion.div
            key="level-up-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={`Level ${newLevel} unlocked`}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
            transition={{ duration: reduced ? 0.1 : 0.4, ease: 'easeOut' }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={onDismiss}
          >
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
            <div
              className="bg-[var(--color-surface)] rounded-2xl p-8 shadow-xl text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-sm text-[var(--color-text-secondary)] uppercase tracking-wide">
                Level Up
              </div>
              <div className="text-7xl font-bold text-[var(--color-primary)] mt-2">
                {newLevel}
              </div>
              <button
                type="button"
                onClick={onDismiss}
                className="mt-4 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] focus-visible:outline-none focus-visible:underline"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
