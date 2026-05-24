/**
 * Phase 41 Plan 41-03 + Phase 51 Plan 51-02 — Vercel Edge Middleware.
 *
 * THREE augmentations applied to every HTML response that flows through Vercel:
 *
 *   (A) D-14 dynamic Custom-iframe frame-src injection   [Phase 41-03]
 *       Fetches the public `iframe_allowlist` hostnames (Plan 41-02 schema)
 *       from Supabase REST every 60s (in-memory cache) and appends them as
 *       `https://<hostname>` entries to the existing `frame-src` directive
 *       of the static CSP defined in vercel.json. Fail-safe: any fetch error
 *       returns the response unaugmented (the in-browser CSP block becomes
 *       the degraded fallback for Custom-iframe blocks — Calendly/YouTube/
 *       Tally remain functional via the static allowlist).
 *
 *   (B) D-11/D-13 CSP-violation reporting endpoint assembly   [Phase 41-03]
 *       Reads `process.env.VITE_SENTRY_CSP_REPORT_URI` at request time
 *       (vercel.json CANNOT interpolate VITE_* env literals — see memory
 *       `reference_vercel_json_no_env_interpolation`). When set, appends
 *       `report-uri <url>; report-to csp-endpoint;` to the CSP string AND
 *       sets the JSON `Report-To` response header. When unset, both are
 *       omitted (preview branches without Sentry env work cleanly).
 *
 *   (C) TRAFFIC-02 lt_anon_id cookie mint   [Phase 51-02]
 *       Mints (or refreshes) a `lt_anon_id` HttpOnly+Secure+SameSite=Lax
 *       cookie before the SPA HTML response leaves the edge. The SPA reads
 *       this cookie at first React mount (`leanshot/src/lib/traffic/
 *       fire-touch.ts`) and POSTs to `traffic-attribution-recorder` so a
 *       row lands in `user_traffic_attribution`. Refreshing on every visit
 *       maintains a 90d sliding window (D-04). For `/share/clinic-<slug>`
 *       landings, also sets a transient `lt_clinic_slug_seen` cookie
 *       (5 min) so the recorder Fn can resolve slug → org_id (D-12).
 *
 *       NO `Domain=` attribute (scoping to request host avoids hash-route
 *       SPA cookie-domain interaction). NO `npm:uuid` — uses Edge runtime
 *       built-in `crypto.randomUUID()`.
 *
 * The matcher EXCLUDES `/api`, `/_next/static`, `/assets`, and `/favicon` —
 * the Vercel rewrites for `/api/calendly/oauth-*` (Plan 41-04) bypass this
 * middleware as intended.
 *
 * Behavior contract: see `leanshot/tests/integration/csp-middleware.test.ts`
 * (Phase 41-03, 7 cases) and Plan 51-10's `middleware-cookie.test.ts`
 * (Phase 51-02 — cookie-set behavior).
 */
import { next } from '@vercel/edge';

// `Config` is the Vercel convention shape — defining locally because
// @vercel/edge v1.3.1 does not re-export a public `Config` type.
type Config = { matcher: string | string[] };

export const config: Config = {
  matcher: ['/((?!api|_next/static|assets|favicon).*)'],
};

const CACHE_TTL_MS = 60_000;
let cache: { hosts: string[]; expiresAt: number } | null = null;

async function fetchAllowlistHosts(
  supabaseUrl: string,
  anonKey: string,
): Promise<string[]> {
  const url = `${supabaseUrl}/rest/v1/iframe_allowlist?select=hostname`;
  const res = await fetch(url, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  });
  if (!res.ok) {
    throw new Error(`iframe_allowlist fetch ${res.status}`);
  }
  const rows = (await res.json()) as Array<{ hostname?: unknown }>;
  return rows
    .map((r) => (typeof r.hostname === 'string' ? r.hostname : null))
    .filter((h): h is string => !!h && h.length > 0);
}

/**
 * Append the allowlisted hosts (as `https://<host>`) to the existing
 * `frame-src` directive value. Anchored on the `;` terminator — only the
 * `frame-src ...;` substring is replaced; other directives are untouched.
 *
 * When `hosts` is empty, returns the input CSP unchanged (no orphan
 * whitespace, no empty append). D-15 enforcement: hostnames are EXACT
 * (no wildcard) — we prepend `https://` and leave the rest as-is.
 */
function appendFrameSrcHosts(csp: string, hosts: string[]): string {
  if (hosts.length === 0) return csp;
  const formatted = hosts.map((h) => `https://${h}`).join(' ');
  return csp.replace(/frame-src ([^;]+);/, (_match, dirs: string) => {
    return `frame-src ${dirs.trim()} ${formatted};`;
  });
}

// =====================================================================
// Phase 51 Plan 51-02 — lt_anon_id cookie helpers (TRAFFIC-02)
// =====================================================================

