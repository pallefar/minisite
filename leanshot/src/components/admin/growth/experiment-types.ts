/**
 * Phase 39 Plan 39-06 — Shared inline-types for the Experiments admin
 * surface (Surface E + H per 39-UI-SPEC).
 *
 * Owned by 39-06 (shell + manifest). Consumed by:
 *   - Plan 39-07: Paywall + Page-Builder sub-tabs (ExperimentRow rendering,
 *     Bayesian badge, Ship-Winner button).
 *   - Plan 39-08: Pharma sub-tab (PharmaExperimentRow extended fields:
 *     nps_delta, one_star_rate_ratio, safety_categories_in_variant).
 *
 * Invariants:
 *   - PharmaExperimentRow.safety_categories_in_variant MUST be an empty
 *     array at the DB layer (proof of D-05 — pharma variants never carry
 *     safety-flagged content). The UI does not enforce this; the SECDEF
 *     RPC `get_experiment_results` filters at source.
 *
 * Requirements served (via consumer plans 39-07/08):
 *   PAYWALL-06 (variant_config edited from this admin)
 *   PAGEAB-01 (admin creates page variant)
 *   PAGEAB-07 (Bayesian badge rendered in 39-07)
 *   PHARMA-08 (pharma admin tab rendered in 39-08)
 */

export type ExperimentSurface = 'paywall' | 'page' | 'pharma';

export interface ExperimentRow {
  variant_id: string;
  variant_name: string;
  surface: ExperimentSurface;
  cohort_id: string | null;
  cohort_label: string | null;
  sample_size: number;
  paid_rate: number | null;
  retention_30d_rate: number | null;
  composite_score: number | null;
  /** Posterior probability that this variant beats control. 0..1. */
  posterior: number;
  refund_rate_7d: number | null;
  refund_rate_baseline_30d: number | null;
  /** ISO timestamp when this variant was warning-flagged (e.g. refund spike). */
  warned_at: string | null;
  /** ISO timestamp when this variant was archived. */
  archived_at: string | null;
  created_at: string;
}

export interface PharmaExperimentRow extends ExperimentRow {
  nps_delta: number | null;
  one_star_rate_ratio: number | null;
  /** Invariant: MUST be empty array. Proof at the DB layer of D-05. */
  safety_categories_in_variant: string[];
}

export interface InvokeError {
  error?: string;
}
