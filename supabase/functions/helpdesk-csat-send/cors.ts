/**
 * CORS headers for the `helpdesk-csat-send` Edge Function (Phase 37 Plan 37-05).
 *
 * Server-to-server only — invoked by:
 *   - trg_helpdesk_on_ticket_close (migration 20270707000008) via pg_net.http_post
 *     with service-role Bearer from vault.decrypted_secrets.
 *
 * The Bearer == SUPABASE_SERVICE_ROLE_KEY check in the handler is the auth gate.
 * CORS exists only so misconfigured preflights from a curl-ish client don't
 * blackhole — no browser ever invokes this endpoint directly.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
