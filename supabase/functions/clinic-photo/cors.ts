/**
 * CORS headers for the `clinic-photo` Edge Function (Phase 9 Plan 09-07).
 *
 * Mirrors `ai-chat/cors.ts` and `clinic-invite/cors.ts`. JWT (Bearer)
 * is the auth gate; no cookies; Access-Control-Allow-Origin: '*' is
 * intentional and acceptable per Pitfall #11.
 *
 * The clinic-photo Edge Function authorizes via D-12 three-check gate
 * (operator membership + role permission + patient consent_scope.photos)
 * inside the handler. The signed URL response is short-lived (5min, D-13).
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
