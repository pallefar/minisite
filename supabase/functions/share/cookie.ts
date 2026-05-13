/**
 * HttpOnly recipient cookie helpers for the `share` Edge Function.
 *
 * Phase 8 D-03 (recipient binding) — after a successful /redeem, we mint an
 * opaque cookie value and persist its sha256 hash to `shares.recipient_session_hash`.
 * Subsequent /snapshot requests MUST present the same cookie; the Edge Function
 * re-hashes the cookie value and compares against the stored hash. This is the
 * "no doctor account" mitigation — the cookie itself is the credential, and
 * HttpOnly + Secure + SameSite=Strict block JS exfiltration / CSRF / cross-site
 * theft (T-08-S2 + T-08-T1).
 *
 * Wraps `jsr:@std/http/cookie` (Deno standard library) because hand-rolling
 * Set-Cookie strings is the well-known footgun on Edge Functions.
 */

import { getCookies, setCookie } from 'jsr:@std/http/cookie';

const COOKIE_NAME = 'recipient_session';

/**
 * Append a Set-Cookie header for the recipient session.
 *
 * Attributes (locked — DO NOT relax):
 *   HttpOnly       — JS cannot read; XSS cannot exfiltrate (T-08-S2)
 *   Secure         — TLS only; cookie never sent over plaintext
 *   SameSite=Strict — no cross-site sends; rules out CSRF + cross-site
 *                    embedding theft (T-08-T1)
 *   Path=/         — scoped to the function root (the Edge Function is its
 *                    own origin under <ref>.supabase.co/functions/v1/share/)
 *   Max-Age        — floor(remaining share lifetime in seconds); ensures the
 *                    cookie auto-expires no later than the share row's
 *                    expires_at column even if the row is hard-deleted
 *                    before then.
 *
 * Assumption A1 (08-02-PLAN.md): if `sameSite: 'Strict'` (PascalCase) trips
 * Deno's @std/http/cookie SameSite enum type check, fall back to the string
 * literal 'Strict' which the runtime parses identically.
 */
export function setRecipientCookie(headers: Headers, value: string, maxAgeSec: number): void {
  setCookie(headers, {
    name: COOKIE_NAME,
    value,
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: maxAgeSec,
  });
}

/** Return the recipient cookie value or `null` if absent. */
export function getRecipientCookie(req: Request): string | null {
  const cookies = getCookies(req.headers);
  return cookies[COOKIE_NAME] ?? null;
}
