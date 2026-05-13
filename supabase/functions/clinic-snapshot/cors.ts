/**
 * CORS headers for the `clinic-snapshot` Edge Function (Phase 10 Plan 10-04).
 *
 * Mirrors `ai-chat/cors.ts` and `clinic-photo/cors.ts`. JWT (Bearer) is the
 * auth gate; no cookies; Access-Control-Allow-Origin: '*' is intentional
 * and acceptable (Pitfall #11 from Phase 9 pattern).
 *
 * JWT is the security boundary — the function validates the operator JWT via
 * admin.auth.getUser(), membership check, and has_permission() before serving
 * any data. CORS wildcard is acceptable because credentials (JWT) travel in
 * the Authorization header, not as cookies, and the browser won't restrict
 * cross-origin Authorization headers under wildcard ACAO.
 *
 * Cache-Control: private, no-store is NOT set here (it belongs in
 * BASE_RESPONSE_HEADERS used by every response path). See index.ts.
 */

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

/**
 * Base headers applied to every response (200, 4xx, 5xx, OPTIONS).
 * Cache-Control: private, no-store is required on EVERY status code per
 * Phase 8 SHARE-03 pattern (T-10-04-03 mitigation — no CDN/proxy caching of
 * sensitive patient snapshot data).
 */
export const BASE_RESPONSE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',
  ...corsHeaders,
};
