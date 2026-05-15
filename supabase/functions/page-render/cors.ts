/**
 * CORS headers for the `page-render` Edge Function.
 *
 * **Why fully-public `*` (deviation from `share`):** published landing pages
 * are anonymous (D-10). No cookies, no JWT, no per-user data — every
 * response is identical for the same slug + revision. The browser's
 * `Allow-Origin: *` + no-credentials combo is the correct posture for a
 * pure GET-of-public-HTML surface (T-15-03-05 in the threat model). This
 * is the opposite of `share/cors.ts` which echoes Origin + sends
 * `Allow-Credentials: true` for cookie auth.
 *
 * **Vary: Accept-Encoding** is set per-response in `index.ts` (alongside
 * `Cache-Control: public, s-maxage=60, stale-while-revalidate=86400`).
 * `Content-Type` is also set per-response there (text/html for HTML, not
 * the JSON default below).
 *
 * **BASE_RESPONSE_HEADERS** is kept minimal here — `index.ts` overrides
 * Content-Type and adds Cache-Control for the success/404 path.
 */

export function buildCorsHeaders(_req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  };
}

/**
 * Base response headers. Intentionally minimal — Content-Type, Cache-Control,
 * and Vary are set per-response in `index.ts` because they differ between
 * the HTML success path, the 404 path, the OPTIONS preflight, and 500 errors.
 */
export const BASE_RESPONSE_HEADERS: Record<string, string> = {};
