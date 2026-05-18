/**
 * Phase 26 Plan 01 — Affiliate tier type system.
 *
 * Shared TS types for downstream Phase 26 plans (26-02..07) consuming the
 * jsonb shapes written by triggers, webhook handlers, and admin RPCs.
 *
 * The AdjustmentEntry type is the canonical shape for the
 * public.payouts.adjustments jsonb array (D-06, migration
 * 20270701000007_payouts_adjustments_column.sql). The Postgres CHECK
 * constraint enforces array typing; this type enforces per-entry shape on
 * every client/Edge-Fn write path (Plan 26-07 charge-refunded + dispute
 * handlers).
 *
 * The FraudSignalPayload union mirrors the shape written into
 * public.affiliate_fraud_signals.payload jsonb (D-18, migration
 * 20270701000006). The discriminated union via `kind` lets downstream
 * consumers (Plan 26-04 operator UI) safely narrow per signal type.
 */

import type { AffiliateTier } from './tier-config';

// ---------------------------------------------------------------------------
// public.payouts.adjustments — entry shape (D-06)
// ---------------------------------------------------------------------------

export interface AdjustmentEntry {
  /** Discriminator — drives downstream UI labelling + accounting category. */
  type: 'refund' | 'chargeback' | 'manual';
  /** Cents amount applied to the payout. Negative for claw-back. */
  amount_cents: number;
  /** Free-text reason — operator-readable label. */
  reason: string;
  /** Stripe event.id that triggered the entry (idempotency anchor). */
  related_event_id: string;
  /** Optional link back to the affiliate_conversions row being clawed back. */
  related_conversion_id?: string;
  /** ISO-8601 timestamp the entry was appended. */
  created_at: string;
}

// ---------------------------------------------------------------------------
// public.affiliate_fraud_signals.payload — discriminated union (D-18)
// ---------------------------------------------------------------------------

export interface FraudSignalAnomalyPayload {
  kind: 'anomaly_z_score';
  z_score: number;
  baseline_mean: number;
  baseline_stddev: number;
  observation: number;
}

export interface FraudSignalChargebackPayload {
  kind: 'chargeback';
  stripe_charge_id: string;
  stripe_event_id: string;
  amount_cents: number;
}

export interface FraudSignalManualPayload {
  kind: 'manual';
  reporter_user_id: string;
  note: string;
}

export type FraudSignalPayload =
  | FraudSignalAnomalyPayload
  | FraudSignalChargebackPayload
  | FraudSignalManualPayload;

// ---------------------------------------------------------------------------
// Partner dashboard shapes (consumed by PartnerTierProgress + PartnerTierEarningsBreakdown — Plan 26-03)
// ---------------------------------------------------------------------------

export interface TierProgress {
  currentTier: AffiliateTier;
  paidConversionCount: number;
  /** 10 for standard→gold; null for gold (volume threshold deprecated) and lifetime (cannot promote further). */
  nextTierThreshold: number | null;
  frozenAt: string | null;
  freezeReason: string | null;
}

export interface TierEarningsBreakdown {
  asStandardCents: number;
  asGoldCents: number;
  asLifetimeCents: number;
  totalCents: number;
}
