/**
 * Phase 39 Plan 39-04 — Shared ScreenProps contract for the 6 child
 * presentational screens in OnboardingFlowPaywall.
 *
 * All 6 Screen components consume the SAME prop shape (admin-edited copy
 * arrives via the `config` payload from variant-resolver per UI-SPEC).
 */

export interface ScreenProps {
  /** variant_config.config payload returned by variant-resolver Edge Fn. */
  config: Record<string, unknown>;
  onNext: () => void;
  /** Undefined on Screen 1 (no prior step to go back to). */
  onBack?: () => void;
  onDismiss: () => void;
  /** "Step N of 6" — sr-only accessibility label. */
  stepLabel: string;
}
