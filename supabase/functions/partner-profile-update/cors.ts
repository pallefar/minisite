/**
 * CORS headers for the `partner-profile-update` Edge Function (Phase 19 Plan 19-06b).
 *
 * Mirrors `stripe-connect-onboard/cors.ts` — `Access-Control-Allow-Origin: '*'`
 * is intentional because the Bearer JWT (header) is the auth gate. Callers
 * (PartnerCustomizeForm) use `credentials: 'omit'`; no cookies cross the
 * boundary.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
