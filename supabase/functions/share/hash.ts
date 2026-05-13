/**
 * Hash + parse helpers for the `share` Edge Function.
 *
 * Phase 8 Plan 08-02 — pure utility module (no imports from Supabase / Deno
 * stdlib). Kept module-free of side effects so the test suite can import it
 * without any `--allow-*` flag spillover.
 *
 * - `sha256Hex(input)` — WebCrypto-backed hex digest used for:
 *     1. token_hash lookup column (raw share-link token → sha256 hex)
 *     2. recipient_session_hash column (opaque cookie value → sha256 hex)
 *   Hash form matches Plan 08-01's `encode(digest(:t, 'sha256'), 'hex')`
 *   exactly so the JS-side and Postgres-side values are byte-compatible.
 *
 * - `parseUaFamily(ua)` — Coarse User-Agent family bucket. Phase 8 D-02 only
 *   stores the FAMILY (Chrome/Firefox/Safari/Edge/Other), NOT the full UA
 *   string — per Phase 7 retention pattern + ME-2 minimization.
 *
 * - `parseIpFamily(xff)` — Coarse IP family bucket. The audit_logs CHECK
 *   constraint (20260701000001 — ME-2 from Plan 08-01) rejects anything
 *   other than `/16`-bucketed IPv4, `/48`-bucketed IPv6, or the sentinel
 *   `'unknown'`. This helper is the canonical bucketer; the DB CHECK is the
 *   defense-in-depth backstop.
 */

export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function parseUaFamily(ua: string): string {
  // Order matters — Edge identifies as Chromium so Edg/ must be tested first.
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Other';
}

export function parseIpFamily(xff: string): string {
  // X-Forwarded-For is a comma-separated client→proxy chain; the client IP
  // is the LEFT-MOST entry per RFC 7239 + Supabase Edge convention. The
  // remaining entries are intermediary proxies and not the client identity.
  const ip = xff.split(',')[0]?.trim() ?? '';

  if (ip === '') return 'unknown';

  // IPv4 dotted quad → /16 bucket. e.g. "192.168.1.42" → "192.168.0.0/16"
  const v4 = ip.split('.');
  if (v4.length === 4 && v4.every((p) => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255)) {
    return `${v4[0]}.${v4[1]}.0.0/16`;
  }

  // IPv6 → /48 bucket (first 3 hextets). e.g. "2001:db8:abcd:1234::1" →
  // "2001:db8:abcd::/48". Loose check — full RFC 5952 normalization is out
  // of scope; the DB CHECK constraint rejects anything we mis-parse.
  if (ip.includes(':')) {
    const hextets = ip.split(':').slice(0, 3);
    if (hextets.length === 3 && hextets.every((h) => /^[0-9a-fA-F]{0,4}$/.test(h))) {
      return `${hextets.join(':')}::/48`;
    }
  }

  return 'unknown';
}
