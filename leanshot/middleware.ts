/**
 * Phase 41 Plan 41-03 + Phase 51 Plan 51-02 + Phase 67 Plan 67-02 + Phase 68 Plan 68-04 — Vercel Edge Middleware.
 *
 * FIVE concerns wired into a single edge middleware:
 *
 *   (E) Phase 68-04 LAND-08 — UTM-default-landing 307 redirect
 *       When a visitor lands on root `/` with a `utm_source` query param that
 *       matches a row in the `utm_landing_defaults` table (e.g.
 *       `clinic_outreach` → `/for-clinics`), short-circuit with a 307
 *       Temporary Redirect to the mapped path. Original query params are
 *       PRESERVED so the redirected page still receives the full UTM tuple.
 *       Runs BEFORE rate-limit/cookie/CSP so it never spawns downstream work.
 *
 *       Architectural note: the resolver lives HERE (not in the
 *       `traffic-attribution-recorder` Edge Fn the plan first proposed) because
 *       the recorder fires from the SPA AFTER React mounts; a 307 from the Fn
 *       would arrive long after the wrong audience landing already painted.
 *       Middleware is the only true server-side request interceptor for SPA
 *       root landings.
 *
 *   (D) Phase 67-02 OPS-03 — per-IP rate-limit on hot public API routes
 *       In-memory token bucket guarding `/api/lead-capture` (30/min),
 *       `/api/og/*` (60/min), `/api/affiliate-impression` (10/min). Bucket
 *       state is per-instance (no Redis/Upstash) which is acceptable for
 *       v1.4 launch — Vercel Edge typically pins a hot path to a small
 *       number of regional instances, so the per-IP window holds well
 *       enough in practice. Upgrade to Upstash/Cloudflare KV in v1.5
 *       (Phase 70+) for true cross-instance correctness.
 *       Sends 429 + `Retry-After` when exceeded. Rate-limit is the FIRST
 *       check in the handler — no CSP / cookie work runs when 429ed.
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
import {
  filterBlocklisted,
  appendAdNetworkHosts,
  type CspAllowRow,
} from './src/lib/ads/cspGenerator';

// `Config` is the Vercel convention shape — defining locally because
// @vercel/edge v1.3.1 does not re-export a public `Config` type.
type Config = { matcher: string | string[] };

export const config: Config = {
  // Global catch-all minus static paths PLUS the three rate-limit-protected
  // /api/* routes from Phase 67-02 (OPS-03). The original regex EXCLUDES
  // /api/* so existing CSP/cookie augmentation never runs on JSON/image
  // responses; the explicit additions below let the rate-limiter (D) inspect
  // those requests without changing the CSP/cookie behavior — the handler
  // early-returns for /api/* after the rate-limit check.
  matcher: [
    '/((?!api|_next/static|assets|favicon).*)',
    '/api/lead-capture',
    '/api/og/:path*',
    '/api/affiliate-impression',
  ],
};

// =====================================================================
// (D) Phase 67 Plan 67-02 — In-memory rate-limit token buckets (OPS-03)
// =====================================================================

/**
 * Per-IP rate-limit policy. Path matching is PREFIX-based: any incoming
 * request whose pathname starts with one of these keys is gated.
 *   - /api/lead-capture           → 30/min   (form submit, low natural volume)
 *   - /api/og/                    → 60/min   (image render, moderate)
 *   - /api/affiliate-impression   → 10/min   (pixel, tight gate vs abuse)
 *
 * Limits derived from Phase 67 D-04 + expected production traffic mix in
 * `leanshot/.planning/runbooks/load-test-baseline.md` (Phase 67-02 OPS-02).
 */
const RATE_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  '/api/lead-capture': { limit: 30, windowMs: 60_000 },
  '/api/og/': { limit: 60, windowMs: 60_000 },
  '/api/affiliate-impression': { limit: 10, windowMs: 60_000 },
};

