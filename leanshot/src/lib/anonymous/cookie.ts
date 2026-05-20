/**
 * Phase 34 Plan 34-02 — `_ls_anon` browser cookie helpers.
 *
 * Used by the AnonymousPreviewLayer (Plan 34-06) to persist the anonymous
 * session cookie issued by the `create-anon-session` Edge Function. The
 * cookie value is the `anonymous_sessions.cookie_id` UUID; rows are TTL'd
 * after 30 days of inactivity by the weekly pg_cron job (migration
 * `20270706000005_p34_anon_session_ttl_cron.sql`), so the cookie Max-Age
 * matches that retention window.
 *
 * Cookie attributes:
 *   - Path=/                — readable on every route
 *   - Max-Age=2592000       — 30 days (matches DB TTL)
 *   - SameSite=Lax          — sent on top-level navigation, not on cross-site
 *                             POSTs (T-34-02-03 information-disclosure mitigation)
 *   - Secure (https only)   — never sent over plain http
 *
 * The value carries NO PII — just a UUID v4 entropy token (T-34-02-03).
 */

export const ANON_COOKIE_NAME = '_ls_anon';

// 30 days, in seconds — matches the pg_cron TTL window in 20270706000005.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Read the `_ls_anon` cookie value if present.
 *
 * Returns null when:
 *   - the cookie is not set
 *   - we are running in a non-browser context (e.g. SSR placeholder, tests
 *     that have not mocked `document`)
 */
export function readAnonCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie;
  if (!cookies) return null;
  const escapedName = ANON_COOKIE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookies.match(new RegExp('(?:^|;\\s*)' + escapedName + '=([^;]*)'));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1] ?? '');
  } catch {
    // Malformed percent-encoding — treat as absent rather than throw.
    return null;
  }
}

/**
 * Write the `_ls_anon` cookie with Path=/, 30d Max-Age, SameSite=Lax, and
 * Secure on https. A no-op outside the browser.
 */
export function writeAnonCookie(value: string): void {
  if (typeof document === 'undefined') return;
  const secure =
    typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  const encoded = encodeURIComponent(value);
  document.cookie = `${ANON_COOKIE_NAME}=${encoded}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

/**
 * Expire the `_ls_anon` cookie immediately. A no-op outside the browser.
 *
 * Called by Plan 34-06 after the anonymous session is merged into a real
 * user account, so subsequent reads return null and the dashboard never
 * confuses an authenticated session with a leftover anon cookie.
 */
export function clearAnonCookie(): void {
  if (typeof document === 'undefined') return;
  const secure =
    typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${ANON_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}
