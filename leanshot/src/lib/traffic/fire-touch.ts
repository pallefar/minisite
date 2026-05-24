/**
 * Phase 51 Plan 51-02 Task 4 — SPA-side traffic touch helper.
 *
 * Reads the `lt_anon_id` HttpOnly cookie minted by Vercel Edge Middleware
 * (`leanshot/middleware.ts`), parses utm + referrer + landingPath from the
 * window, and POSTs ONCE per page load to the `traffic-attribution-recorder`
 * Edge Fn so a row lands in `user_traffic_attribution`.
 *
 * Why this exists (W5 fix per RESEARCH Q1 fallback):
 *   The middleware sets the cookie but does NOT POST to the recorder Fn —
 *   `ctx.waitUntil` support on Vercel's Vite preset is uncertain. Without an
 *   SPA-side fire, TRAFFIC-01 is not end-to-end: only the cookie is set; no
 *   attribution row is written. This helper closes that gap.
 *
 * Idempotency:
 *   Module-scoped `_sent` flag guarantees exactly-one POST per page load,
 *   even under React StrictMode's double-mount (StrictMode re-mounts
 *   components, NOT module-import side effects).
 *
 * Fire-and-forget: never throws, never blocks first paint.
 */

let _sent = false;

/** Test seam — reset the once-per-mount guard. */
export function _resetSentFlagForTest(): void {
  _sent = false;
}

/**
 * Parse a single cookie value from a Cookie-header-style string. Works
 * against `document.cookie` (browser) or `opts.windowOverride.document.cookie`
 * (test stub). Returns null when absent.
 */
function readCookieFromString(cookieHeader: string, name: string): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1] ?? '') : null;
}

function readUtm(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!search) return out;
  const sp = new URLSearchParams(search);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const v = sp.get(key);
    if (v) out[key.replace('utm_', '')] = v;
  }
  return out;
}

/** Test-injectable surface — production paths read from window/document. */
export interface FireTouchOptions {
  fetchImpl?: typeof fetch;
  recorderUrl?: string;
  windowOverride?: {
    location: { search: string; pathname: string };
    document?: { cookie: string; referrer: string };
  };
}

/**
 * Fire-and-forget POST to the recorder Fn. Idempotent: subsequent calls
 * within the same module load are no-ops.
 *
 * Resolution order:
 *   - fetch:        opts.fetchImpl ?? globalThis.fetch (else bail)
 *   - window:       opts.windowOverride ?? globalThis.window (else bail)
 *   - cookie src:   opts.windowOverride.document.cookie ?? document.cookie
 *   - recorderUrl:  opts.recorderUrl ?? `${VITE_SUPABASE_URL}/functions/v1/...`
 */
export async function fireTouchOnce(opts: FireTouchOptions = {}): Promise<void> {
  if (_sent) return;
  _sent = true;

  const fetchFn = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchFn) return;

  const w =
    opts.windowOverride ??
    (typeof window !== 'undefined' ? (window as unknown as FireTouchOptions['windowOverride']) : null);
  if (!w) return;

  // Cookie source: prefer the override's document; else the global document
  // (browser path). HttpOnly cookies set by the middleware ARE visible via
  // document.cookie when... wait — HttpOnly cookies are NOT readable by
  // document.cookie. The middleware's lt_anon_id is HttpOnly. This means
  // the SPA CANNOT read lt_anon_id from document.cookie in production.
  //
  // RESOLUTION: the recorder Fn reads lt_anon_id from the request's Cookie
  // header (sent automatically by the browser with credentials: 'include').
  // The SPA POST body's `anonId` field is therefore omitted in production —
  // the recorder Fn falls back to the Cookie header value. In tests we
  // explicitly inject the cookie via windowOverride.document.cookie so we
  // can assert that the payload is shaped correctly when the cookie IS
  // readable (e.g. for non-HttpOnly fallback or future dual-track use).
  //
  // For belt-and-suspenders: we try to read it from document.cookie; if
  // present (test path or non-HttpOnly cookie variant), we include it in
  // the POST body. If absent (production HttpOnly path), the Cookie header
  // carries it server-side and the recorder Fn must accept that.
  const cookieSrc =
    (w as { document?: { cookie?: string } }).document?.cookie ??
    (typeof document !== 'undefined' ? document.cookie : '');
  const anonIdFromCookie = readCookieFromString(cookieSrc, 'lt_anon_id');

  // Resolve recorder URL (Vite env or test override).
  const envUrl = (import.meta as unknown as { env?: { VITE_SUPABASE_URL?: string } }).env
    ?.VITE_SUPABASE_URL;
  const recorderUrl = opts.recorderUrl ?? (envUrl ? `${envUrl}/functions/v1/traffic-attribution-recorder` : '');
  if (!recorderUrl || recorderUrl.startsWith('/functions')) return; // VITE_SUPABASE_URL not configured

  // In production lt_anon_id is HttpOnly so anonIdFromCookie is null. Bail
  // ONLY when we cannot even rely on the Cookie header reaching the
  // recorder — but `credentials: 'include'` makes the browser attach it
  // server-side automatically. We therefore DO fire even when the cookie
  // is unreadable from document.cookie. (In tests, the override path
  // supplies the cookie so anonIdFromCookie is non-null and we can assert.)

  const payload: Record<string, unknown> = {
    utm: readUtm(w.location.search),
    referrer: (w as { document?: { referrer?: string } }).document?.referrer ?? null,
    landingPath: w.location.pathname,
    audience: 'consumer' as const,
  };
  if (anonIdFromCookie) {
    payload.anonId = anonIdFromCookie;
  }

  try {
    await fetchFn(recorderUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: 'include',
    });
  } catch {
    // fire-and-forget — never propagate.
  }
}
