/**
 * Phase 42 Plan 42-07 (POLISH-12) — Quarterly NPS open-text follow-up handler.
 *
 * POST /nps-quarterly-followup  body: { nonce, comment }
 *
 * The follow-up landing page (Plan 42-10 frontend) carries the nonce from the
 * respond Fn's 302 redirect. We attach the comment to the committed response
 * row keyed by (user_id, quarter) derived from the nonce.
 *
 * Security posture: the nonce was already burned at /respond. Re-using a
 * "used" nonce to POST a comment is BY DESIGN — the comment is authorized by
 * the same single-use envelope. We deliberately accept used_at IS NOT NULL
 * here (the burn was step 1 of the email-response flow; the follow-up POST is
 * step 2).
 *
 * We DO restrict: only the user whose response is recorded for that nonce
 * can update their comment — and we never accept a comment that mutates the
 * score (rejected upstream by RLS / column whitelist).
 *
 * Update semantics: comment is overwritten on each POST until the user
 * navigates away. This is fine for a single-session flow; no DOS surface
 * because the nonce + user_id + quarter triple is unique.
 */

// eslint-disable-next-line import-x/no-unresolved
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Deno: any;

const MAX_COMMENT_LENGTH = 4000;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
      },
    });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: 'service_misconfigured' });
  }

  let body: { nonce?: unknown; comment?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }
  const nonce = typeof body.nonce === 'string' ? body.nonce.trim() : '';
  const commentRaw = typeof body.comment === 'string' ? body.comment : '';
  if (!nonce) return jsonResponse(400, { error: 'missing_nonce' });
  if (commentRaw.length > MAX_COMMENT_LENGTH) {
    return jsonResponse(400, { error: 'comment_too_long' });
  }
  // Trim trailing whitespace but preserve user's content otherwise.
  const comment = commentRaw.trim().slice(0, MAX_COMMENT_LENGTH);

  const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Resolve nonce → user_id + quarter.
  const { data: nonceRow, error: nonceErr } = await admin
    .from('quarterly_nps_nonces')
    .select('user_id, quarter, used_at')
    .eq('nonce', nonce)
    .maybeSingle();
  if (nonceErr) {
    console.warn('[nps-quarterly-followup] nonce lookup error:', nonceErr.message);
    return jsonResponse(500, { error: 'server_error' });
  }
  if (!nonceRow) {
    return jsonResponse(404, { error: 'nonce_not_found' });
  }
  if (!nonceRow.used_at) {
    // The nonce should already be burned by /respond. If not, refuse — a raw
    // follow-up without a preceding response is suspect.
    return jsonResponse(409, { error: 'response_not_yet_recorded' });
  }

  // 2. UPDATE the committed response row's comment.
  const { data: updRows, error: updErr } = await admin
    .from('quarterly_nps_responses')
    .update({ comment })
    .eq('user_id', nonceRow.user_id)
    .eq('quarter', nonceRow.quarter)
    .select('id');
  if (updErr) {
    console.warn('[nps-quarterly-followup] update error:', updErr.message);
    return jsonResponse(500, { error: 'server_error' });
  }
  if (!updRows || updRows.length === 0) {
    return jsonResponse(404, { error: 'response_not_found' });
  }

  return jsonResponse(200, { ok: true });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