/**
 * Module-level token-bucket store. Per-Edge-instance — NOT shared across
 * regions or cold-start replacements. Acceptable for v1.4 launch; upgrade
 * to Upstash Redis in v1.5 (Phase 70+ tech-debt) for cross-instance
 * correctness.
 *
 * Bucket key shape: `<ip>:<route-prefix>`. Map is unbounded but bounded
 * IN PRACTICE by the routes × distinct-IPs in any one window; a stale
 * bucket entry is reset lazily on its next read (resetAt check). No
 * explicit eviction needed for the 60s window scale.
 */
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

/** Match request path → rate-limit policy. Returns null when not gated. */
function matchRateLimit(
  pathname: string,
): { prefix: string; limit: number; windowMs: number } | null {
  for (const [prefix, policy] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(prefix)) {
      return { prefix, ...policy };
    }
  }
  return null;
}

/** Best-effort client IP. Honors `x-forwarded-for` first hop. */
function readClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Apply rate-limit + return a 429 response when over-limit. Returns null
 * when the request should pass through. Side-effects the bucket map.
 */
function enforceRateLimit(req: Request, pathname: string): Response | null {
  const policy = matchRateLimit(pathname);
  if (!policy) return null;

  const ip = readClientIp(req);
  const key = `${ip}:${policy.prefix}`;
  const now = Date.now();

  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + policy.windowMs };
  }
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  if (bucket.count > policy.limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return new Response('Too Many Requests', {
      status: 429,
      headers: {
        'Retry-After': retryAfter.toString(),
        'X-RateLimit-Limit': policy.limit.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': Math.ceil(bucket.resetAt / 1000).toString(),
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }

  // Under-limit — fall through. (Could attach X-RateLimit-* observability
  // headers on the eventual response, but the response object is constructed
  // inside next() AFTER this function returns; revisit in v1.5 once we have
  // an explicit X-RateLimit-* contract and can pipe metadata back.)
  return null;
}

const CACHE_TTL_MS = 60_000;
let cache: { hosts: string[]; expiresAt: number } | null = null;

// =====================================================================
// Phase 68 Plan 68-04 — UTM-default-landing resolver (LAND-08)
// SEPARATE module-level cache — does not share state with iframe / ad CSP caches.
// Maps utm_source → landing_path. Mirrors the iframe_allowlist fetch shape
// (anon-key SELECT, 60s TTL, fail-safe to empty map on error).
// =====================================================================
let utmLandingCache: { map: Record<string, string>; expiresAt: number } | null = null;

async function fetchUtmLandingDefaults(
  supabaseUrl: string,
  anonKey: string,
): Promise<Record<string, string>> {
  const url = `${supabaseUrl}/rest/v1/utm_landing_defaults?select=utm_source,landing_path`;
  const res = await fetch(url, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  });
  if (!res.ok) {
    throw new Error(`utm_landing_defaults fetch ${res.status}`);
  }
  const rows = (await res.json()) as Array<{
    utm_source?: unknown;
    landing_path?: unknown;
  }>;
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (
      typeof r.utm_source === 'string' &&
      r.utm_source.length > 0 &&
      typeof r.landing_path === 'string' &&
      r.landing_path.startsWith('/')
    ) {
      out[r.utm_source] = r.landing_path;
    }
  }
  return out;
}

/**
 * Resolve the inbound request against `utm_landing_defaults` and return a
 * 307 redirect Response when the resolver matches. Returns null otherwise
 * (request should fall through to the rest of the middleware pipeline).
 *
 * Match conditions (ALL must hold):
 *   1. Pathname is exactly `/` (root landing only — internal links to
 *      `/for-clinics` etc. must NOT be re-redirected).
 *   2. Query param `utm_source` is present.
 *   3. `utm_source` value maps to a `landing_path` in the cache.
 *
 * Preserves all original query params on the redirect URL so the destination
 * page still records the full UTM tuple via the recorder Fn.
 *
 * Fail-safe: any fetch error returns null (resolver disabled) — the user
 * sees the generic root landing instead of an error page.
 *
 * Test seam: `setUtmLandingCacheForTest` lets the integration tests inject a
 * synthetic mapping without hitting the network.
 */
