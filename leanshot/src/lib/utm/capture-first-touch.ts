/**
 * Phase 39 Plan 39-04 — first-touch UTM cookie writer (PAYWALL-07 / D-09 /
 * RESEARCH OQ-5).
 *
 * Reads window.location.search for utm_source. If `lt_utm_source` cookie
 * is unset AND a utm_source query exists, sets a 1-year cookie with the
 * URL-decoded value. Idempotent: if cookie already present, does nothing
 * (first-touch immutability).
 *
 * Phase 39 OWNS this cookie key per RESEARCH OQ-5. Phase 51 will adopt
 * the same key when shipping its UTM map pipeline; do NOT rename without
 * coordinating both phases.
 *
 * Cookie attributes:
 *   - SameSite=Lax (paywall variant-resolver reads the cookie on same-site
 *     fetch; Lax permits this and blocks third-party cross-site reads).
 *   - Secure (only writes over HTTPS — production + previews are HTTPS).
 *   - max-age=31536000 (1 year — variant-resolver downstream pins the
 *     resolved variant in `user_experiments.utm_variant_id` long before
 *     this expires).
 *   - NO HttpOnly: document.cookie write requires JS-readable cookies.
 *     Server-side variant-resolver also reads via the request's Cookie
 *     header, so no functional loss from the lack of HttpOnly.
 */

const COOKIE_KEY = 'lt_utm_source';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

function readCookie(key: string): string | undefined {
  try {
    const raw = document.cookie ?? '';
    const pairs = raw.split(';');
    for (const pair of pairs) {
      const trimmed = pair.trim();
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const k = trimmed.slice(0, eq);
      if (k === key) return trimmed.slice(eq + 1);
    }
  } catch {
    /* document.cookie unavailable; treat as no-cookie */
  }
  return undefined;
}

export function captureFirstTouchUtm(): void {
  try {
    if (typeof window === 'undefined') return;
    // First-touch immutability: existing cookie wins.
    if (readCookie(COOKIE_KEY) !== undefined) return;

    const params = new URLSearchParams(window.location.search ?? '');
    const raw = params.get('utm_source');
    if (!raw) return;

    // URLSearchParams.get already URL-decodes; no extra decode needed.
    const value = raw;
    if (value.length === 0) return;

    // Emit cookie. URLSearchParams.get already URL-decoded the value;
    // write it back as-is so the round-trip preserves the operator's
    // intended UTM source string for the variant-resolver lookup.
    document.cookie = `${COOKIE_KEY}=${value}; Path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax; Secure`;
  } catch {
    /* fail-soft; cookie write is non-critical */
  }
}
