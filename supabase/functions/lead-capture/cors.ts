/**
 * CORS headers for the `lead-capture` Edge Function (Phase 15 Plan 15-07).
 *
 * Mirrors `clinic-invite/cors.ts` shape verbatim:
 *   - Access-Control-Allow-Origin: '*'
 *   - Access-Control-Allow-Methods: 'POST, OPTIONS'
 *   - Access-Control-Allow-Headers: 'authorization, apikey, content-type, x-client-info'
 *   - NO Access-Control-Allow-Credentials — the public form POST is fully
 *     unauthenticated (verify_jwt=false; no cookies).
 *
 * The form POST is rendered into static HTML by `page-render/render.ts` and
 * targets `/functions/v1/lead-capture/submit` from any origin a published
 * landing page is hosted on. Wildcard origin keeps the contract simple; the
 * spam-guard is the honeypot + per-IP rate-limit, not origin.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
