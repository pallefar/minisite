/**
 * Phase 41 Plan 41-03 — Vercel Edge Middleware (D-11 + D-14).
 *
 * Two augmentations applied to every HTML response that flows through Vercel:
 *
 *   (A) D-14 dynamic Custom-iframe frame-src injection
 *       Fetches the public `iframe_allowlist` hostnames (Plan 41-02 schema)
 *       from Supabase REST every 60s (in-memory cache) and appends them as
 *       `https://<hostname>` entries to the existing `frame-src` directive
 *       of the static CSP defined in vercel.json. Fail-safe: any fetch error
 *       returns the response unaugmented (the in-browser CSP block becomes
 *       the degraded fallback for Custom-iframe blocks — Calendly/YouTube/
 *       Tally remain functional via the static allowlist).
 *
 *   (B) D-11/D-13 CSP-violation reporting endpoint assembly
 *       Reads `process.env.VITE_SENTRY_CSP_REPORT_URI` at request time
 *       (vercel.json CANNOT interpolate VITE_* env literals — see memory
 *       `reference_vercel_json_no_env_interpolation`). When set, appends
 *       `report-uri <url>; report-to csp-endpoint;` to the CSP string AND
 *       sets the JSON `Report-To` response header. When unset, both are
 *       omitted (preview branches without Sentry env work cleanly).
 *
 * The matcher EXCLUDES `/api`, `/_next/static`, `/assets`, and `/favicon` —
 * the Vercel rewrites for `/api/calendly/oauth-*` (Plan 41-04) bypass this
 * middleware as intended.
 *
 * Behavior contract: see `leanshot/tests/integration/csp-middleware.test.ts`
 * — 7 test cases lock the augmentation, cache, env-gate, and fail-safe paths.
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

export default async function middleware(request: Request): Promise<Response> {
  const response = await next();

  let csp = response.headers.get('content-security-policy') ?? '';
  // No CSP on this response (e.g. static asset slipped through the matcher)
  // → return as-is, nothing to augment.
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
