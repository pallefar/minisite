/**
 * CORS + base-response headers for the `affiliate-attribute` Edge Function.
 *
 * The /r/:code path is normally hit as a top-level navigation (not a CORS
 * fetch), so the practical security gate is the cookie + 302 response,
 * not CORS. But the function may also be called via XHR from the partner
 * dashboard (e.g. a "preview your referral link" feature in Plan 19-05/06)
 * and we never want `Access-Control-Allow-Origin: *` because that combo
 * with `Access-Control-Allow-Credentials: true` is forbidden by the spec.
 *
 * Pattern mirrors `share/cors.ts` (Phase 8) — echo the request Origin from
 * a server-side allowlist, otherwise emit the sentinel `'null'`.
 *
 * Security headers (V7/V9 from RESEARCH Security Domain):
 *   - `Cache-Control: private, no-store` — never let a CDN cache a 302
 *     response that carries a per-visitor cookie.
 *   - `X-Content-Type-Options: nosniff` — defensive on the 302 body.
 *   - `Vary: Origin, Cookie` — keys any intermediate cache by both.
 */

const ENV_LIST = (Deno.env.get('AFFILIATE_ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const ALLOWED_ORIGINS = new Set<string>([
  ...ENV_LIST,
  'https://leanshot.app',
  'https://www.leanshot.app',
  // Local dev fallback for partner-dashboard preview feature.
  'http://localhost:5173',
]);

// Vercel preview deploys are *.vercel.app — pattern-match to avoid enumerating.
const VERCEL_PREVIEW_PATTERN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

function isAllowedOrigin(origin: string): boolean {
  if (origin === '') return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (VERCEL_PREVIEW_PATTERN.test(origin)) return true;
  return false;
}

/**
 * Build CORS headers for this request. Echoes the request Origin only if
 * it's on the allowlist; otherwise emits the sentinel `'null'` to deny.
 *
 * Returns a Headers object (not a Record) because the index.ts handler
 * composes Headers and we want cheap merge via `new Headers(cors)`.
 */
export function buildCorsHeaders(origin: string | null): Headers {
  const allowed = origin !== null && isAllowedOrigin(origin);
  return new Headers({
    'Access-Control-Allow-Origin': allowed ? (origin ?? 'null') : 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin, Cookie',
  });
}

/**
 * Base response headers (applied to every response — 200, 302, 404, 500).
 * Cache-Control belongs here so even an error response stays uncacheable.
 */
export const BASE_RESPONSE_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

// Exposed for unit tests.
export const __internals = {
  isAllowedOrigin,
  VERCEL_PREVIEW_PATTERN,
  ALLOWED_ORIGINS,
};
