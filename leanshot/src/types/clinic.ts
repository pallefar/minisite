/**
 * Phase 9 Plan 09-01 — strict-shape clinic types.
 *
 * Source of truth for every clinic-surface TypeScript binding (operator
 * UI, patient Active-orgs tab, clinic-invite landing page, Edge Function
 * request/response shapes via the supabase-js types). Downstream Plans
 * 09-02..09-11 import from here; the types are intentionally STRICT
 * (Pitfall #8 jsonb drift defense — adding a key requires a migration
 * AND a coordinated TypeScript change).
 *
 * Three policies enforced here:
 *
 *   1. ConsentScope is a Record over a fixed const-tuple of 10 keys. The
 *      type system rejects partial objects and unknown keys at compile
 *      time. The runtime guard `isConsentScope` enforces the same shape
 *      at the network boundary (Edge Function ingest, supabase-js select
 *      result) so we don't trust any persisted blob blindly.
 *
 *   2. PermissionKey is a const-tuple matching the seed list in
 *      supabase/migrations/20260801000005_permissions.sql. Adding a key
 *      requires updating BOTH the migration and this tuple in lockstep.
 *
 *   3. No `s.user!` non-null assertions appear anywhere in this file
 *      (project anti-pattern from RESEARCH.md "Anti-Patterns").
 */

// =============================================================================
// Data type catalog (per D-04 — granular per-data-type consent)
// =============================================================================

export const DATA_TYPE_KEYS = [
  'injections',
  'weights',
  'photos',
  'symptoms',
  'meals',
  'workouts',
  'supplements',
  'mood',
  'sleep',
  'doctor_report',
] as const;

export type DataTypeKey = (typeof DATA_TYPE_KEYS)[number];

/**
 * Granular consent jsonb stored on memberships.consent_scope and
 * invites.requested_scope / invites.consent_scope_at_acceptance.
 *
 * Always exactly 10 boolean keys. Adding an 11th key requires:
 *   - Add to DATA_TYPE_KEYS tuple (here).
 *   - Add to DATA_TYPE_LABELS table (here).
 *   - Migrate existing rows (decide: default true = silent over-share,
 *     default false = silent under-share — Pitfall #8 ships a runtime
 *     guard so neither case silently drifts the UI).
 */
export type ConsentScope = Record<DataTypeKey, boolean>;

/**
 * UI labels and operator-facing descriptions for the consent dialog +
 * patient's "Active organizations" scope-edit modal. Sourced verbatim
 * from 09-UI-SPEC.md so a single edit propagates to both surfaces.
 */
export const DATA_TYPE_LABELS: Record<DataTypeKey, { label: string; description: string }> = {
  injections: { label: 'Injections', description: 'Doses, dates, and injection sites' },
  weights: { label: 'Weight log', description: 'Weight measurements over time' },
  photos: { label: 'Body photos', description: "Progress photos you've taken" },
  symptoms: { label: 'Symptoms', description: "Symptoms you've logged" },
  meals: { label: 'Meals', description: "Food and macros you've tracked" },
  workouts: { label: 'Workouts', description: 'Exercise and activity sessions' },
  supplements: { label: 'Supplements', description: 'Daily supplement intake' },
  mood: { label: 'Mood', description: 'Mood and energy logs' },
  sleep: { label: 'Sleep', description: 'Sleep duration and quality' },
  doctor_report: { label: 'Doctor report', description: 'Your generated doctor-report summary' },
};

/**
 * Type guard: validates that an unknown value is a strict-shape ConsentScope.
 *
 * Rejects:
 *   - non-object / null
 *   - missing keys
 *   - extra keys (Pitfall #8 jsonb drift defense)
 *   - non-boolean values
 *
 * Use at every network boundary: edge function ingest, supabase-js
 * select result, redux/zustand action input.
 */
export function isConsentScope(v: unknown): v is ConsentScope {
  if (v === null || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== DATA_TYPE_KEYS.length) return false;
  for (const k of DATA_TYPE_KEYS) {
    if (!(k in obj)) return false;
    if (typeof obj[k] !== 'boolean') return false;
  }
  // Reject extras: every key in obj must be a known DATA_TYPE_KEY.
  const allowed = new Set<string>(DATA_TYPE_KEYS);
  for (const k of keys) {
    if (!allowed.has(k)) return false;
  }
  return true;
}

// =============================================================================
// Permission catalog (per D-07)
// =============================================================================

export const PERMISSION_KEYS = [
  'org.read',
  'org.update',
  'org.delete',
  'members.invite',
  'members.revoke',
  'members.list',
  'roles.manage',
  'patient_data.read',
  'patient_photos.read',
  'audit_log.read',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export interface Permission {
  key: PermissionKey;
  description: string;
}

// =============================================================================
// Domain entities — mirror the strict shape of the Postgres rows.
// =============================================================================

export interface Org {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  website_url: string | null;
  logo_storage_path: string | null;
  created_by: string;
  created_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  org_id: string;
  role_id: string;
  consent_scope: ConsentScope;
  invited_from_invite_id: string | null;
  joined_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  last_scope_changed_at: string | null;
}

export interface Invite {
  id: string;
  email: string;
  org_id: string;
  invited_by: string;
  /** Operator-suggested defaults for the consent dialog. */
  requested_scope: ConsentScope;
  /**
   * Frozen-at-acceptance snapshot (D-18). Null until accepted.
   * Mutable consent lives on Membership.consent_scope.
   */
  consent_scope_at_acceptance: ConsentScope | null;
  expires_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  consumed_at: string | null;
  created_at: string;
}

export interface Role {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
}
