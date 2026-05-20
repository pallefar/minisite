/**
 * Phase 34 Plan 34-06 (ONBOARD-12) — LiveSignupCounter.
 *
 * Polls `public.get_rolling_signup_count()` every 30s and shows
 * "N people joined this week" with `aria-live="polite"`.
 *
 * Open Question 2 (resolved in RESEARCH): polling — NOT Supabase Realtime.
 * Realtime would require a long-lived WebSocket on a marketing surface, which
 * is overkill for a 7-day-rolling aggregate and would inflate the index
 * bundle with realtime-js (caught by `assert-bundle-budget.sh`). 30s polling
 * is gentle on the RPC + indistinguishable from realtime at human-perceivable
 * cadence.
 *
 * Behavior:
 *   - Pauses polling when document.visibilityState === 'hidden' (saves quota
 *     for tabs that are open all day).
 *   - Resumes immediately on visibilitychange → 'visible'.
 *   - Privacy opt-out via localStorage flag `leanshot_social_proof_optout`;
 *     when set, the component renders `null`.
 *   - First-load skeleton avoids layout shift while the RPC resolves.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export const SOCIAL_PROOF_OPTOUT_KEY = 'leanshot_social_proof_optout';

function isOptedOut(): boolean {
  try {
    return localStorage.getItem(SOCIAL_PROOF_OPTOUT_KEY) === 'true';
  } catch {
    return false;
  }
}

export function LiveSignupCounter() {
  const [optedOut] = useState<boolean>(() => isOptedOut());
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (optedOut) return;
    let cancelled = false;

    async function tick(): Promise<void> {
      try {
        const { data, error } = await supabase.rpc('get_rolling_signup_count');
        if (cancelled || error) return;
        if (typeof data === 'number') setCount(data);
      } catch {
        /* silent fail — never block the surface */
      }
    }

    void tick();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void tick();
    }, 30_000);

    const handler = (): void => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', handler);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handler);
    };
  }, [optedOut]);

  if (optedOut) return null;
  if (count === null) {
    return (
      <div
        aria-hidden
        className="h-5 w-32 rounded bg-[var(--color-surface-elevated)] animate-pulse"
      />
    );
  }
  return (
    <p aria-live="polite" className="text-sm text-[var(--color-text-muted)]">
      {count.toLocaleString()} people joined this week
    </p>
  );
}

export default LiveSignupCounter;
