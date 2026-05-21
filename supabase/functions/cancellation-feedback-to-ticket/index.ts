/**
 * Phase 40 Plan 40-04 (D-21) — cancellation-feedback-to-ticket Edge Fn.
 *
 * Called ONLY for reason='service_quality_issue' after cancellation commits.
 * Creates a P37 helpdesk ticket via create_ticket_with_first_message RPC.
 *
 * CRITICAL (Pitfall 4 + T-40-04-03): MUST forward user JWT, NOT service-role.
 * The RPC references auth.uid() internally — service-role call gets null auth.uid()
 * → raises 'unauthenticated' exception. Per 40-PATTERNS §14.
 *
 * Sentiment: hardcoded 'negative' for service_quality_issue per 40-PATTERNS §14 gotcha.
 * PHI flag: derived server-side by the RPC (not passed by caller).
 * Tags: ['cancellation-feedback', 'sentiment:negative'] applied post-insert.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonError, jsonResponse } from '../_shared/lifecycle-utils.ts';

const SUBJECT = 'Feedback from cancellation: service quality issue';
const DEFAULT_BODY = 'User cited service quality issue at cancellation. No additional detail.';
const MAX_BODY_CHARS = 4000;

let _createClient: typeof createClient = createClient;

export async function handler(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 1. Require user JWT (NOT service-role). Per Pitfall 4.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonError(401, 'unauthenticated');
  }
  const userJwt = authHeader.slice(7);

  // 2. Parse request body
  let body: { reason?: string; reason_other_text?: string };
  try {
    body = await req.json() as typeof body;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  // 3. Defensive reason validation — only handle service_quality_issue
  if (body.reason !== 'service_quality_issue') {
    return jsonError(400, 'wrong_reason');
  }

  // 4. Build ticket body — truncate defensively (≤4000 chars to prevent very long inputs)
  const rawBody = body.reason_other_text?.trim();
  const ticketBody = rawBody
    ? rawBody.slice(0, MAX_BODY_CHARS)
    : DEFAULT_BODY;

  // 5. Build user-context supabase client (user JWT forwarded — auth.uid() resolves)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const userClient: SupabaseClient = _createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });

  // 6. Call SECDEF RPC with user context
  let ticketId: string | null = null;
  try {
    const { data, error } = await userClient.rpc('create_ticket_with_first_message', {
      p_subject: SUBJECT,
      p_body: ticketBody,
      p_priority: 'p3',
    });
    if (error) {
      console.error('[cancellation-feedback-to-ticket] RPC error:', error.message);
      return jsonError(500, 'rpc_failed');
    }
    ticketId = data as string;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cancellation-feedback-to-ticket] RPC threw:', msg);
    return jsonError(500, 'rpc_threw');
  }

  // 7. Tag the ticket (both tags required per 40-PATTERNS §14)
  try {
    await userClient
      .from('tickets')
      .update({ tags: ['cancellation-feedback', 'sentiment:negative'] })
      .eq('id', ticketId!);
  } catch (err) {
    // Tag failure is non-fatal — ticket was created; log and continue
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cancellation-feedback-to-ticket] tag update error:', msg);
  }

  return jsonResponse(200, { ticket_id: ticketId });
}

/** Test-injectable: override createClient with a stub. */
export const __internal = {
  handler,
  setCreateClientForTest: (fn: typeof createClient) => {
    _createClient = fn;
  },
  resetCreateClientForTest: () => {
    _createClient = createClient;
  },
};

Deno.serve(handler);
