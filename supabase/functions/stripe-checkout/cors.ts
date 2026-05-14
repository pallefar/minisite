/**
 * CORS headers for the `stripe-checkout` Edge Function (Phase 14 Plan 14-04).
 *
 * Mirrors `clinic-invite/cors.ts` verbatim — Access-Control-Allow-Origin: '*' is
 * intentional because the JWT (Bearer) header is the auth gate for all calls.
 * Pitfall #11 explicitly notes no cookies are set or read here.
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