export async function maybeRedirectUtmLanding(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
): Promise<Response | null> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null; // malformed URL — let downstream handle
  }

  // Gate 1: root-pathname only.
  if (url.pathname !== '/') return null;

  // Gate 2: utm_source present.
  const utmSource = url.searchParams.get('utm_source');
  if (!utmSource) return null;

  // Resolve map (env-gated; missing env → fail-safe no-op).
  if (!supabaseUrl || !anonKey) return null;

  let map: Record<string, string>;
  try {
    const now = Date.now();
    if (!utmLandingCache || utmLandingCache.expiresAt <= now) {
      const fresh = await fetchUtmLandingDefaults(supabaseUrl, anonKey);
      utmLandingCache = { map: fresh, expiresAt: now + CACHE_TTL_MS };
    }
    map = utmLandingCache.map;
  } catch (err) {
    console.warn(
      'middleware: utm_landing_defaults fetch failed; falling through (Phase 68-04)',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  const landingPath = map[utmSource];
  if (!landingPath) return null; // unknown source → pass-through

  // Build the redirect URL: clone the original URL, swap pathname, preserve
  // all query params (including utm_source itself so the recorder Fn still
  // sees the full UTM tuple after the redirect).
  const dest = new URL(request.url);
  dest.pathname = landingPath;

  return new Response(null, {
    status: 307,
    headers: {
      Location: dest.toString(),
      // No-cache so an aborted A/B test (utm_landing_defaults row removed)
      // surfaces immediately rather than after a CDN TTL.
      'Cache-Control': 'no-store',
    },
  });
}

/** Test seam — inject a synthetic utm_landing_defaults map. */
export function setUtmLandingCacheForTest(
  map: Record<string, string> | null,
): void {
  utmLandingCache =
    map === null
      ? null
      : { map, expiresAt: Date.now() + CACHE_TTL_MS };
}

// =====================================================================
// Phase 56 Plan 04 — Ad-network CSP cache (AD-09)
// SEPARATE module-level cache — does not share state with iframe cache.
// =====================================================================
let adCspCache: {
  scriptHosts: string[];
  connectHosts: string[];
  expiresAt: number;
} | null = null;

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
// Phase 56 Plan 04 — Ad-network CSP fetch (AD-09)
// Fetches ad_csp_allowlist (enabled rows) + ad_advertiser_blocklist,
// applies filterBlocklisted, and splits by directive.
// T-56-12: any fetch error returns empty host sets (fail-safe — no ad
// hosts enter the CSP rather than a permissive fallback).
// T-56-13: reads only hostname/directive columns via anon key (same
// surface exposure as existing iframe_allowlist fetch).
// =====================================================================
async function fetchAdCspHosts(
  supabaseUrl: string,
  anonKey: string,
): Promise<{ scriptHosts: string[]; connectHosts: string[] }> {
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
  };

  const [allowRes, blockRes] = await Promise.all([
    fetch(
      `${supabaseUrl}/rest/v1/ad_csp_allowlist?select=hostname,directive&enabled=eq.true`,
      { headers },
    ),
    fetch(`${supabaseUrl}/rest/v1/ad_advertiser_blocklist?select=hostname`, {
      headers,
    }),
  ]);

  if (!allowRes.ok) {
    throw new Error(`ad_csp_allowlist fetch ${allowRes.status}`);
  }
  if (!blockRes.ok) {
    throw new Error(`ad_advertiser_blocklist fetch ${blockRes.status}`);
  }

  const allowRows = (await allowRes.json()) as Array<{
    hostname?: unknown;
    directive?: unknown;
  }>;
  const blockRows = (await blockRes.json()) as Array<{ hostname?: unknown }>;

  const allowParsed: CspAllowRow[] = allowRows.flatMap((r) => {
    if (
      typeof r.hostname !== 'string' ||
      !r.hostname ||
      (r.directive !== 'script-src' && r.directive !== 'connect-src')
    ) {
      return [];
    }
    return [{ hostname: r.hostname, directive: r.directive }];
  });

  const blockList = blockRows
    .map((r) => (typeof r.hostname === 'string' ? r.hostname : null))
    .filter((h): h is string => !!h && h.length > 0);

  // T-56-11: GLP-1 competitor hosts structurally excluded BEFORE append.
  const filtered = filterBlocklisted(allowParsed, blockList);

  const scriptHosts = filtered
    .filter((r) => r.directive === 'script-src')
    .map((r) => r.hostname);
  const connectHosts = filtered
    .filter((r) => r.directive === 'connect-src')
    .map((r) => r.hostname);

  return { scriptHosts, connectHosts };
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
  // =====================================================================
  // (E) Phase 68 Plan 68-04 — UTM-default-landing resolver (LAND-08)
  //
  // Runs FIRST — before rate-limit, cookie mint, and CSP augmentation —
  // because a matching redirect short-circuits the whole pipeline. The
  // destination page (e.g. /for-clinics) will run through middleware()
  // fresh on the client's follow-up request and pick up cookies / CSP /
  // rate-limit there.
  //
  // No-op when pathname != '/' OR utm_source missing OR no matching row OR
  // env vars unset (fail-safe per [[reference_vercel_json_no_env_interpolation]]).
  // =====================================================================
  try {
    const utmRedirect = await maybeRedirectUtmLanding(
      request,
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_ANON_KEY ?? '',
    );
    if (utmRedirect) return utmRedirect;
  } catch (err) {
    // NEVER let the resolver break the page response.
    console.warn(
      'middleware: utm landing resolver threw; falling through (Phase 68-04)',
      err instanceof Error ? err.message : String(err),
    );
  }

  // =====================================================================
  // (D) Phase 67 Plan 67-02 — Rate-limit gate (OPS-03)
  //
  // Runs BEFORE next() so we never spawn an Edge Fn invocation / Vercel
  // function call for a rate-limited request. Returns 429 short-circuit
  // when over-limit; otherwise falls through.
  // =====================================================================
  let pathname = '';
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    // Malformed URL — skip rate-limit check (the downstream handler will
    // return its own error). Avoid throwing here so a bad URL never
    // surfaces a 500 from middleware itself.
  }
  if (pathname) {
    const rateLimitResponse = enforceRateLimit(request, pathname);
    if (rateLimitResponse) return rateLimitResponse;
  }

  const response = await next();

  // /api/* routes are matched ONLY for rate-limiting (added explicitly to
  // the matcher in Phase 67-02). Skip the CSP/cookie augmentation below —
  // those produce JSON/image responses that have no CSP and no cookie
  // mint requirement.
  if (pathname.startsWith('/api/')) {
    return response;
  }

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

    // (A2) Ad-network allowlist augmentation — script-src + connect-src (Phase 56-04 AD-09)
    // Parallel to the iframe_allowlist fetch above; uses a SEPARATE cache.
    // T-56-12 fail-safe: any fetch error → serve CSP WITHOUT ad-network hosts.
    try {
      const now = Date.now();
      if (!adCspCache || adCspCache.expiresAt <= now) {
        const { scriptHosts, connectHosts } = await fetchAdCspHosts(
          supabaseUrl,
          anonKey,
        );
        adCspCache = { scriptHosts, connectHosts, expiresAt: now + CACHE_TTL_MS };
      }
      csp = appendAdNetworkHosts(
        csp,
        adCspCache.scriptHosts,
        adCspCache.connectHosts,
      );
    } catch (err) {
      // Fail-safe: surface in logs, serve CSP without ad-network hosts.
      console.warn(
        'CSP middleware: ad_csp_allowlist fetch failed; serving CSP without ad-network hosts',
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
