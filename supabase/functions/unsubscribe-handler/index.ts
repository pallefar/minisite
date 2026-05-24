/**
 * Phase 49 Plan 49-08 — 1-click unsubscribe handler (RFC 8058 One-Click).
 *
 * D-13: email-delivered unsubscribe links are token-gated GETs+POSTs. The
 * URL signature IS the auth — NO Authorization bearer is checked. The
 * cryptographic guarantee on the token is provided by
 * `../_shared/unsubscribe-token.ts` (HMAC-SHA256 + timingSafeEqual).
 *
 * Flow:
 *   1. GET or POST /functions/v1/unsubscribe-handler?t=<token>
 *   2. verifyUnsubscribeToken(t) returns payload OR null
 *   3. On valid payload: UPSERT notification_settings (user_id, category,
 *      channel='email', enabled=false) onConflict (user_id, category, channel)
 *      → idempotent toggle-off.
 *   4. Respond 200 with confirmation HTML (Cache-Control: no-store +
 *      <meta name="robots" content="noindex">).
 *
 * Error responses:
 *   - 400 missing_token       — `?t=` query param absent.
 *   - 401 invalid_token       — HMAC mismatch, expired, or unknown category.
 *   - 405 method_not_allowed  — anything other than GET/POST/OPTIONS.
 *
 * Per memory `reference_deno_test_top_level_serve_trap`, the top-level
 * `Deno.serve` call is guarded by UNSUBSCRIBE_HANDLER_DISABLE_SERVE so
 * `deno test` can import the handler without binding a port.
 *
 * Test seam: `__internal.handler` is the request handler; `__internal.
 * setAdminForTest(client)` stubs the supabase admin client (used by the
 * Deno test file to assert UPSERT call shape without a Postgres round-trip).
 */

import { corsHeaders, jsonError, makeLazyAdmin } from '../_shared/lifecycle-utils.ts';
import { verifyUnsubscribeToken } from '../_shared/unsubscribe-token.ts';

const lazyAdmin = makeLazyAdmin();

const CONFIRMATION_HTML = (category: string): string => `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Unsubscribed — LeanShot</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 80px auto; padding: 24px; color: #0B1413; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    a { color: #0B5C50; }
  </style>
</head><body>
  <h1>You've unsubscribed</h1>
  <p>You will no longer receive <strong>${category.replace(/_/g, ' ')}</strong> emails.</p>
  <p><a href="https://leanshot.app/settings/notifications">Manage all preferences</a></p>
</body></html>`;

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('t');
  if (!token) return jsonError(400, 'missing_token');

  const payload = verifyUnsubscribeToken(token);
  if (!payload) return jsonError(401, 'invalid_token');

  // Idempotent toggle-off. UPSERT returns 0-rows-affected-tolerant; we don't
  // branch on `error` to avoid email-enumeration leakage (threat T-49-23).
  await lazyAdmin.admin
    .from('notification_settings')
    .upsert(
      {
        user_id: payload.user_id,
        category: payload.category,
        channel: 'email',
        enabled: false,
      },
      { onConflict: 'user_id,category,channel' },
    );

  return new Response(CONFIRMATION_HTML(payload.category), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// Top-level serve — disabled under `deno test` via env guard.
if (Deno.env.get('UNSUBSCRIBE_HANDLER_DISABLE_SERVE') !== '1') {
  Deno.serve(handler);
}

export const __internal = {
  handler,
  setAdminForTest: lazyAdmin.setAdminForTest,
  resetAdminForTest: lazyAdmin.resetAdminForTest,
};
