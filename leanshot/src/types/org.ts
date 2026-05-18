/**
 * Phase 28 Plan 28-05 — Org context types.
 *
 * Hoisted from src/lib/org.ts to break the potential circular import:
 *   org.ts → store.ts → org.ts
 *
 * Both src/lib/store.ts AND src/lib/org.ts import from here.
 * Do NOT define org-context types anywhere else.
 */

/** The three roles available to org members (per CONTEXT D-01 — renamed in Phase 31). */
export type OrgRole = 'owner' | 'clinician' | 'staff';

/**
 * Minimal org shape used by the org-context layer (D-03).
 * Intentionally narrower than the full src/types/clinic.ts Org entity —
 * the context layer only needs id, slug, and name for routing + display.
 * Downstream consumers that need the full Org entity (Phase 9 wrappers)
 * import from src/types/clinic.ts.
 */
export interface OrgContext {
  id: string;
  slug: string;
  name: string;
}

/** Return shape of useCurrentOrg() hook (D-03). */
export interface CurrentOrgContext {
  org: OrgContext | null;
  role: OrgRole | null;
  loading: boolean;
}
