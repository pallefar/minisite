/**
 * CORS headers for the `helpdesk-agent-reply-send` Edge Function
 * (Phase 37 Plan 37-07 — HELP-04 agent-reply send path).
 *
 * Auth model: BOTH service-role Bearer (server-internal) AND session JWT
 * (called directly from the admin frontend) are accepted by the handler.
 *   - The JWT path needs CORS for the browser preflight to succeed.
 *   - The service-role path only needs CORS in case a curl-ish caller hits
 *     the OPTIONS preflight before its POST.
 *
 * In addition to the standard headers, we expose `authorization, apikey,
 * content-type, x-client-info` because the supabase-js client sends an
 * `apikey` header alongside `authorization` even when the call originates
 * from the browser.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
