/**
 * Phase 22 Plan 22-09 — ImpersonationBanner (ADMIN-03).
 *
 * Sticky 48px red banner mounted at AppShell root when read-only impersonation
 * is active. UI contract per 22-UI-SPEC.md §284-297 + §552-560:
 *
 *   - sticky top-0 z-[60] bg-[var(--color-danger)] text-white h-12
 *   - "Impersonating {email} · Read-only · {N}m {S}s remaining"
 *   - End-impersonation CTA (inverse-styled pill)
 *   - role="alert" aria-live="assertive" (announced on mount)
 *   - countdown span aria-live="off" (don't announce every tick)
 *   - pulse animation in last 60s; suppressed when prefers-reduced-motion
 *   - auto-fires endImpersonation when countdown hits 0 + shows toast
 *
 * AppShell wiring is owned by plan 22-12 (Wave 3 sweep).
 */

import { UserCog } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useImpersonation } from '@/components/impersonation/useImpersonation';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useToast } from '@/hooks/useToast';

export function ImpersonationBanner() {
  const { active, targetEmail, secondsRemaining, endImpersonation } = useImpersonation();
  const reducedMotion = useReducedMotion();
  const showToast = useToast();

  // Auto-expire: when impersonation went from > 0 to 0, fire endImpersonation
  // once + surface the toast. Track via ref so we don't re-fire across
  // re-renders within the same expiration cycle.
  const prevSecondsRef = useRef<number | null>(null);
  const autoEndFiredRef = useRef(false);
  useEffect(() => {
    if (!active && prevSecondsRef.current === null) {
      // Initial inactive state — nothing to track.
      return;
    }
    if (active) {
      // Reset the fired flag when impersonation is freshly active.
      if (prevSecondsRef.current === null) {
        autoEndFiredRef.current = false;
      }
      if (
        secondsRemaining === 0 &&
        prevSecondsRef.current !== null &&
        prevSecondsRef.current > 0 &&
        !autoEndFiredRef.current
      ) {
        autoEndFiredRef.current = true;
        void endImpersonation();
        showToast('Impersonation session expired.', 'info');
      }
      prevSecondsRef.current = secondsRemaining;
    } else {
      prevSecondsRef.current = null;
      autoEndFiredRef.current = false;
    }
  }, [active, secondsRemaining, endImpersonation, showToast]);

  if (!active) return null;

  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;
  const countdownText = `${mins}m ${secs}s`;
  const shouldPulse = secondsRemaining < 60 && !reducedMotion;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-[60] flex h-12 items-center justify-between gap-3 bg-[var(--color-danger)] px-4 text-white"
    >
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <UserCog
          data-testid="impersonation-icon"
          aria-hidden
          className="size-4 shrink-0"
        />
        <span className="truncate">
          Impersonating <span className="font-semibold">{targetEmail ?? 'user'}</span> · Read-only
          ·{' '}
          <span
            data-testid="impersonation-countdown"
            aria-live="off"
            className={shouldPulse ? 'animate-pulse font-mono tabular-nums' : 'font-mono tabular-nums'}
          >
            {countdownText}
          </span>{' '}
          remaining
        </span>
      </div>
      <button
        type="button"
        onClick={() => {
          void endImpersonation();
        }}
        className="h-8 shrink-0 rounded-pill bg-white px-3 text-sm font-semibold text-[var(--color-danger)] hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        End impersonation
      </button>
    </div>
  );
}

export default ImpersonationBanner;
