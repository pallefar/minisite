/**
 * CORS headers for the `helpdesk-ai-assist` Edge Function (Phase 37 Plan 37-04).
 *
 * Server-to-server only — invoked by:
 *   - helpdesk-inbound (Plan 37-03, fire-and-forget) with service-role Bearer
 *   - the agent inbox (Plan 37-07) via Realtime trigger with service-role Bearer
 *
 * The Bearer == SUPABASE_SERVICE_ROLE_KEY check in the handler is the auth gate.
 * There are no browsers, cookies, or JWTs on the caller side; CORS exists only
 * so that misconfigured preflights from a curl-ish client don't blackhole.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
