/**
 * Phase 40 Plan 40-04 — Client-side cancellation type contract.
 * SINGLE WRITER: only 40-04 may edit this file.
 * Mirrors supabase/functions/_shared/cancellation-types.ts WITHOUT cross-import.
 * Parallel Deno-side consumers (40-03 Edge Fns) each maintain their own copy
 * per TS types one-writer rule (40-PATTERNS §"TS types one-writer rule").
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

export interface DecideOfferResponse {
  offer_id: string | null;
  offer_type: OfferType | null;
  offer_config: OfferConfig | null;
  stacking: { existing_pct: number; capped_pct: number } | null;
  ineligible_code: IneligibleCode | null;
}

export interface AcceptOfferRequest {
  offer_id: string;
  pause_months_override?: 1 | 2 | 3;
}

export interface AcceptOfferResponse {
  accepted: boolean;
  offer_type: OfferType;
}
