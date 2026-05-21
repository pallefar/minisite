/**
 * CORS headers for the `helpdesk-sla-breach-cron` Edge Function (Phase 37 Plan 37-05).
 *
 * Server-to-server only — invoked by the pg_cron `helpdesk-sla-breach-check`
 * schedule (migration 20270707000007, every 5 minutes) with service-role Bearer
 * from vault.decrypted_secrets.
 *
 * The Bearer == SUPABASE_SERVICE_ROLE_KEY check in the handler is the auth
 * gate. CORS exists only for misconfigured curl-ish preflights.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
