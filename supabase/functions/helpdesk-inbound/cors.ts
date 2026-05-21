/**
 * CORS headers for the `helpdesk-inbound` Edge Function (Phase 37 Plan 37-03).
 *
 * Mirrors `clinic-invite/cors.ts` — Access-Control-Allow-Origin: '*' is fine
 * here because this Function is server-to-server (Resend Inbound webhook
 * delivery) and never invoked from a browser. The Svix signature in headers
 * is the auth gate; there are no cookies, no JWT.
 *
 * Allow svix-* headers explicitly so the Edge Runtime's preflight (if ever
 * triggered by a misconfigured client) doesn't block the actual POST.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-client-info, svix-id, svix-timestamp, svix-signature',
};
