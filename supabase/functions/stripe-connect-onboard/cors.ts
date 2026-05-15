/**
 * CORS headers for the `stripe-connect-onboard` Edge Function (Phase 19 Plan 19-03).
 *
 * Mirrors `stripe-checkout/cors.ts` (Phase 14) — Access-Control-Allow-Origin: '*'
 * is intentional because the JWT (Bearer) header is the auth gate. The partner
 * dashboard StripeConnectOnboardingCard (Plan 19-06) calls this via fetch with
 * `credentials: 'omit'`, so no cookies cross the boundary; `*` is compliant
 * with the CORS spec.
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
