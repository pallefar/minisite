/**
 * Phase 19 Plan 19-08 — D-38 affiliate-impression client wrapper (BL-8).
 *
 * Non-blocking client-side ping fired on `/r/{code}/landing` mount.
 * Callers MUST use `void recordImpression(affiliateId)` and continue
 * immediately — the function is fire-and-forget and never throws.
 *
 * Privacy guarantees (D-38):
 *   1. Do-Not-Track honor: if `navigator.doNotTrack === '1'`, return
 *      immediately without firing fetch.
 *   2. UA SHA-256-hashed via `crypto.subtle.digest` BEFORE any network
 *      call — raw user-agent never leaves the browser.
 *   3. IP truncation is server-side (Edge Function calls
 *      `insert_affiliate_impression` RPC which applies set_masklen=24).
 *      The client never holds an IP.
 *   4. Silent catch on fetch failure — impression-loss is non-fatal;
 *      landing render MUST NOT block on this call.
 *
 * Endpoint:
 *   POST {VITE_SUPABASE_URL}/functions/v1/affiliate-impression
 *   verify_jwt = false (anonymous public ping)
 *
 * Schema for `affiliate_impressions` table (Plan 19-01):
 *   { id uuid, affiliate_id uuid, ip_24 inet, ua_hash text, referer text,
 *     created_at timestamptz }
 */

/**
 * Pure DNT-check helper — exposed so unit tests can assert behavior
 * without mocking `crypto.subtle` or `fetch`.
 *
 * Returns `false` when the visitor opted out of tracking via the browser's
 * Do-Not-Track signal; returns `true` otherwise (including the typical
 * "DNT unset" case where the property is null/undefined).
 */
export function shouldRecordImpression(): boolean {
  if (typeof navigator === 'undefined') return false;
  // DNT is conventionally '1' for opt-out, '0' for opt-in, null for unset.
  // We only suppress when the visitor has explicitly opted out.
  return navigator.doNotTrack !== '1';
}

/** Hex-encode a Uint8Array as a 64-char lowercase string. */
function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

/** SHA-256 hash of the user-agent string. Returns a 64-char lowercase
 * hex string. Falls back to a 64-zero hash if `crypto.subtle` is
 * unavailable (e.g. non-secure-context, jsdom older than 22). */
async function hashUserAgent(ua: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ua));
      return toHex(new Uint8Array(buf));
    }
  } catch {
    // Fall through to placeholder.
  }
  return '0'.repeat(64);
}

/** Resolve the affiliate-impression endpoint URL. Mirrors the pattern
 * used by other client-side Edge Function callers (e.g. partner-profile-update
 * via the supabase-js `functions.invoke` helper, but we use a plain fetch
 * here so the call truly is fire-and-forget and never holds a JWT). */
function impressionEndpoint(): string {
  // VITE_SUPABASE_URL is set at build time; if absent, fall back to a
  // relative path that the Vercel rewrite resolves to the Edge Function
  // gateway. Either way, fetch failure is silent.
  const base = (import.meta as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL ?? '';
  return `${base.replace(/\/$/, '')}/functions/v1/affiliate-impression`;
}

/**
 * Fire-and-forget impression ping.
 *
 * Caller pattern:
 *   useEffect(() => {
 *     void recordImpression(affiliate.id);
 *   }, [affiliate.id]);
 *
 * Never awaited. Never throws. Failure modes (DNT, fetch reject, crypto
 * unavailable) all return undefined silently.
 */
export async function recordImpression(affiliateId: string): Promise<void> {
  if (!shouldRecordImpression()) return;
  if (!affiliateId || typeof affiliateId !== 'string') return;

  try {
    const ua = typeof navigator !== 'undefined' ? (navigator.userAgent ?? '') : '';
    const referer = typeof document !== 'undefined' ? (document.referrer ?? '') : '';
    const ua_hash = await hashUserAgent(ua);

    await fetch(impressionEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Keep payload byte-light — 3 fields. No credentials so the request
      // is anonymous (the Edge Function has verify_jwt=false).
      credentials: 'omit',
      keepalive: true, // survives page unload (useful if user clicks away fast)
      body: JSON.stringify({
        affiliate_id: affiliateId,
        ua_hash,
        referer: referer.slice(0, 500),
      }),
    }).catch(() => undefined);
  } catch {
    // Any other failure (e.g. URL construction) — silent. The landing
    // render MUST NOT block.
  }
}
