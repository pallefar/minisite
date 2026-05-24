// event-join-url Edge Fn (Phase 47 Plan 07 — implements D-09 + D-18).
//
// Forwards user JWT to SECDEF RPC `event_get_join_url` which gates on:
//   - rsvp_status = 'going' (47-02 schema, 47-03 RPC)
//   - now() >= start_at - interval '15 minutes' (D-18 join-window)
//
// Per memory `reference_deno_test_top_level_serve_trap`: Deno.serve guarded by
//   `import.meta.main` so `deno test --no-check` can import this module without
//   spawning a real HTTP server.
//
// Per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`: this Fn MUST NOT
//   use the service-role key — the SECDEF RPC reads `auth.uid()`, so the caller's
//   JWT context must flow through. Acceptance grep enforces zero service-role
//   references in this file (see PLAN 47-07 acceptance_criteria).

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get('Authorization') ?? '';
  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return jsonResponse(401, { error: 'unauthorized' });

  let body: { event_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'bad_request' });
  }
  if (!body.event_id) return jsonResponse(400, { error: 'bad_request' });

  const { data, error } = await supa.rpc('event_get_join_url', { p_event_id: body.event_id });
  if (error) return jsonResponse(403, { error: 'forbidden' });
  if (!data) return jsonResponse(500, { error: 'rpc_no_data' });
  if (data.url) return jsonResponse(200, { url: data.url });
  if (data.error === 'too_early') {
    return jsonResponse(403, { error: 'too_early', opens_at: data.opens_at });
  }
  if (data.error === 'rsvp_required') return jsonResponse(403, { error: 'rsvp_required' });
  if (data.error === 'event_ended') return jsonResponse(410, { error: 'event_ended' });
  return jsonResponse(403, { error: data.error ?? 'forbidden' });
}

const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) denoGlobal.serve(handler);
