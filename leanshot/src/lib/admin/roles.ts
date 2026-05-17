/**
 * Phase 24 Plan 24-03 — Admin role model (D-04).
 *
 * Fixed 3-role enum: staff < admin < superadmin.
 * Stored as `profiles.admin_role` enum column (Plan 24-01).
 *
 * Mapping:
 *   staff      → Members, Helpdesk, Reviews + all lower roles
 *   admin      → adds Billing, Cohorts, Affiliates, Settings
 *   superadmin → adds AI, Audit Log, dangerous actions (impersonate, refund, reset_totp)
 */
export type AdminRole = 'staff' | 'admin' | 'superadmin';

export const ROLE_ORDER: Record<AdminRole, number> = {
  staff: 0,
  admin: 1,
  superadmin: 2,
};

/**
 * Returns true if `actual` meets or exceeds `required` in the role hierarchy.
 * Null/undefined actual always returns false (no role = no access).
 */
export function hasMinRole(
  actual: AdminRole | null | undefined,
  required: AdminRole,
): boolean {
  if (!actual) return false;
  return ROLE_ORDER[actual] >= ROLE_ORDER[required];
}
