/**
 * Onboarding step type definitions.
 *
 * Phase 31 Plan 04 — per-clinic ORG onboarding builder (8 org step types).
 * Phase 34 Plan 08 — CONSUMER onboarding builder (8 D-16 consumer step types).
 *
 * Both phases share this module so there is ONE canonical OnboardingStepNode
 * type used by every consumer (per Plan 34-08 must_have: single source of truth).
 *
 * Paired with SQL validator `public._validate_onboarding_steps` per
 * [[feedback_planner_iter1_anti_patterns]] #4. Phase 34 migration
 * `20270706000002_p34_onboarding_flows_consumer.sql` widens the validator's
 * allowlist to accept BOTH org + consumer step types.
 *
 * Update BOTH sides when StepType changes.
 *
 * Consumers:
 *   - Plan 31-05: OnboardingTab editor (org-admin side; uses org step types)
 *   - Plan 31-06: OnboardingFlow render branch (patient side; org step types)
 *   - Plan 34-06: useConsumerOnboardingFlow / consumer renderer (consumer step types)
 *   - Plan 34-08: OnboardingBuilderModule (consumer admin builder; consumer step types)
 */

// ---------------------------------------------------------------------------
// Step type registries
// ---------------------------------------------------------------------------

/**
 * Phase 31 ORG step type tuple (8 curated org-flow step types per D-09).
 * Driven by per-clinic onboarding tab. NOT used by Phase 34 consumer builder.
 */
export const ORG_STEP_TYPES = [
  'welcome',
  'intro_card',
  'medication',
  'goals',
  'body_stats',
  'consent',
  'doctor_invite',
  'tour',
] as const;

/**
 * Phase 34 CONSUMER step type tuple (8 D-16 consumer-flow step types).
 * Driven by the Onboarding Builder admin module (Plan 34-08).
 * Order: matches D-16 + StepPalette chip order.
 */
export const CONSUMER_STEP_TYPES = [
  'text',
  'single-select',
  'multi-select',
  'scale',
  'weight',
  'date',
  'nps',
  'custom-component',
] as const;

/**
 * Legacy alias for Phase 31 callers (Plan 31-05 OnboardingTab + tests).
 * Stays narrow (org types only) so existing `Record<StepType, ...>` lookups
 * in Phase 31 OnboardingTab continue to type-check after Phase 34 widening.
 */
export const STEP_TYPES = ORG_STEP_TYPES;

/** Union of Phase 31 org step type strings (narrow — used by OnboardingTab). */
export type StepType = (typeof ORG_STEP_TYPES)[number];

/** Alias re-export — clearer at the call site for Phase 31 consumers. */
export type OrgStepType = StepType;

/** Union of Phase 34 consumer step type strings. */
export type ConsumerStepType = (typeof CONSUMER_STEP_TYPES)[number];

/**
 * Full union of all valid step type strings (org + consumer).
 * Matches the merged allowlist in `public._validate_onboarding_steps`
 * (`supabase/migrations/20270706000002_p34_onboarding_flows_consumer.sql`).
 * Use this only when a value can legitimately carry EITHER phase's step types
 * (e.g. a shared validator). Per-phase consumers should use the narrower
 * `StepType` / `OrgStepType` / `ConsumerStepType` aliases.
 */
export type AnyStepType = OrgStepType | ConsumerStepType;

/**
 * Human-readable labels for the Phase 34 consumer step types.
 * Drives the StepPalette chip labels (Plan 34-08).
 */
export const CONSUMER_STEP_TYPE_LABELS: Record<ConsumerStepType, string> = {
  'text': 'Text input',
  'single-select': 'Single select',
  'multi-select': 'Multi-select',
  'scale': 'Scale',
  'weight': 'Weight',
  'date': 'Date',
  'nps': 'NPS',
  'custom-component': 'Custom component',
};

/**
 * Steps that accept a `custom` field (clinic-editable content).
 * Per D-09: welcome (title/body) + intro_card (title/body/image_url).
 */
export const EDITABLE_STEP_TYPES = ['welcome', 'intro_card'] as const;

/**
 * Steps that are mandatory (non-skippable, non-removable).
 * Per D-09: medication + consent.
 * `_validate_onboarding_steps` raises MISSING_MANDATORY_STEP if either is absent.
 */
