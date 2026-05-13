/**
 * Phase 10 Plan 10-01 — canonical SnapshotData / ReadOnlyPermissionMap /
 * RankRosterRow / BulkActionType types.
 *
 * Single source of truth consumed by every downstream Wave 2/3/4/5 plan:
 *   Plan 10-02 (rank_org_patients RPC client)
 *   Plan 10-04 (clinic-snapshot Edge Function + client)
 *   Plan 10-05 (ReadOnlyPatientView component)
 *   Plan 10-06 (RosterTable + threshold toast)
 *   Plan 10-07 (ClinicDrillInPage)
 *   Plan 10-08 (AuditTab)
 *   Plan 10-09 (PatientActivityModal)
 *   Plan 10-10 (BulkExport flows)
 *
 * Re-exports ConsentScope, DataTypeKey, PermissionKey from ./clinic — those
 * are the Phase 9 source of truth; do NOT redefine them here.
 *
 * Policy: no `s.user!` non-null assertions (project anti-pattern from
 * CLAUDE.md + memory `project_phase6_deferred_items.md`).
 */

import type { ConsentScope } from './clinic';

export type { ConsentScope, DataTypeKey, PermissionKey } from './clinic';

// =============================================================================
// SnapshotData — generalized shape for both share (Phase 8) and clinic (Phase 10)
// viewer modes. Mirrors Phase 8 SnapshotResponse; extended for clinic context.
// =============================================================================

/**
 * Unified patient snapshot returned by both the `share` Edge Function (Phase 8)
 * and the new `clinic-snapshot` Edge Function (Phase 10).
 *
 * When viewer_context === 'clinic', org_id, permission_map, and consent_scope
 * are always populated. When viewer_context === 'share', they are absent.
 */
export interface SnapshotData {
  patient_user_id: string;
  /** First-name + last-initial; falls back to "Patient" per D-20. */
  display_name: string;
  injections: Array<{ id: string; dose_mg: number; site: string; created_at: string }>;
  weights: Array<{ id: string; weight_kg: number; recorded_at: string }>;
  symptoms: Array<{ id: string; name: string; severity: number; recorded_at: string }>;
  photos: Array<{ id: string; storage_path: string; taken_at: string }>;
  doctor_report?: { generated_at: string; markdown: string };
  meals?: Array<{ id: string; name: string; calories: number; eaten_at: string }>;
  workouts?: Array<{ id: string; type: string; minutes: number; performed_at: string }>;
  supplements?: Record<string, boolean>;
  mood?: Array<{ score: number; recorded_at: string }>;
  sleep?: Array<{ hours: number; quality: number; date: string }>;
  /** Discriminates share vs clinic rendering paths in ReadOnlyPatientView. */
  viewer_context: 'share' | 'clinic';
  /** Present when viewer_context === 'clinic'. */
  org_id?: string;
  /** Present when viewer_context === 'clinic'; computed from operator's role. */
  permission_map?: ReadOnlyPermissionMap;
  /**
   * Present when viewer_context === 'clinic'.
   * Informs section absence: if consent_scope.photos=false, Photos section is
   * completely absent even if the operator has patient_photos.read permission.
   */
  consent_scope?: ConsentScope;
}

// =============================================================================
// ReadOnlyPermissionMap — operator-facing permission flags for ReadOnlyPatientView.
// Computed from the operator's role_permissions rows by the clinic-snapshot
// Edge Function (Plan 10-04).
// =============================================================================

/**
 * Flattened permission flags derived from the operator's role's permission_key set.
 * Passed as a prop to ReadOnlyPatientView when viewer_context === 'clinic'.
 *
 * canViewBreakdown is gated by `roster.read_breakdown` (D-13):
 *   Owner + Coach → true, View-only → false.
 */
export interface ReadOnlyPermissionMap {
  canViewInjections: boolean;
  canViewWeights: boolean;
  canViewSymptoms: boolean;
  canViewPhotos: boolean;
  canViewDoctorReport: boolean;
  canViewMeals: boolean;
  canViewWorkouts: boolean;
  canViewSupplements: boolean;
  canViewMood: boolean;
  canViewSleep: boolean;
  /** Gated by 'roster.read_breakdown' permission (D-13). */
  canViewBreakdown: boolean;
}

// =============================================================================
// RankRosterRow — single row returned by the rank_org_patients RPC (D-01/D-02).
// =============================================================================

/**
 * One patient entry in the ranked roster.
 *
 * Score is 0–100 (smallint). Breakdown exposes per-signal contributions for
 * the expandable tooltip (gated by canViewBreakdown per D-13).
 *
 * days_since_injection uses a 999 sentinel when last_injection_at is null
 * (patient has never recorded an injection) — the client should translate 999
 * to a "no injection recorded" display string rather than showing a number.
 */
export interface RankRosterRow {
  user_id: string;
  display_name: string;
  /** Composite "needs attention" score 0–100 (higher = needs more attention). */
  score: number;
  /** Per-signal score contributions, e.g. { missed_dose: 28, symptom_severity: 15 }. */
  breakdown: Record<string, number>;
  /** ISO timestamptz of the most recent injection; null if none ever recorded. */
  last_injection_at: string | null;
  weight_trend_arrow: 'up' | 'down' | 'flat';
  /** Highest symptom severity in the last 7 days; 0 if none logged. */
  recent_symptom_severity: number;
  /**
   * Days since the most recent injection. Uses sentinel 999 when
   * last_injection_at is null (never recorded) — display as "—" in UI.
   */
  days_since_injection: number;
  missed_dose_flag: boolean;
}

// =============================================================================
// BulkActionType — discriminated union for the 3 bulk operator actions (D-22).
// =============================================================================

/**
 * The three bulk actions operators can perform from the multi-select roster (D-22).
 *   pdf_export  — assemble per-patient sections into a single jsPDF document
 *   csv_export  — export symptoms last 30d as a single CSV file
 *   open_tabs   — open each selected patient in a new browser tab (capped at 5)
 */
export type BulkActionType = 'pdf_export' | 'csv_export' | 'open_tabs';

// =============================================================================
// ScoreBucket — PostHog-safe tier label for patient score (D-24 PHI rules).
// =============================================================================

/**
 * PHI-safe tier label for score values.
 *   low  → 0–29
 *   mid  → 30–69
 *   high → 70–100
 *
 * Used in PostHog events (clinic_patient_drilled_in, clinic_rank_breakdown_expanded)
 * per D-24 PHI rules — never log raw score values.
 */
export type ScoreBucket = 'low' | 'mid' | 'high';

/**
 * Map a raw 0–100 score to its PHI-safe bucket.
 *
 * Thresholds match D-24 + D-17 ("needs attention" toast fires at ≥ 70).
 */
export const scoreBucket = (score: number): ScoreBucket =>
  score >= 70 ? 'high' : score >= 30 ? 'mid' : 'low';
