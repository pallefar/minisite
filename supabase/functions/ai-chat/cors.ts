/**
 * CORS headers for the `ai-chat` Edge Function.
 *
 * Phase 4 T-04-07 mitigation: `Access-Control-Allow-Origin: '*'` is
 * intentional and acceptable because the JWT (Bearer) header is the auth
 * gate — Supabase Edge Runtime verifies it BEFORE our handler runs (per
 * RESEARCH §2 line 1067 + PATTERNS line 328). Allow-list-ing Origins
 * would break legitimate cross-Vercel-project requests (the marketing
 * site can't talk to the function today, but Phase 5+ may need a shared
 * client to call from either origin).
 *
 * `apikey` is in the allow-headers list because `@supabase/supabase-js`
 * sends it on every request — without it the SDK request would be
 * blocked by the browser's CORS preflight.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
