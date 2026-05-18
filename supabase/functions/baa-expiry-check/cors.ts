/**
 * CORS headers for baa-expiry-check Edge Function.
 * Cron-only invocation — OPTIONS preflight included for completeness.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
