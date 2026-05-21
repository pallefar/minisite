/**
 * Phase 40 — Deno-side type contracts for cancellation save-offers flow.
 *
 * SINGLE WRITER: 40-03 owns this file (supabase/functions/_shared/).
 * The parallel client-side type file lives at leanshot/src/types/cancellation.ts
 * and is owned by 40-04. NO cross-import between the two — Deno and Vite have
 * different path-resolution semantics.
 *
 * These types are imported by:
 *   - cancellation-decide-offer/index.ts + helpers
 *   - cancellation-accept-offer/index.ts + helpers
 *
 * Mirrors: leanshot/src/types/cancellation.ts (40-04 owned, identical shape, no import link)
 */

export type OfferType = 'pause' | 'discount' | 'extended_trial' | 'downgrade' | 'contact_csm';

export type TenureBucket = '<30d' | '30-180d' | '>180d';

export type CancellationReason =
  | 'too_expensive'
  | 'not_using'
  | 'found_alternative'
  | 'health_goals_changed'
  | 'temporary_break'
  | 'service_quality_issue'
  | 'other';

export type OfferConfig =
  | { type: 'pause'; pause_months: 1 | 2 | 3 }
  | { type: 'discount'; coupon_id: string; percent_off: number; duration_in_months: 2 | 3 }
  | { type: 'extended_trial'; extension_days: 7 | 14 | 30 }
  | { type: 'downgrade'; target: 'price_monthly' }
  | { type: 'contact_csm' };

export type IneligibleCode =
  | 'OFFER_INELIGIBLE_LIFETIME_CAP'
  | 'OFFER_INELIGIBLE_COOLDOWN'
  | 'OFFER_INELIGIBLE_NO_RULE'
  | 'NO_SUBSCRIPTION';

export interface DecideOfferRequest {
  reason: CancellationReason;
  reason_other_text?: string; // required if reason === 'other'
}

export interface DecideOfferResponse {
  offer_id: string | null; // log-row uuid; null when ineligible
  offer_type: OfferType | null;
  offer_config: OfferConfig | null;
  stacking: { existing_pct: number; capped_pct: number } | null;
  ineligible_code: IneligibleCode | null;
}

export interface AcceptOfferRequest {
  offer_id: string;
  // Pause: client passes the selected preset (overrides offer_config.pause_months if user picked a different tile)
  pause_months_override?: 1 | 2 | 3;
}

export interface AcceptOfferResponse {
  accepted: boolean;
  resumes_at?: string; // ISO when offer_type='pause'
  next_invoice_date?: string; // ISO when discount/extended_trial
  applied_coupon_id?: string; // when offer_type='discount'
}

// ─── Constants ─────────────────────────────────────────────────────────────
// D-15: stacking cap at 35% combined effective discount
export const STACKING_CAP_EFFECTIVE = 0.35;
// D-03: 12-month cooldown between non-pause save-offer takes
export const COOLDOWN_DAYS = 365;
// D-02: 2 lifetime non-pause takes per user
export const LIFETIME_CAP_NON_PAUSE = 2;
