/**
 * Phase 42 Plan 42-10 (POLISH-12 D-21/D-23) — Quarterly NPS in-app eligibility.
 *
 * Thin client wrapper around the SECURITY DEFINER RPC
 * `public.is_user_eligible_for_quarterly_nps()` (see migration
 * 20270704000024). The DB function is the authoritative gate; this module
 * exists to surface a typed result and a single failure mode (eligible=false)
 * to the App.tsx wiring.
 *
 * Returns: { eligible, nonce, quarter }
 *   - eligible: boolean — whether the in-app modal should fire NOW for this
 *     user/quarter combination (per D-21 30-day email window + D-23 90-day
 *     activity gate + per-quarter single-use guard).
 *   - nonce: string | null — when eligible=true, the single-use ledger key
 *     that the in-app modal POSTs back to `nps-quarterly-respond`. Sharing
 *     the same nonce as the email path keeps Pitfall 11 (token replay)
 *     mitigation universal.
 *   - quarter: string | null — current quarter in YYYY-QN form, e.g.
 *     '2026-Q3'. Echoed back on submit for server-side consistency check.
 *
 * Fail-soft: any RPC error → eligible=false. We never block app load on
 * eligibility check failure (in-app NPS is an optional surface; the email
 * path is the primary instrument per D-21).
 */
import { supabase } from '@/lib/supabase';

export interface QuarterlyNPSEligibility {
  eligible: boolean;
  nonce: string | null;
  quarter: string | null;
}

const FALLBACK_INELIGIBLE: QuarterlyNPSEligibility = {
  eligible: false,
  nonce: null,
  quarter: null,
};

/**
 * Resolve the calling user's quarterly-NPS in-app eligibility.
 *
 * Returns { eligible: false } on any error (RPC failure, network outage,
 * placeholder Supabase URL during build). The in-app fallback is intentionally
 * pessimistic — Pitfall 11 (forwarded email tokens) means we'd rather miss a
 * legitimate in-app fire than over-fire and confuse the cron-targeted user.
 */
export async function isUserEligibleForQuarterlyNPS(): Promise<QuarterlyNPSEligibility> {
  try {
    const { data, error } = await supabase.rpc('is_user_eligible_for_quarterly_nps');
    if (error) return FALLBACK_INELIGIBLE;
    if (data == null || typeof data !== 'object') return FALLBACK_INELIGIBLE;
    const row = data as { eligible?: unknown; nonce?: unknown; quarter?: unknown };
    return {
      eligible: row.eligible === true,
      nonce: typeof row.nonce === 'string' ? row.nonce : null,
      quarter: typeof row.quarter === 'string' ? row.quarter : null,
    };
  } catch {
    return FALLBACK_INELIGIBLE;
  }
}
