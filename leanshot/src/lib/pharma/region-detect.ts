/**
 * Phase 39 Plan 39-05 Task 1 — region-detect (D-07 client-side layer).
 *
 * D-07 (Phase 39 CONTEXT.md): WMHMDA (WA) + CTDPA (CT) region detection
 * uses two signals — Vercel edge IP-geo → cookie `lt_pharma_blocked=1`, AND
 * a self-asserted user profile field mirrored in the Zustand store as
 * `user.state_of_residence`. Profile WINS when present.
 *
 * Belt-and-suspenders posture per the "reasonable effort + best knowledge"
 * regulatory framing (feedback_regulator_vs_user_audience_pattern memory).
 *
 * SSR-safe: returns false when document is undefined (we are not currently
 * SSR'd but the helper is callable from any rendering context including
 * unit-test setup that may purposefully delete the global).
 *
 * IMPORTANT: this helper is intentionally called inline from
 * PharmaContentBlock's render — DO NOT convert to a useEffect / async
 * shape. The store read is O(1) and the cookie scan is a single regex
 * over a typically-short header value.
 */
import { useStore } from '@/lib/store';

const REGION_BLOCKED_STATES = new Set(['WA', 'CT']);

function readCookieFlag(): boolean {
  if (typeof document === 'undefined') return false;
  const cookieHeader = document.cookie || '';
  if (!cookieHeader) return false;
  // Match `lt_pharma_blocked=1` with cookie boundaries (start, `; `, or end).
  return /(^|;\s*)lt_pharma_blocked=1(\s*;|$)/.test(cookieHeader);
}

function readProfileFlag(): boolean {
  try {
    const state = useStore.getState() as { user: { state_of_residence?: string | null } | null };
    const residence = state?.user?.state_of_residence;
    if (typeof residence !== 'string' || residence.length === 0) return false;
    return REGION_BLOCKED_STATES.has(residence.trim().toUpperCase());
  } catch {
    // Store unavailable (e.g. test harness that nukes the module) — fail-open
    // for the profile signal; cookie signal is still consulted by the caller.
    return false;
  }
}

/**
 * Returns true when the current user should be served pharma content WITHOUT
 * the paywall under D-07 (WA/CT carveout).
 *
 * Resolution order (both are positive signals; either-true wins):
 *   1. Profile-asserted state of residence is WA/CT (D-07 profile-wins).
 *   2. Vercel edge cookie `lt_pharma_blocked=1`.
 *
 * Returns false when neither signal fires OR when document is undefined.
 */
export function isPharmaRegionBlocked(): boolean {
  // Profile FIRST so the "profile-wins" semantic is honoured even on edge cases
  // where the cookie might be stale (user moved states, cleared cookies, etc).
  if (readProfileFlag()) return true;
  if (readCookieFlag()) return true;
  return false;
}
