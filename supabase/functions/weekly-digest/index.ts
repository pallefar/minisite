/**
 * `weekly-digest` Edge Function — Phase 38 Plan 38-05 (RECOMMEND-05 + RECOMMEND-07).
 *
 * Pre-implementation skeleton (TDD RED). Implementation lands in Task 1 GREEN.
 */
import { jsonError, jsonResponse, corsHeaders } from '../_shared/lifecycle-utils.ts';

// TEMP: minimal serve handler to keep deno check passing while tests are RED.
// Replaced wholesale in GREEN step.
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  return jsonError(501, 'not_implemented');
});