export const MANDATORY_STEP_TYPES = ['medication', 'consent'] as const;

// ---------------------------------------------------------------------------
// Shape interfaces
// ---------------------------------------------------------------------------

/**
 * Editable content overlay for welcome and intro_card steps (Phase 31 ORG).
 * Only valid when `OnboardingStepNode.type` is in EDITABLE_STEP_TYPES.
 */
export interface OnboardingStepCustom {
  title?: string;
  body?: string;
  image_url?: string;
}

// ---------------------------------------------------------------------------
// Phase 34 (consumer) D-16 shape interfaces
// ---------------------------------------------------------------------------

/**
 * Consumer step copy block — title / subtitle / helper.
 * Only present on consumer step types (Phase 34).
 */
export interface OnboardingStepCopy {
  title?: string;
  subtitle?: string;
  helper?: string;
}

/**
 * Consumer step field metadata — controls the data key / required flag /
 * optional default value for non-custom-component step types.
 */
export interface OnboardingStepField {
  key: string;
  required?: boolean;
  default?: unknown;
}

/** Option row for single-select / multi-select step types. */
export interface OnboardingStepOption {
  value: string;
  label: string;
}

/** Validation constraints (numeric ranges + optional regex). */
export interface OnboardingStepValidation {
  min?: number;
  max?: number;
  pattern?: string;
}

/** Branching rule — jumps to another step id when the answer matches. */
export interface OnboardingStepBranchingRule {
  when: { value: string };
  goto_step_id: string;
}

/**
 * A single step in a Phase 31 ORG onboarding flow.
 *
 * Narrow phase-specific type: keeps `type` narrowed to the org allowlist so
 * existing `Record<StepType, ...>` lookups in Phase 31 OnboardingTab stay
 * exhaustive. The Phase 34 fields (`copy`, `field`, etc.) are present here
 * too so the underlying jsonb shape is identical at the DB layer, but
 * `OnboardingTab` only authors `custom`/`skip`.
 *
 * DB-side validator `_validate_onboarding_steps` enforces:
 *   - `type` must be in the merged allowlist (UNKNOWN_STEP_TYPE).
 */
export interface OnboardingStepNode {
  /** Stable uuid per step instance — stable across edits/reorders. */
  id: string;
  type: StepType;
  /** Phase 31 ORG: when true, patient may skip this step. */
  skip?: boolean;
  /** Phase 31 ORG: clinic-editable content overlay (welcome / intro_card only). */
  custom?: OnboardingStepCustom;
  /** Phase 34 CONSUMER (also tolerated on org nodes): copy. */
  copy?: OnboardingStepCopy;
  /** Phase 34 CONSUMER (also tolerated on org nodes): field metadata. */
  field?: OnboardingStepField;
  /** Phase 34 CONSUMER (also tolerated on org nodes): options. */
  options?: OnboardingStepOption[];
  /** Phase 34 CONSUMER (also tolerated on org nodes): validation. */
  validation?: OnboardingStepValidation;
  /** Phase 34 CONSUMER (also tolerated on org nodes): branching rules. */
  branching?: OnboardingStepBranchingRule[];
}

/**
 * Phase 34 CONSUMER step node — same structural shape as OnboardingStepNode
 * but `type` is narrowed to the 8 D-16 consumer step types. The Phase 34
 * admin builder (Plan 34-08) authors these; the Phase 34 consumer renderer
 * (Plan 34-06) reads them.
 *
 * Structurally assignable to OnboardingStepNode at the jsonb layer (same
 * keys); the type-level distinction prevents Phase 31 lookup tables from
 * receiving consumer step types.
 */
export interface ConsumerOnboardingStepNode {
  /** Stable uuid per step instance — stable across edits/reorders. */
  id: string;
  type: ConsumerStepType;
  copy?: OnboardingStepCopy;
  field?: OnboardingStepField;
  options?: OnboardingStepOption[];
  validation?: OnboardingStepValidation;
  branching?: OnboardingStepBranchingRule[];
}

/**
 * Full onboarding flow record (mirrors `public.org_onboarding_flows` row + version metadata).
 * Consumed by the OnboardingTab editor and the patient-side OnboardingFlow render branch.
 */
export interface OnboardingFlow {
  id: string;
  org_id: string;
  steps: OnboardingStepNode[];
  version: number;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
}
