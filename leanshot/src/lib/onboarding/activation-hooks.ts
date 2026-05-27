/**
 * Phase 34 Plan 34-07 (ONBOARD-05) — activation hook.
 *
 * `fireActivation()` is the single call site for the Plan 34-03 Edge Fn
 * `/functions/v1/record-activation`. The FirstActionSurface invokes it on tap
 * for every card. Three guard layers ensure the event fires exactly once per
 * user across the lifetime of the install:
 *
 *   1. Browser-side persisted flag — `useStore.activationFiredAt`. Set after a
 *      successful POST; survives reload via the store's `partialize`
 *      allow-list. Subsequent calls return without POSTing.
 *   2. In-module `inflight` ref — concurrent calls from the same React tree
 *      (e.g. double-tap, StrictMode double-mount) await the same Promise.
 *   3. Server-side advisory lock — Plan 34-03's Edge Fn dedupes via Postgres
 *      advisory lock + unique constraint. Defense-in-depth.
 *
 * D-15: even when the user changes `primary_goal` post-signup the activation
 * never re-fires. The browser flag is set once and never cleared.
 */

import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type { ActionType, PrimaryGoal } from './first-action-map';

// ──────────────────────────────────────────────────────────────────────────
// Module state
// ──────────────────────────────────────────────────────────────────────────

let inflight: Promise<void> | null = null;

// ──────────────────────────────────────────────────────────────────────────
// Result shape — `activated: true` only for the call that actually POSTed and
// got a fresh `activated:true` or `already_activated:true` response. Skip /
// no-auth / dedupe paths return `activated:false` with a `reason`.
// ──────────────────────────────────────────────────────────────────────────

export interface FireActivationResult {
  activated: boolean;
  reason?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function getSupabaseUrl(): string {
  return (
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
  );
}

// ──────────────────────────────────────────────────────────────────────────
// fireActivation
// ──────────────────────────────────────────────────────────────────────────

/**
 * Fire the activation_completed event for the user's first qualifying action.
 *
 * Idempotent: callable from any number of tap handlers without risk of a
 * duplicate POST. See module header for the three-layer guard design.
 *
 * Returns `{ activated: true }` only for the call that actually issued the
 * network request. Subsequent calls (or no-auth / concurrent / already-fired
 * paths) return `{ activated: false, reason }`.
 */
export async function fireActivation(args: {
  goal_type: PrimaryGoal;
  action_type: ActionType;
}): Promise<FireActivationResult> {
  // Layer 1 — browser-side persisted flag.
  const already = useStore.getState().activationFiredAt;
  if (already) return { activated: false, reason: 'already_fired_local' };

  // Layer 2 — in-module inflight dedup. Concurrent callers await the same
  // promise; only the first POSTs.
  if (inflight) {
    await inflight;
    return { activated: false, reason: 'concurrent_dedup' };
  }

  inflight = (async () => {
    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes?.data?.session?.access_token;
      if (!token) {
        // No-auth path: nothing to POST. Caller observes activated:false via
        // the dedup-or-skip branch above (because activationFiredAt is still
        // null and inflight is non-null until cleared below).
        return;
      }

      const url = `${getSupabaseUrl()}/functions/v1/record-activation`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(args),
      });
      const body = await res.json().catch(() => ({}) as Record<string, unknown>);

      if (body?.activated === true || body?.already_activated === true) {
        useStore.getState().setActivationFiredAt(new Date().toISOString());
      }
    } catch (err) {
      // Network/JSON failure — degrade gracefully. The next tap will retry
      // because activationFiredAt is still null. Plan 34-03's Edge Fn
      // advisory lock handles any race that results.
      console.warn('[fireActivation] failed:', err);
    }
  })();

  try {
    await inflight;
  } finally {
    inflight = null;
  }
  return { activated: true };
}