const LT_ANON_COOKIE = 'lt_anon_id';
const LT_CLINIC_SLUG_COOKIE = 'lt_clinic_slug_seen';
/** 90 days — D-04 sliding window; longest plausible attribution window fits within cookie life. */
const LT_ANON_MAX_AGE_S = 60 * 60 * 24 * 90;
/** 5 minutes — recorder Fn resolves slug→org_id on the next request (D-12). */
const LT_CLINIC_SLUG_MAX_AGE_S = 60 * 5;
/** Matches `/share/clinic-<slug>` with optional trailing slash. Slug is lowercase alnum + dash. */
const CLINIC_SHARE_PATH_RE = /^\/share\/clinic-([a-z0-9-]+)\/?$/;

/**
 * Parse the inbound `Cookie` request header to read an existing
 * `lt_anon_id`. Returns null when not present or malformed.
 */
function readRequestCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  const m = raw.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1] ?? '') : null;
}

/**
 * Build a `Set-Cookie` header value with HttpOnly+Secure+SameSite=Lax.
 * NO `Domain=` attribute per project memory `reference_supabase_auth_traps`
 * (hash-route SPA cookie-domain interaction).
 */
function buildSetCookie(name: string, value: string, maxAgeSeconds: number): string {
  return (
    `${name}=${encodeURIComponent(value)}; ` +
    `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
  );
}

export default async function middleware(request: Request): Promise<Response> {
  const response = await next();

  // =====================================================================
  // (C) TRAFFIC-02 — lt_anon_id cookie mint (Phase 51 Plan 51-02)
  //
  // Run BEFORE the CSP early-return so the cookie ALSO lands on responses
  // that have no CSP header (rare static-asset edge case). Cookie mint is
  // independent of CSP augmentation.
  // =====================================================================
  try {
    const existingAnon = readRequestCookie(request, LT_ANON_COOKIE);
    // Edge runtime built-in — no `npm:uuid` per RESEARCH anti-patterns.
    const anonId = existingAnon ?? crypto.randomUUID();
    // ALWAYS (re)set on every visit to refresh the 90d sliding window.
    response.headers.append(
      'Set-Cookie',
      buildSetCookie(LT_ANON_COOKIE, anonId, LT_ANON_MAX_AGE_S),
    );

    // D-12 — /share/clinic-<slug> landing also gets a transient slug-seen
    // cookie so the recorder Fn can resolve slug → org_id on the next
    // POST. 5-min TTL (one mount cycle is plenty).
    try {
      const url = new URL(request.url);
      if (CLINIC_SHARE_PATH_RE.test(url.pathname)) {
        const m = url.pathname.match(CLINIC_SHARE_PATH_RE);
        const slug = m ? m[1] : null;
        if (slug) {
          response.headers.append(
            'Set-Cookie',
            buildSetCookie(LT_CLINIC_SLUG_COOKIE, slug, LT_CLINIC_SLUG_MAX_AGE_S),
          );
        }
      }
    } catch {
      // Malformed request URL — bail on the slug cookie but keep lt_anon_id.
    }
  } catch (err) {
    // NEVER let cookie mint break the page response. Log and continue.
    console.warn(
      'middleware: lt_anon_id cookie mint failed (Phase 51-02)',
      err instanceof Error ? err.message : String(err),
    );
  }

  // =====================================================================
  // (A) + (B) CSP augmentation (Phase 41 Plan 41-03) — unchanged
  // =====================================================================

  let csp = response.headers.get('content-security-policy') ?? '';
  // No CSP on this response (e.g. static asset slipped through the matcher)
  // → return as-is (the lt_anon_id cookie above is already attached).
  if (csp === '') return response;

  // (A) Allowlist augmentation (env-gated per W11).
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
  if (!supabaseUrl || !anonKey) {
    console.warn('CSP middleware: env vars missing, returning unaugmented CSP');
  } else {
    try {
      const now = Date.now();
      if (!cache || cache.expiresAt <= now) {
        const hosts = await fetchAllowlistHosts(supabaseUrl, anonKey);
        cache = { hosts, expiresAt: now + CACHE_TTL_MS };
      }
      csp = appendFrameSrcHosts(csp, cache.hosts);
    } catch (err) {
      // Fail-safe: surface the error in logs, return UNAUGMENTED CSP.
      console.warn(
        'CSP middleware: iframe_allowlist fetch failed; serving unaugmented CSP',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // (B) report-uri assembly (independent env-gate per B4).
  const reportUri = process.env.VITE_SENTRY_CSP_REPORT_URI ?? '';
  if (reportUri) {
    csp = csp.trimEnd();
    if (csp.endsWith(';')) {
      csp = `${csp} report-uri ${reportUri}; report-to csp-endpoint;`;
    } else {
      csp = `${csp}; report-uri ${reportUri}; report-to csp-endpoint;`;
    }
    response.headers.set(
      'Report-To',
      JSON.stringify({
        group: 'csp-endpoint',
        max_age: 10886400,
        endpoints: [{ url: reportUri }],
      }),
    );
  }

  response.headers.set('content-security-policy', csp);
  return response;
}
