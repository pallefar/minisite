/**
 * Phase 9 Plan 09-05 — minimal parallel-execution stub.
 *
 * Plan 09-02 owns the real implementation of this file (typed RPC wrappers
 * for the 16 SECURITY DEFINER RPCs from Plan 09-01). Plans 09-02..09-05 run
 * in parallel in Wave 2 — each in its own worktree branch — so this file
 * does NOT exist on 09-05's branch unless we add a stub.
 *
 * Without a stub here, Vite's import-analysis pass fails at test-load time
 * for `EditConsentScopeModal.tsx` + `ActiveOrganizationsSection.tsx`, both
 * of which depend on `updateConsentScope` and `revokeMembership`.
 *
 * Conflict resolution at merge time: this stub will conflict with Plan
 * 09-02's commit of the same path. The orchestrator's merge resolver
 * favors the real implementation (Plan 09-02's). The contract here mirrors
 * Plan 09-02's `<interfaces>` block exactly so the conflict resolves
 * structurally, not semantically.
 *
 * See `.planning/phases/09-clinic-b2b-foundations/09-02-PLAN.md` lines
 * 125-132 for the canonical interface declaration.
 */

import type { ConsentScope } from '@/types/clinic';

export type ClinicResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function updateConsentScope(_p: {
  membership_id: string;
  consent_scope: ConsentScope;
}): Promise<ClinicResult<null>> {
  // Stub — Plan 09-02 ships the real `supabase.rpc('update_consent_scope', ...)` call.
  return { ok: false, error: 'not_implemented_until_09_02' };
}

export async function revokeMembership(_p: {
  membership_id: string;
}): Promise<ClinicResult<null>> {
  // Stub — Plan 09-02 ships the real `supabase.rpc('revoke_membership', ...)` call.
  return { ok: false, error: 'not_implemented_until_09_02' };
}
