/**
 * Phase 40 Plan 40-05 — Cancellation admin module types.
 *
 * Shared types for CancellationModule / RuleListPanel / RuleEditor.
 * These are admin-surface types only (schema mirrors save_offer_rules table).
 * Consumer-facing OfferType + OfferConfig types owned by 40-04 (src/types/cancellation.ts).
 */

/** Matches save_offer_rules.offer_type CHECK enum */
export type OfferType = 'pause' | 'discount' | 'extended_trial' | 'downgrade' | 'contact_csm';

/** Matches save_offer_rules.org_type CHECK enum */
export type OrgType = 'any' | 'consumer' | 'clinic';

/**
 * Client-side representation of a save_offer_rules row.
 * Mirrors the DB schema from supabase/migrations/20270709000002_p40_save_offer_rules.sql.
 */
export interface SaveOfferRule {
  id: string;
  title: string;
  cohort_id: string | null;
  tenure_buckets: string[];
  reasons: string[];
  org_type: OrgType;
  offer_type: OfferType;
  pause_months: number | null;
  coupon_id: string | null;
  extension_days: number | null;
  downgrade_target: string | null;
  priority: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  /** Joined from cohort_definitions via select() */
  cohort_definitions?: { name: string; member_count: number } | null;
}

/** D-13: 6-combo coupon catalog. Hardcoded per CONTEXT D-12 + 40-01 seed. */
export const COUPON_CATALOG = [
  { id: 'SAVE-20-2MO', label: '20% off for 2 months' },
  { id: 'SAVE-20-3MO', label: '20% off for 3 months' },
  { id: 'SAVE-25-2MO', label: '25% off for 2 months' },
  { id: 'SAVE-25-3MO', label: '25% off for 3 months' },
  { id: 'SAVE-30-2MO', label: '30% off for 2 months' },
  { id: 'SAVE-30-3MO', label: '30% off for 3 months' },
] as const;

/** D-18: 7 cancellation reason codes */
export const REASON_OPTIONS = [
  { id: 'too_expensive', label: 'Too expensive' },
  { id: 'not_using', label: 'Not using it enough' },
  { id: 'found_alternative', label: 'Found an alternative' },
  { id: 'health_goals_changed', label: 'Health goals changed' },
  { id: 'temporary_break', label: 'Temporary break needed' },
  { id: 'service_quality_issue', label: 'Service quality issue' },
  { id: 'other', label: 'Other' },
] as const;

/** D-01: 3 tenure buckets */
export const TENURE_OPTIONS = [
  { id: '<30d', label: '< 30 days' },
  { id: '30-180d', label: '30–180 days' },
  { id: '>180d', label: '> 180 days' },
] as const;
