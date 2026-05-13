/**
 * CORS headers for the `clinic-invite` Edge Function (Phase 9 Plan 09-06).
 *
 * Mirrors `ai-chat/cors.ts` verbatim — Access-Control-Allow-Origin: '*' is
 * intentional because the JWT (Bearer) header is the auth gate for
 * operator-side calls (verified by Supabase Edge Runtime BEFORE our handler
 * runs), and the patient-side `/lookup` path is intentionally unauthenticated
 * (the invite-token-hash IS the auth secret). Pitfall #11 explicitly notes
 * Phase 8's CORS-with-credentials trap does NOT apply to Phase 9 Edge
 * Functions — no cookies are set or read here.
 *
 * `apikey` is in the allow-headers list because @supabase/supabase-js sends
 * it on every request; without it the SDK preflight would be blocked by the
 * browser's CORS check.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
