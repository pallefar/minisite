/**
 * CORS headers for the `patient-activity` Edge Function (Phase 10 Plan 10-09).
 *
 * Mirrors `clinic-snapshot/cors.ts`. JWT (Bearer) is the auth gate — the
 * function validates the patient's JWT before returning any audit rows.
 * CORS wildcard is acceptable because credentials travel in the Authorization
 * header, not as cookies.
 *
 * Cache-Control: private, no-store is applied via BASE_RESPONSE_HEADERS on
 * EVERY response path (200, 4xx, 5xx, OPTIONS) per Phase 8 SHARE-03 pattern.
 */

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

/**
 * Base headers applied to every response.
 * Cache-Control: private, no-store is MANDATORY on every status code per
 * T-10-09-01 mitigation (no CDN/proxy caching of patient audit rows).
 */
export const BASE_RESPONSE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',
  ...corsHeaders,
};
