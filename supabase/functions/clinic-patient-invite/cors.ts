/**
 * CORS headers for clinic-patient-invite Edge Function.
 *
 * No credentials — public-callable routes (/preview, /accept) are anonymous.
 * /send is admin-gated via the SECDEF RPC Pattern S1 check, not HTTP credentials.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
