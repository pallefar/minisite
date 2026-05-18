/**
 * Phase 25 Plan 02 — typed fire-and-forget client wrapper for `log_phi_access` RPC.
 *
 * Fire-and-forget: callers do NOT await this function. Audit logging MUST NOT block
 * UI render. A failed audit is a SEV-3 monitored separately (not a user-facing error).
 *
 * Sites to instrument per Phase 25 D-07:
 *   - Clinician patient detail page open (one row per pageview)
 *   - Photo viewer open (one per photo)
 *   - Dose-history export run (one per export)
 *   - Conversation thread open (one per open)
 *   - Roster pagination: DOES NOT call this (aggregate counts only, not PHI access)
 *
 * Sensitive-surface instrumentation is owned by future clinical-dashboard phases
 * (Phase 30+); this wrapper exists at Phase 25 so future phases have no excuse to skip.
 *
 * Security: Pattern S3 — log error.code/name only, never error.message (PII leak vector).
 *   T-25-02-03/T-25-02-04: actor_user_id is sourced from auth.uid() in the RPC, never
 *   from these args. The RPC signature deliberately has no actor_user_id argument.
 */

import { supabase } from '@/lib/supabase';

export type PhiAccessArgs = {
  /** UUID of the user whose PHI was accessed. */
  accessedUserId: string;
  /** PHI fields that were viewed (e.g., ['dose_log.value', 'photos']). Min 1 element. */
  accessedFields: string[];
  /** Staff-authored reason for the access. 1–500 chars. Must NOT contain patient identifiers. */
  reason: string;
  /** Optional org context. Forward-compat for Phase 28 multi-org axis. */
  accessedOrgId?: string | null;
};

/**
 * Fire-and-forget PHI access logger.
 *
 * Resolves void regardless of RPC outcome — errors are swallowed and logged via
 * console.warn with error.code only (Pattern S3: never log error.message).
 *
 * Usage: `void logPhiAccess({ accessedUserId, accessedFields, reason })`
 * Do NOT await this at a call site — it must not block render.
 */
export async function logPhiAccess(args: PhiAccessArgs): Promise<void> {
  try {
    const { error } = await supabase.rpc('log_phi_access', {
      p_accessed_user_id: args.accessedUserId,
      p_accessed_fields: args.accessedFields,
      p_reason: args.reason,
      p_accessed_org_id: args.accessedOrgId ?? null,
    });
    if (error) {
      // T-25-02-S3: log error.code only — never error.message (PII/credential leak vector).
      console.warn('[hipaa/phi-access] rpc rejected', error.code ?? 'unknown');
    }
  } catch (e) {
    // T-25-02-S3: log e.name only — never e.message.
    console.warn('[hipaa/phi-access] threw', e instanceof Error ? e.name : 'unknown');
  }
}
