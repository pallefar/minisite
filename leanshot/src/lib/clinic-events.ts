/**
 * Phase 10 Plan 10-06 — clinic-events lib.
 *
 * Exports:
 *   - CLINIC_EVENTS: canonical PostHog event-name constants (D-24/D-25).
 *   - scoreBucket: re-exported from src/types/snapshot.ts (PHI-safe score
 *     bucketing helper — signature accepts raw score, returns ScoreBucket
 *     enum, making raw-score leakage impossible at the type level).
 *
 * PHI contract (D-24, 10-EVENTS.md):
 *   - NEVER log patient_user_id, patient_name, raw score values, or
 *     membership IDs in PostHog events.
 *   - scoreBucket() is the ONLY permitted transformation of a raw score
 *     before capturing in PostHog.
 *   - org_id is an organizational identifier, not patient PHI — OK to capture.
 */

// Re-export scoreBucket + ScoreBucket from the canonical source of truth.
// Phase 10 plans must import scoreBucket from here (not snapshot.ts directly)
// so the single file is the audit anchor for the PHI-safety contract.
export { scoreBucket, type ScoreBucket } from '@/types/snapshot';

/**
 * Canonical PostHog event name constants for Phase 10 (D-24, D-25).
 * 10 events total. Each is a string literal so TypeScript catches typos
 * at use-sites.
 */
export const CLINIC_EVENTS = {
  /** Fires on ClinicWorkspace mount. Properties: { org_id }. */
  WORKSPACE_LOADED: 'clinic_workspace_loaded',

  /** Fires after first useRankRoster result render. Properties: { org_id, patient_count, render_ms }. */
  ROSTER_LOADED: 'clinic_roster_loaded',

  /** Fires on column-header click. Properties: { column, direction }. */
  ROSTER_SORTED: 'clinic_roster_sorted',

  /** Fires on roster row click (before navigation). Properties: { org_id, score_bucket }. */
  PATIENT_DRILLED_IN: 'clinic_patient_drilled_in',

  /** Fires on section-component first mount in clinic mode. Properties: { section_name }. */
  DRILL_SECTION_EXPANDED: 'clinic_drill_section_expanded',

  /** Fires on AuditTab mount. Properties: { org_id }. */
  AUDIT_TAB_OPENED: 'clinic_audit_tab_opened',

  /** Fires after debounced filter-state apply. Properties: { filter_type, has_member_filter, has_action_filter, has_time_filter }. */
  AUDIT_FILTER_APPLIED: 'clinic_audit_filter_applied',

  /** Fires when selection count crosses 0→1 or action menu opens. Properties: { count, action_planned }. */
  BULK_SELECTED: 'clinic_bulk_selected',

  /** Fires after confirmation modal Confirm click. Properties: { action, patient_count }. */
  BULK_ACTION_EXECUTED: 'clinic_bulk_action_executed',

  /** Fires when ScoreBreakdownPopover opens. Properties: { score_bucket }. */
  RANK_BREAKDOWN_EXPANDED: 'clinic_rank_breakdown_expanded',
} as const;

export type ClinicEventName = (typeof CLINIC_EVENTS)[keyof typeof CLINIC_EVENTS];
