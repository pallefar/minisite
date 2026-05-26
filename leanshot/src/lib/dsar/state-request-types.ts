/**
 * Phase 64 Plan 64-06 — State-residency → allowed request type lookup (LEGAL-03).
 *
 * Pure function module; no side effects, no network calls.
 *
 * Decision matrix per D-DSAR-Portal-Extensions (64-CONTEXT.md):
 *   CA (CCPA/CPRA) → deletion / access / portability / opt_out / limit_sensitive_use
 *   VA (CDPA)      → deletion / access / portability / correction / opt_out
 *   CO (CPA)       → deletion / access / portability / correction / opt_out / opt_in_sensitive
 *   CT (CTDPA)     → same as CO
 *   UT (UCPA)      → deletion / access ONLY (narrower — no portability or correction)
 *   OTHER          → deletion / access (default base set for unrecognized state)
 *
 * Per [[feedback_planner_silent_scope_reduction_patterns]]: do NOT omit
 * `opt_in_sensitive` for CO/CT or `limit_sensitive_use` for CA — these are
 * explicit in D-DSAR-Portal-Extensions and the data_rights_requests CHECK
 * constraint accepts them.
 */

export type StateCode = 'CA' | 'VA' | 'CO' | 'CT' | 'UT' | 'OTHER';

export type RequestType =
  | 'deletion'
  | 'access'
  | 'portability'
  | 'correction'
  | 'opt_out'
  | 'limit_sensitive_use'
  | 'opt_in_sensitive';

/**
 * Lookup table mapping each state code to its allowed request types.
 * `as const` ensures the arrays are readonly at the TypeScript level.
 */
export const STATE_REQUEST_TYPES = {
  CA: ['deletion', 'access', 'portability', 'opt_out', 'limit_sensitive_use'],
  VA: ['deletion', 'access', 'portability', 'correction', 'opt_out'],
  CO: ['deletion', 'access', 'portability', 'correction', 'opt_out', 'opt_in_sensitive'],
  CT: ['deletion', 'access', 'portability', 'correction', 'opt_out', 'opt_in_sensitive'],
  UT: ['deletion', 'access'],
  OTHER: ['deletion', 'access'],
} as const satisfies { readonly [K in StateCode]: readonly RequestType[] };

/**
 * Returns the list of allowed request types for a given state residency code.
 *
 * @throws {Error} If the state code is not recognized (defensive guard for
 *   runtime callers that bypass TypeScript — e.g. deserialized form values).
 */
export function getRequestTypesForState(state: StateCode): readonly RequestType[] {
  const types = STATE_REQUEST_TYPES[state];
  if (!types) {
    throw new Error(`Unknown state: ${state}`);
  }
  return types;
}
