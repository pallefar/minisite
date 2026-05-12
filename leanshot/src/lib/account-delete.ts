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
 * D-06 compliance: NO `s.user!` selectors anywhere in this module. Reads of
 * the store are via `useStore.getState()` at call time, not subscription.
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
 * Returns true iff `typed` (trimmed, lowercased) equals `email` (trimmed,
 * lowercased) AND `email` is a non-empty string. The DeleteAccountModal uses
 * this to gate its destructive button. Case-insensitive because users
 * shouldn't have to remember whether they registered as `Foo@bar.com` or
 * `foo@bar.com`; trim because mobile keyboards auto-insert trailing spaces.
 */
export function typedConfirmMatches(
  typed: string,
  email: string | null | undefined,
): boolean {
  if (typeof email !== 'string') return false;
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail.length === 0) return false;
  return typed.trim().toLowerCase() === normalizedEmail;
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
