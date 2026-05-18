/**
 * Phase 27 Plan 27-02 — 15-field cohort rule-tree allowlist (CONTEXT D-06).
 *
 * Single source of truth for which profile attributes can appear as a leaf
 * `field` in a cohort rule. Adding a field requires:
 *
 *   1. Add the literal to FIELD_ALLOWLIST here.
 *   2. Add the matching `field → SQL column expression` mapping in
 *      `rule-tree-to-sql.ts` (FIELD_SQL_EXPR).
 *   3. Add the matching `field → admin_role` check in the plpgsql
 *      `cohort_validate_rule` function (defense in depth, layer #3).
 *   4. Ensure the underlying column exists on `public.cohort_profile_view`
 *      (added in migration 20260601000010_cohort_definitions.sql).
 *
 * Three layers of allowlist enforcement defends against rule-injection:
 *   - Layer 1 (UI): CohortFieldPicker only renders these 15 strings.
 *   - Layer 2 (TS): zod enum rejects unknown fields at parse time.
 *   - Layer 3 (SQL): plpgsql cohort_validate_rule re-walks the jsonb tree
 *     and rejects anything outside the hardcoded CASE list.
 *
 * Per [[feedback_planner_iter1_anti_patterns]] — three-layer defense for
 * cross-trust-boundary input shapes.
 */

export const FIELD_ALLOWLIST = [
  'tier',
  'role',
  'days_since_signup',
  'days_since_last_login',
  'total_paid_amount_cents',
  'active_streak_days',
  'has_active_subscription',
  'signup_source',
  'country',
  'language',
  'has_org',
  'has_completed_onboarding',
  'is_affiliate',
  'anomaly_flagged',
  'account_state',
] as const;

export type RuleField = (typeof FIELD_ALLOWLIST)[number];

export const FIELD_ALLOWLIST_SET: ReadonlySet<string> = new Set(FIELD_ALLOWLIST);

/** Type-classification hint used by the visual builder to pick the right input control. */
export type FieldKind = 'text' | 'enum' | 'number' | 'boolean';

export const FIELD_KIND: Record<RuleField, FieldKind> = {
  tier: 'enum',
  role: 'enum',
  days_since_signup: 'number',
  days_since_last_login: 'number',
  total_paid_amount_cents: 'number',
  active_streak_days: 'number',
  has_active_subscription: 'boolean',
  signup_source: 'enum',
  country: 'text',
  language: 'text',
  has_org: 'boolean',
  has_completed_onboarding: 'boolean',
  is_affiliate: 'boolean',
  anomaly_flagged: 'boolean',
  account_state: 'enum',
};

/** Pre-canned enum options exposed to the UI builder for each `enum` field. */
export const FIELD_ENUM_OPTIONS: Partial<Record<RuleField, readonly string[]>> = {
  tier: ['free', 'pro', 'lifetime'],
  role: ['patient', 'clinician', 'admin', 'superadmin'],
  signup_source: ['organic', 'paid_meta', 'paid_google', 'referral', 'affiliate', 'other'],
  account_state: ['active', 'banned', 'comp', 'past_due'],
};

/** Human-readable label shown in the field picker. */
export const FIELD_LABEL: Record<RuleField, string> = {
  tier: 'Tier',
  role: 'Role',
  days_since_signup: 'Days since signup',
  days_since_last_login: 'Days since last login',
  total_paid_amount_cents: 'Total paid (cents)',
  active_streak_days: 'Active streak (days)',
  has_active_subscription: 'Has active subscription',
  signup_source: 'Signup source',
  country: 'Country (ISO-2)',
  language: 'Language',
  has_org: 'Belongs to org',
  has_completed_onboarding: 'Has completed onboarding',
  is_affiliate: 'Is affiliate',
  anomaly_flagged: 'Anomaly flagged',
  account_state: 'Account state',
};
