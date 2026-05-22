/**
 * Phase 36 Plan 36-02 REVIEW-05 — `nps-feedback-submit` Edge Function.
 *
 * POST /functions/v1/nps-feedback-submit
 *
 * Near-exact mirror of `cancellation-feedback-to-ticket/index.ts`:
 *   - Requires user JWT (NOT service-role — RPC references auth.uid()).
 *   - Calls `create_ticket_with_first_message` SECDEF RPC via anon-key client
 *     with Authorization Bearer userJwt forwarded (Pattern 1 / Pitfall 4).
 *   - Subject hardcoded "Feedback from NPS rating" (D-10 verbatim).
 *   - Body length: trimmed ≥ 10 chars (400 too_short); truncated to 4000 chars.
 *   - Post-insert tag write into the public.ticket_tags JOIN TABLE (W6 — NOT
 *     `tickets.tags`, which never existed). Hardcodes applied_by='rule' per
 *     the CHECK constraint in supabase/migrations/20270707000001_helpdesk_schema.sql.
 *
 * Per [[reference_rpc_auth_uid_vs_service_role_mismatch]]: the SECDEF RPC
 * resolves auth.uid() against the forwarded JWT — service-role call would
 * raise 'unauthenticated'.
 *
 * Per project memory [[reference_deno_test_discovery]]: tests at index.test.ts.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonError, jsonResponse } from '../_shared/lifecycle-utils.ts';

const SUBJECT = 'Feedback from NPS rating';
const MIN_BODY_CHARS = 10;
const MAX_BODY_CHARS = 4000;

let _createClient: typeof createClient = createClient;

export async function handler(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 1. Require user JWT (NOT service-role). Per Pitfall 4 / Pattern 1.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonError(401, 'unauthenticated');
  }
  const userJwt = authHeader.slice(7);

  // 2. Parse request body
  let body: { feedback_text?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  // 3. Trim + length validation; truncate > 4000 silently.
  const trimmed = (body.feedback_text ?? '').trim();
  if (trimmed.length < MIN_BODY_CHARS) {
    return jsonError(400, 'too_short');
  }
  const ticketBody = trimmed.length > MAX_BODY_CHARS ? trimmed.slice(0, MAX_BODY_CHARS) : trimmed;

  // 4. Build user-context supabase client (anon-key + Authorization Bearer userJwt)
  //    so the SECDEF RPC's auth.uid() resolves to the caller. Service-role here
  //    would silently fail with 'unauthenticated' from the RPC.
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const userClient: SupabaseClient = _createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });

  // 5. Call SECDEF RPC.
  let ticketId: string | null = null;
  try {
    const { data, error } = await userClient.rpc('create_ticket_with_first_message', {
      p_subject: SUBJECT,
      p_body: ticketBody,
      p_priority: 'p3',
    });
    if (error) {
      console.error('[nps-feedback-submit] RPC error:', error.message);
      return jsonError(500, 'rpc_failed');
    }
    ticketId = data as string;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[nps-feedback-submit] RPC threw:', msg);
    return jsonError(500, 'rpc_threw');
  }

  // 6. Tag the new ticket via the ticket_tags JOIN TABLE (W6 fix).
  //    Hardcoded applied_by='rule' satisfies the CHECK constraint
  //    (applied_by in ('ai','agent','rule')) — verified in
  //    supabase/migrations/20270707000001_helpdesk_schema.sql lines 38-46.
  //    Best-effort: unique(ticket_id, tag_name) protects against duplicates;
  //    failure is non-fatal (the ticket itself is already created).
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { error: tagErr } = (await ((userClient as any)
      .from('ticket_tags')
      .insert({
        ticket_id: ticketId,
        tag_name: 'nps-feedback',
        applied_by: 'rule',
      }))) as { error: { message?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (tagErr) {
      console.warn('[nps-feedback-submit] ticket_tags insert non-fatal:', tagErr.message);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[nps-feedback-submit] ticket_tags insert threw (non-fatal):', msg);
  }

  return jsonResponse(200, { ticket_id: ticketId });
}

/** Test-injectable: override createClient with a stub. */
export const __internal = {
  handler,
  setCreateClientForTest: (fn: typeof createClient): void => {
    _createClient = fn;
  },
  resetCreateClientForTest: (): void => {
    _createClient = createClient;
  },
};

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handler);
}
