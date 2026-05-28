/**
 * Phase 66 Plan 66-06 (AUTH-17) — Role MFA requirement client wrappers.
 *
 * Backed by Phase 66-01 schema (supabase/migrations/20290105000002):
 *   - public.mfa_role_requirements (role text PK, required bool, since ts, updated_by uuid)
 *     * SELECT: authenticated (RLS) — any signed-in user may read so the
 *       client can enforce role-required-MFA at sign-in time.
 *     * DIRECT INSERT/UPDATE/DELETE: denied via "no_direct_write" policy.
 *   - public.set_mfa_role_requirement(p_role text, p_required boolean)
 *     * SECDEF, superadmin-only. Upserts the row with since=now() + updated_by=auth.uid().
 *
 * Error mirrors the Phase 26 Plan 26-05 `affiliate-tier` AffiliateTierError /
 * mapRpcError pattern. UI consumers catch the typed error and surface a toast.
 */
import { supabase } from '@/lib/supabase';

export interface RoleMfaRequirement {
  role: string;
  required: boolean;
  since: string;
}

export type RoleMfaConfigErrorCode = 'not_authenticated' | 'forbidden' | 'network' | 'unknown';

interface SupabasePgError {
  code?: string;
  message?: string;
  details?: string;
}

export class RoleMfaConfigError extends Error {
  code: RoleMfaConfigErrorCode;
  constructor(code: RoleMfaConfigErrorCode, options?: { cause?: unknown }) {
    super(`role-mfa-config:${code}`, options);
    this.name = 'RoleMfaConfigError';
    this.code = code;
  }
}

function mapRpcError(err: SupabasePgError | null | undefined): RoleMfaConfigErrorCode {
  if (!err) return 'unknown';
  const m = err.message ?? '';
  if (m.includes('authentication required')) return 'not_authenticated';
  if (err.code === '28000') return 'not_authenticated';
  if (err.code === '42501' || m.includes('only superadmin') || m.includes('forbidden')) {
    return 'forbidden';
  }
  return 'unknown';
}

/**
 * List all role MFA requirements (5 seeded rows from migration).
 *
 * RLS: any authenticated user may read. Returns rows sorted by role for stable
 * UI rendering; the Phase 66-01 seed inserts {superadmin, admin, staff,
 * clinic-admin, user} but new entries written via the RPC may show up later.
 */
export async function listRoleMfaRequirements(): Promise<RoleMfaRequirement[]> {
  try {
    const { data, error } = await supabase
      .from('mfa_role_requirements')
      .select('role, required, since')
      .order('role', { ascending: true });
    if (error) {
      throw new RoleMfaConfigError(mapRpcError(error as SupabasePgError), {
        cause: error,
      });
    }
    return (data ?? []) as RoleMfaRequirement[];
  } catch (e) {
    if (e instanceof RoleMfaConfigError) throw e;
    throw new RoleMfaConfigError('network', { cause: e });
  }
}

/**
 * Toggle MFA-required for a single role via the set_mfa_role_requirement
 * SECDEF RPC. Superadmin-only at the DB layer (Pattern S1 dual-layer; the
 * <RoleMfaRequirementTable> also greys the checkbox out for non-superadmins).
 */
export async function setRoleMfaRequirement(role: string, required: boolean): Promise<void> {
  try {
    const { error } = await supabase.rpc('set_mfa_role_requirement', {
      p_role: role,
      p_required: required,
    });
    if (error) {
      throw new RoleMfaConfigError(mapRpcError(error as SupabasePgError), {
        cause: error,
      });
    }
  } catch (e) {
    if (e instanceof RoleMfaConfigError) throw e;
    throw new RoleMfaConfigError('network', { cause: e });
  }
}
