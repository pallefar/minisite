/**
 * CORS headers for the `partner-account-status` Edge Function (Phase 19 Plan 19-03).
 *
 * Same posture as `stripe-connect-onboard/cors.ts`: JWT is the auth gate.
 * The partner dashboard polls this every 10 minutes plus on window-focus
 * (Plan 19-06 StripeConnectOnboardingCard); fetches use `credentials: 'omit'`.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
