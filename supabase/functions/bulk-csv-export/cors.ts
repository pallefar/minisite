/**
 * CORS headers for the `bulk-csv-export` Edge Function (Phase 10 Plan 10-10).
 *
 * Mirrors `clinic-snapshot/cors.ts`. JWT (Bearer) is the auth gate; no cookies;
 * Access-Control-Allow-Origin: '*' is intentional and acceptable (JWT auth, no
 * cookies, so CORS wildcard is safe per Pitfall #11).
 *
 * Cache-Control: private, no-store is included in BASE_CSV_HEADERS to prevent
 * CDN/proxy caching of sensitive patient symptom CSV data.
 */

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

/**
 * Base headers for JSON error responses.
 */
export const BASE_JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',
  ...corsHeaders,
};
