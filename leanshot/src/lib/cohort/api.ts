/**
 * Phase 27 Plan 27-02 — Cohort API wrapper (Pattern S7).
 *
 * Thin client over the 4 SECDEF cohort RPCs:
 *   - cohort_define       (admin)
 *   - cohort_set_status   (admin for draft↔active; superadmin for archive)
 *   - cohort_archive      (superadmin)
 *   - cohort_is_member    (any authenticated — boolean-only helper)
 *
 * Mirrors the verbatim shape of leanshot/src/lib/admin/affiliate-review.ts
 * (Phase 22 Plan 22-07) — same error-code discriminated union, same
 * SupabaseRpcError mapping, same mapRpcError SQLSTATE switch.
 *
 * Client-side validation: defineCohort runs `ruleTreeSchema.parse(rule)`
 * BEFORE hitting the network so malformed trees fail fast with a typed
 * `CohortApiError('invalid_rule')` (and never consume a server round-trip).
 * It then computes `compiledSql = ruleTreeToLiteralSql(rule)` and ships
 * BOTH the jsonb + the literal-baked SQL fragment to the server, where the
 * plpgsql validator re-checks the jsonb (defense-in-depth layer #3).
 */
import { ruleTreeSchema, type RuleNode } from '@/lib/cohort/rule-tree-schema';
import { ruleTreeToLiteralSql } from '@/lib/cohort/rule-tree-to-sql';
import { supabase } from '@/lib/supabase';

export type CohortApiErrorCode =
  | 'not_staff'
  | 'not_authenticated'
  | 'not_found'
  | 'invalid_rule'
  | 'duplicate_name'
  | 'invalid_state'
  | 'network'
  | 'unknown';

export class CohortApiError extends Error {
  code: CohortApiErrorCode;
  constructor(code: CohortApiErrorCode, options?: { cause?: unknown }) {
    super(`cohort:${code}`, options);
    this.name = 'CohortApiError';
    this.code = code;
  }
}

interface SupabaseRpcError {
  code?: string;
  message?: string;
  details?: string;
}

type CohortRpcName =
  | 'cohort_define'
  | 'cohort_set_status'
  | 'cohort_archive'
  | 'cohort_is_member';

function mapRpcError(err: SupabaseRpcError | null | undefined): CohortApiErrorCode {
  if (!err) return 'unknown';
  const msg = err.message ?? '';
  if (msg.includes('not_found')) return 'not_found';
  if (msg.includes('invalid_rule')) return 'invalid_rule';
  if (msg.includes('invalid_transition') || msg.includes('invalid_status')) {
    return 'invalid_state';
  }
  switch (err.code) {
    case '42501':
      return 'not_staff';
    case '28000':
      return 'not_authenticated';
    case '23505':
      return 'duplicate_name';
    case '22023':
      // Generic invalid-state errors raised by the RPC layer (e.g. invalid_name,
      // invalid_compiled_sql, invalid_status). Re-check message for finer codes.
      if (msg.includes('invalid_rule')) return 'invalid_rule';
      return 'invalid_state';
    default:
      return 'unknown';
  }
}

async function callCohortRpc<T = unknown>(
  rpcName: CohortRpcName,
  params: Record<string, unknown>,
): Promise<T> {
  try {
    const { data, error } = await supabase.rpc(rpcName, params);
    if (error) {
      throw new CohortApiError(mapRpcError(error as SupabaseRpcError), {
        cause: error,
      });
    }
    return data as T;
  } catch (e) {
    if (e instanceof CohortApiError) throw e;
    throw new CohortApiError('network', { cause: e });
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface DefineCohortResult {
  cohortId: string;
}

export async function defineCohort(
  name: string,
  rule: RuleNode,
): Promise<DefineCohortResult> {
  // Client-side fail-fast: malformed trees never hit the network.
  const parsed = ruleTreeSchema.safeParse(rule);
  if (!parsed.success) {
    throw new CohortApiError('invalid_rule', { cause: parsed.error });
  }
  let compiledSql: string;
  try {
    compiledSql = ruleTreeToLiteralSql(rule);
  } catch (e) {
    throw new CohortApiError('invalid_rule', { cause: e });
  }
  const cohortId = await callCohortRpc<string>('cohort_define', {
    p_name: name,
    p_rule: rule,
    p_compiled_sql: compiledSql,
  });
  return { cohortId };
}

export type CohortStatus = 'draft' | 'active' | 'archived';

export async function setCohortStatus(
  cohortId: string,
  status: CohortStatus,
): Promise<void> {
  await callCohortRpc<void>('cohort_set_status', {
    p_cohort_id: cohortId,
    p_status: status,
  });
}

export async function archiveCohort(cohortId: string): Promise<void> {
  await callCohortRpc<void>('cohort_archive', { p_cohort_id: cohortId });
}

/**
 * Consumer-side membership probe — boolean-only.
 * Returns `false` on any RPC error (network, not_authenticated, etc.) so
 * consumer code doesn't need to wrap in try/catch for soft features.
 * Throws ONLY on explicit `not_staff` violations (which should never happen
 * since cohort_is_member is granted to authenticated).
 */
export async function isCohortMember(
  userId: string,
  cohortId: string,
): Promise<boolean> {
  try {
    const result = await callCohortRpc<boolean>('cohort_is_member', {
      p_user_id: userId,
      p_cohort_id: cohortId,
    });
    return result === true;
  } catch (e) {
    if (e instanceof CohortApiError && e.code === 'not_staff') throw e;
    return false;
  }
}
