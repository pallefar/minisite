/**
 * Phase 59 Plan 59-03 (AUTH-10) — shared anon→authenticated merge helper.
 *
 * Merges the browser's anonymous session into the just-authenticated user's
 * profile by calling the existing `/functions/v1/merge-anon-session` Edge Fn.
 *
 * Security (T-59-08): the helper accepts ONLY the caller's `accessToken` (the
 * just-minted session token). It never accepts or trusts an externally-supplied
 * user id — the Edge Fn is advisory-locked and scopes the merge to the JWT
 * subject, so a malicious anon session cannot overwrite another user's data.
 *
 * Behaviour:
 *   - No cookie present → no-ops and returns { merged: false }
 *   - Cookie present → POSTs to merge-anon-session; Authorization uses
 *     `accessToken` when supplied, falls back to the anon key
 *   - Network / parse errors are swallowed (best-effort) → { merged: false }
 *   - Cookie is always cleared in the `finally` block (even on failure)
 *
 * Used by:
 *   - ConsumerOnboardingRenderer (post-signup merge handshake)
 *   - AuthCallbackView (post-OAuth/Apple exchange merge)
 */

import { clearAnonCookie, readAnonCookie } from '@/lib/anonymous/cookie';

// ──────────────────────────────────────────────────────────────────────────
// Env helpers (same pattern as ConsumerOnboardingRenderer)
// ──────────────────────────────────────────────────────────────────────────

function getSupabaseUrl(): string {
  return (
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://placeholder.invalid'
  );
}
function getAnonKey(): string {
  return (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? 'placeholder';
}

// ──────────────────────────────────────────────────────────────────────────
// Result shape
// ──────────────────────────────────────────────────────────────────────────

export interface MergeAnonSessionResult {
  merged: boolean;
  draft_entries?: unknown[];
}

// ──────────────────────────────────────────────────────────────────────────
// mergeAnonSession
// ──────────────────────────────────────────────────────────────────────────

/**
 * Best-effort merge of the local anonymous session into the authenticated user.
 *
 * @param opts.accessToken - The just-authenticated session's access token.
 *   When omitted or falsy the anon key is used as the Authorization bearer
 *   (lower-trust path; still valid for the Edge Fn's public-anon fallback).
 * @param opts.distinctId  - PostHog anonymous distinct_id for attribution;
 *   pass `posthog.get_distinct_id()` in a try/catch. Optional — the helper
 *   never throws if omitted.
 *
 * @returns MergeAnonSessionResult — always resolves, never rejects.
 */
export async function mergeAnonSession(opts: {
  accessToken?: string;
  distinctId?: string;
}): Promise<MergeAnonSessionResult> {
  const cookie = readAnonCookie();
  if (!cookie) return { merged: false };

  const { accessToken, distinctId } = opts;
  const anonKey = getAnonKey();
  const authorization = accessToken ? `Bearer ${accessToken}` : `Bearer ${anonKey}`;

  try {
    const res = await fetch(`${getSupabaseUrl()}/functions/v1/merge-anon-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: authorization,
      },
      body: JSON.stringify({
        cookie_ids: [cookie],
        anon_distinct_id: distinctId,
      }),
    });
    const json = (await res.json()) as { merged?: boolean; draft_entries?: unknown[] };
    return {
      merged: json?.merged === true,
      draft_entries: Array.isArray(json?.draft_entries) ? json.draft_entries : undefined,
    };
  } catch (err) {
    console.warn('[mergeAnonSession] merge-anon-session failed:', err);
    return { merged: false };
  } finally {
    clearAnonCookie();
  }
}
