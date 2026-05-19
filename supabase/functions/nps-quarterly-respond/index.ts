/**
 * Phase 42 Plan 42-07 (POLISH-12) — Quarterly NPS respond Edge Function.
 *
 * GET /nps-quarterly-respond?score=N&token=...
 *
 * Unauthenticated — the HMAC token IS the auth secret (Pitfall 11):
 *   1. verifyQuarterlyNpsToken(token) — HMAC + payload shape check.
 *   2. Score URL param MUST match payload.score (tamper guard — without this
 *      check, an attacker who intercepted a "score=10" URL could change it
 *      to "score=0"; the HMAC covers payload, not URL params).
 *   3. Atomic single-use nonce burn:
 *        UPDATE quarterly_nps_nonces SET used_at = now()
 *          WHERE nonce = $1 AND used_at IS NULL RETURNING 1
 *      rowcount = 0 → 409 'already used' (replay) — Pitfall 11.
 *   4. INSERT INTO quarterly_nps_responses ON CONFLICT (user_id, quarter) DO NOTHING.
 *      A previous in-app response wins under UNIQUE(user_id, quarter); we
 *      return 409 'already responded' in that case.
 *   5. 302 → /nps/followup?nonce=<nonce>  (open-text follow-up page lives in
 *      Plan 42-10 frontend; until then a static "Thanks!" HTML is served).
 */

// eslint-disable-next-line import-x/no-unresolved
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { verifyQuarterlyNpsToken } from '../_shared/nps-token.ts';

const APP_FOLLOWUP_BASE =
  (typeof globalThis !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((globalThis as any).Deno?.env?.get?.('APP_FOLLOWUP_BASE') as string | undefined)) ||
  'https://app.leanshot.app/nps/followup';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
      },
    });
  }
  if (req.method !== 'GET') {
    return htmlResponse(405, '<h1>Method not allowed</h1>');
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return htmlResponse(500, '<h1>Server misconfigured</h1>');
  }

  const url = new URL(req.url);
  const scoreParam = url.searchParams.get('score');
  const token = url.searchParams.get('token');
  if (!scoreParam || !token) {
    return htmlResponse(400, '<h1>Missing score or token</h1>');
  }
  const scoreNum = Number(scoreParam);
  if (!Number.isInteger(scoreNum) || scoreNum < 0 || scoreNum > 10) {
    return htmlResponse(400, '<h1>Invalid score</h1>');
  }

  const payload = verifyQuarterlyNpsToken(token);
  if (!payload) {
    return htmlResponse(401, '<h1>Invalid or tampered token</h1>');
  }
  // Tamper-guard: URL score must equal signed score.
  if (payload.score !== scoreNum) {
    return htmlResponse(401, '<h1>Score mismatch — token does not authorize this score</h1>');
  }

  const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Step 1: atomic single-use nonce burn.
  // We can't run an UPDATE … RETURNING through PostgREST as a single op with
  // a WHERE-on-NULL filter and rowcount; the supabase-js update().select()
  // path returns the matching rows post-update. We .eq('used_at', null is not
  // supported as a filter for is-null — must use .is('used_at', null).
  const { data: burnRows, error: burnErr } = await admin
    .from('quarterly_nps_nonces')
    .update({ used_at: new Date().toISOString() })
    .eq('nonce', payload.nonce)
    .is('used_at', null)
    .select('nonce, user_id, quarter');
  if (burnErr) {
    console.warn('[nps-quarterly-respond] nonce burn error:', burnErr.message);
    return htmlResponse(500, '<h1>Server error (nonce)</h1>');
  }
  if (!burnRows || burnRows.length === 0) {
    return htmlResponse(409, '<h1>This link has already been used.</h1>');
  }
  const burned = burnRows[0];
  if (burned.user_id !== payload.user_id || burned.quarter !== payload.quarter) {
    // Defense in depth: signed payload disagrees with nonce ownership.
    return htmlResponse(401, '<h1>Token does not match nonce.</h1>');
  }

  // Step 2: INSERT response — UNIQUE(user_id, quarter) handles double-submit
  // (e.g. user already responded in-app).
  const { error: insErr } = await admin
    .from('quarterly_nps_responses')
    .insert({
      user_id: payload.user_id,
      quarter: payload.quarter,
      score: payload.score,
      responded_via: 'email',
    });
  if (insErr) {
    // 23505 = unique_violation — already responded via another channel.
    if (
      (insErr.code === '23505') ||
      ((insErr.message ?? '').toLowerCase().includes('duplicate'))
    ) {
      return htmlResponse(409, '<h1>You have already responded for this quarter.</h1>');
    }
    console.warn('[nps-quarterly-respond] insert error:', insErr.message);
    return htmlResponse(500, '<h1>Server error (insert)</h1>');
  }

  // Step 3: redirect to follow-up open-text page (frontend, Plan 42-10).
  const followupUrl = `${APP_FOLLOWUP_BASE}?nonce=${encodeURIComponent(payload.nonce)}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: followupUrl,
      'Access-Control-Allow-Origin': '*',
    },
  });
});

function htmlResponse(status: number, body: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>LeanShot NPS</title></head><body style="font-family:sans-serif;max-width:560px;margin:48px auto;padding:24px;">${body}<p style="margin-top:24px;font-size:12px;color:#666;">— LeanShot</p></body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
