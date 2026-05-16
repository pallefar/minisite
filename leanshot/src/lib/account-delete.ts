/**
 * Phase 7 Plan 07-07 — client wrapper around `initiate_account_deletion` RPC.
 *
 * Two exports:
 *   - `typedConfirmMatches(typed, email)`: pure helper for the DeleteAccountModal
 *     destructive-button gate. Case-insensitive + whitespace-trimmed.
 *   - `initiateAccountDeletion()`: invokes the SECURITY DEFINER RPC, maps the
 *     5 known sqlstates to discriminated AccountDeleteError codes, and on
 *     success signs out + wipes local Zustand state (the RPC has already
 *     deleted auth.sessions server-side, so the local signOut is the
 *     client-side mirror; resetAll clears the persisted leanshot_v4 blob).
 *
 * The RPC takes ZERO parameters — caller identity comes from auth.uid()
 * server-side (T-07-07-S2 mitigation). Any signature drift here would be a
 * security regression; the contract is grep-verified by the unit tests
 * (mockRpc receives exactly one argument).
 *
 * D-06 compliance: NO non-null-assertion selectors anywhere in this module
 * (per the Phase 7 D-06 sweep tracked by 07-09). Reads of the store are via
 * `useStore.getState()` at call time, not subscription.
 */
import { signOut } from '@/lib/auth';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export type AccountDeleteErrorCode =
  | 'recent_auth_required'
  | 'already_pending'
  | 'not_authenticated'
  | 'unknown';

export class AccountDeleteError extends Error {
  code: AccountDeleteErrorCode;
  constructor(code: AccountDeleteErrorCode, options?: { cause?: unknown }) {
    super(`account-delete:${code}`, options);
    this.name = 'AccountDeleteError';
    this.code = code;
  }
}

/**
 * Phase 22 Plan 22-05 — typed-confirm gate now compares against the literal
 * "DELETE MY ACCOUNT" per 22-UI-SPEC §Copywriting lines 572-573 (was
 * `email` match in Phase 7 — switched because UI-SPEC locks the new copy
 * exactly, and case-sensitive exact-match is a stricter destructive-action
 * gate than email-typed-back).
 *
 * Exact match, case-sensitive, trimmed only at the edges (mobile keyboards
 * still auto-insert trailing spaces). The 2-arg overload from Phase 7 is
 * preserved as an optional second parameter so any orphan callers don't
 * break — the second arg is ignored.
 */
export const TYPED_CONFIRM_PHRASE = 'DELETE MY ACCOUNT';

export function typedConfirmMatches(typed: string, _legacyEmail?: string | null): boolean {
  return typed.trim() === TYPED_CONFIRM_PHRASE;
}

interface SupabaseRpcError {
  code?: string;
  message?: string;
  details?: string;
}

function mapRpcError(error: SupabaseRpcError): AccountDeleteError {
  switch (error.code) {
    case 'P0007':
      return new AccountDeleteError('recent_auth_required', { cause: error });
    case 'P0008':
      return new AccountDeleteError('already_pending', { cause: error });
    case '28000':
      return new AccountDeleteError('not_authenticated', { cause: error });
    default:
      return new AccountDeleteError('unknown', { cause: error });
  }
}

/**
 * Phase 6 D-03 invariant: the local `leanshot_v4_pre_cloud_backup` blob
 * contains a snapshot of the user's pre-migration data. When the account is
 * being deleted, the backup must be wiped too — otherwise the device retains
 * a recoverable copy of data the user just asked to be destroyed. Wrapped in
 * try/catch because private-mode browsers throw on localStorage access.
 */
function wipePreCloudBackup(): void {
  try {
    localStorage.removeItem('leanshot_v4_pre_cloud_backup');
  } catch {
    /* noop — private mode */
  }
}

/**
 * Invokes the `initiate_account_deletion` RPC. On success, clears local
 * Zustand state + signs out (the server has already deleted auth.sessions,
 * but the SPA still holds the JWT in memory + sb-leanshot-auth cookie until
 * we call signOut). On RPC failure, throws AccountDeleteError with the
 * mapped code; the modal renders the appropriate inline error or toast.
 *
 * Throw rather than return-with-error because the caller (DeleteAccountModal
 * onConfirm) needs to distinguish success-vs-error in a single await — no
 * downstream code path expects a successful return value here.
 */
export async function initiateAccountDeletion(): Promise<void> {
  const { error } = await supabase.rpc('initiate_account_deletion');
  if (error) {
    throw mapRpcError(error as SupabaseRpcError);
  }
  wipePreCloudBackup();
  useStore.getState().resetAll();
  await signOut();
}
