/**
 * D-13: leaderboard handle must be 6-24 alphanumeric + dash/underscore chars.
 *
 * Server-side mirror lives in the CHECK constraint on public.leaderboard_optin.handle
 * (constraint leaderboard_optin_handle_format) AND in the set_leaderboard_optin
 * SECDEF RPC (20270708000014_p35_leaderboard_rpcs.sql). Client validation is for
 * live form feedback only — the server always re-validates.
 *
 * Blocks:
 *   - Spaces (real-name shapes like "John Smith")
 *   - Diacritics (café, naïve, etc.)
 *   - Special characters (@, !, #, %, etc.)
 *   - Pure numeric strings under 6 chars
 *   - Strings over 24 chars
 */

export const HANDLE_REGEX = /^[a-zA-Z0-9_-]{6,24}$/;

export type HandleValidationError =
  | 'too_short'
  | 'too_long'
  | 'invalid_characters'
  | 'empty';

export interface HandleValidationOk {
  readonly ok: true;
}

export interface HandleValidationFail {
  readonly ok: false;
  readonly error: HandleValidationError;
  readonly message: string;
}

export type HandleValidationResult = HandleValidationOk | HandleValidationFail;

/**
 * Validates a leaderboard handle against D-13 rules.
 * Returns `{ ok: true }` on success or `{ ok: false, error, message }` on failure.
 * Always validate server-side too — this is for live form feedback only.
 */
export function validateHandle(handle: string): HandleValidationResult {
  if (!handle || handle.trim() === '') {
    return { ok: false, error: 'empty', message: 'Handle is required' };
  }
  if (handle.length < 6) {
    return { ok: false, error: 'too_short', message: 'Handle must be 6-24 characters' };
  }
  if (handle.length > 24) {
    return { ok: false, error: 'too_long', message: 'Handle must be 6-24 characters' };
  }
  if (!HANDLE_REGEX.test(handle)) {
    return {
      ok: false,
      error: 'invalid_characters',
      message:
        '6–24 alphanumeric characters (letters, numbers, dash, underscore — no spaces or real names)',
    };
  }
  return { ok: true };
}
