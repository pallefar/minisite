/**
 * Phase 22 Plan 22-06 — admin-api client wrapper for ADMIN-01 + ADMIN-05.
 *
 * Wraps the two admin SECURITY DEFINER RPCs shipped in Wave 0 (Plan 22-01):
 *   - public.admin_list_members(p_search, p_tier, p_page, p_size) → MembersResult
 *   - public.admin_set_feature_flag_override(p_user_id, p_flag_key, p_value, p_expires_at) → void
 *
 * Error mapping uses the discriminated `AdminApiError` pattern from
 * `src/lib/account-delete.ts` so call sites can branch on `e.code` rather
 * than parsing Postgres error strings.
 *
 * SECURITY contract: the client `is_staff` check in `AdminLayout` is UX-only.
 * Both RPCs raise `42501` (`forbidden`) inside the function body when
 * `public.is_staff()` returns false — that is the security boundary
 * (Pattern S1 dual-layer gate, per 22-PATTERNS Wave E).
 */
import { supabase } from '@/lib/supabase';

// ─── Discriminated error ────────────────────────────────────────────────────

export type AdminApiErrorCode =
  | 'not_staff'        // 42501 — is_staff gate refused
  | 'not_authenticated' // 28000 — anonymous caller
  | 'invalid'          // 22023 — invalid param (size/page/tier)
  | 'network'          // fetch / connection error
  | 'unknown';

export class AdminApiError extends Error {
  code: AdminApiErrorCode;
  constructor(code: AdminApiErrorCode, options?: { cause?: unknown }) {
    super(`admin-api:${code}`, options);
    this.name = 'AdminApiError';
    this.code = code;
  }
}

interface SupabaseRpcError {
  code?: string;
  message?: string;
  details?: string;
}

function mapRpcError(err: SupabaseRpcError | null | undefined): AdminApiErrorCode {
  if (!err) return 'unknown';
  switch (err.code) {
    case '42501':
      return 'not_staff';
    case '28000':
      return 'not_authenticated';
    case '22023':
      return 'invalid';
    default:
      return 'unknown';
  }
}

// ─── Member shape ───────────────────────────────────────────────────────────

export type MemberTier = 'free' | 'paid' | 'clinic_seat' | 'past_due';

export interface Member {
  user_id: string;
  email: string;
  tier: MemberTier | string;
  signup_date: string;
  last_active_at: string | null;
  clinic_name: string | null;
  country: string | null;
  stripe_status: string;
}

export interface MembersResult {
  rows: Member[];
}

export interface ListMembersFilters {
  search?: string | null;
  tier?: MemberTier | null;
  page?: number;
  size?: number;
}

export async function listMembers(filters: ListMembersFilters): Promise<MembersResult> {
  const params = {
    p_search: filters.search ?? null,
    p_tier: filters.tier ?? null,
    p_page: filters.page ?? 1,
    p_size: filters.size ?? 50,
  };
  try {
    const { data, error } = await supabase.rpc('admin_list_members', params);
    if (error) {
      throw new AdminApiError(mapRpcError(error as SupabaseRpcError), { cause: error });
    }
    const rows = (Array.isArray(data) ? data : []) as Member[];
    return { rows };
  } catch (e) {
    if (e instanceof AdminApiError) throw e;
    throw new AdminApiError('network', { cause: e });
  }
}

// ─── Feature-flag overrides (ADMIN-05) ──────────────────────────────────────

export interface SetFeatureFlagOverrideInput {
  userId: string;
  flagKey: string;
  value: boolean;
  /** ISO-8601 UTC timestamp; required by the RPC (NOT NULL column). */
  expiresAt: string;
}

export async function setFeatureFlagOverride(
  input: SetFeatureFlagOverrideInput,
): Promise<void> {
  try {
    const { error } = await supabase.rpc('admin_set_feature_flag_override', {
      p_user_id: input.userId,
      p_flag_key: input.flagKey,
      p_value: input.value,
      p_expires_at: input.expiresAt,
    });
    if (error) {
      throw new AdminApiError(mapRpcError(error as SupabaseRpcError), { cause: error });
    }
  } catch (e) {
    if (e instanceof AdminApiError) throw e;
    throw new AdminApiError('network', { cause: e });
  }
}
