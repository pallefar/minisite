/**
 * Phase 42 Plan 42-10 (POLISH-12 D-20/D-21) — Quarterly NPS modal trigger.
 *
 * D-20 UNCONDITIONAL: the eligibility resolver controls whether the modal shows.
 * Do NOT wrap this call in a feature-flag conditional — eslint-rules/no-conditional-native-review.cjs
 * will block. See P36 V13-3 BLOCKER + P42 D-20.
 *
 * Why a separate trigger module:
 * The modal is rendered as a Suspense boundary inside App.tsx so the bundle
 * stays off the index static graph. The trigger module exposes a tiny imperative
 * surface (showQuarterlyNpsModal) that just flips a window-scoped flag + dispatches
 * a custom event. App.tsx subscribes and renders <QuarterlyNPSModal /> lazily.
 *
 * Pattern S1 (UX layer only):
 * Server-side enforcement lives in:
 *   - is_user_eligible_for_quarterly_nps() RPC (active-90d + nonce-30d + no-response)
 *   - quarterly_nps_responses UNIQUE(user_id, quarter) constraint
 *   - quarterly_nps_nonces single-use ledger (atomic UPDATE)
 * This client trigger is a pure render-hint; bypassing the gate by force-firing
 * the modal cannot violate the per-quarter single-use guarantee.
 */

/** Custom-event name used to deliver the eligibility payload to the App-level modal host. */
export const QUARTERLY_NPS_SHOW_EVENT = 'leanshot:quarterly-nps:show';

/**
 * Payload broadcast on the QUARTERLY_NPS_SHOW_EVENT. The modal host reads this
 * once and surfaces the QuarterlyNPSModal with the supplied nonce + quarter.
 */
export interface QuarterlyNPSShowDetail {
  nonce: string;
  quarter: string;
}

/**
 * Type guard for the CustomEvent detail — exported so the App.tsx listener
 * can validate without duplicating the predicate.
 */
export function isQuarterlyNPSShowDetail(detail: unknown): detail is QuarterlyNPSShowDetail {
  if (!detail || typeof detail !== 'object') return false;
  const d = detail as { nonce?: unknown; quarter?: unknown };
  return typeof d.nonce === 'string' && typeof d.quarter === 'string';
}

/**
 * UNCONDITIONAL surface — the ONLY public call site for the modal.
 *
 * D-20 UNCONDITIONAL: callers MUST invoke this without an `if (...)` /
 * ternary / `&&`-guard wrapper. The eligibility resolver
 * (isUserEligibleForQuarterlyNPS) is the gate; this function is the
 * downstream effect once the gate has resolved true.
 *
 * Behavior: dispatches a window CustomEvent that the App-level modal host
 * subscribes to. Idempotent within a session — if the modal is already
 * mounted, the host short-circuits the second event.
 */
export function showQuarterlyNpsModal(detail: QuarterlyNPSShowDetail): void {
  // Run inside try/catch — emergency fail-soft. The NPS modal is a polish
  // surface; nothing in the dashboard depends on it firing.
  try {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent<QuarterlyNPSShowDetail>(QUARTERLY_NPS_SHOW_EVENT, { detail }),
    );
  } catch {
    /* fail-soft: SSR contexts (none in this SPA) and locked-down iframes. */
  }
}
