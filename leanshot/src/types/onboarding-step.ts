/**
 * Onboarding step type definitions for the per-clinic onboarding builder (Phase 31 Plan 04).
 *
 * Paired with SQL validator `public._validate_onboarding_steps` per
 * [[feedback_planner_iter1_anti_patterns]] #4.
 * Update BOTH sides when StepType changes (D-09 matrix).
 *
 * Consumers:
 *   - Plan 31-05: OnboardingTab editor (org-admin side)
 *   - Plan 31-06: OnboardingFlow render branch (patient side)
 */

// ---------------------------------------------------------------------------
// Step type registry (D-09 curated step library — 8 types)
// ---------------------------------------------------------------------------

/**
 * Canonical ordered tuple of all 8 step types.
 * Used to derive StepType union + as a runtime lookup table.
 * Must match the 8-value set in `public._validate_onboarding_steps`.
 */
export const STEP_TYPES = [
  'welcome',
  'intro_card',
  'medication',
  'goals',
  'body_stats',
  'consent',
  'doctor_invite',
  'tour',
] as const;

/** Union of all valid step type strings (derived from STEP_TYPES tuple). */
export type StepType = (typeof STEP_TYPES)[number];

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
 * Editable content overlay for welcome and intro_card steps.
 * Only valid when `OnboardingStepNode.type` is in EDITABLE_STEP_TYPES.
 */
export interface OnboardingStepCustom {
  title?: string;
  body?: string;
  image_url?: string;
}

/**
 * A single step in a clinic's onboarding flow.
 *
 * DB-side validator `_validate_onboarding_steps` enforces:
 *   - `type` must be in STEP_TYPES (UNKNOWN_STEP_TYPE)
 *   - `medication` and `consent` must be present (MISSING_MANDATORY_STEP)
 *   - `custom` only allowed on EDITABLE_STEP_TYPES (INVALID_CUSTOM_ON_LOCKED_STEP)
 */
export interface OnboardingStepNode {
  /** Stable uuid per step instance — stable across edits/reorders. */
  id: string;
  type: StepType;
  /** When true, patient may skip this step (only settable on non-mandatory types). */
  skip?: boolean;
  /** Clinic-editable content overlay — only valid on EDITABLE_STEP_TYPES. */
  custom?: OnboardingStepCustom;
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
