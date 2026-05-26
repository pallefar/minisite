/**
 * rag-newsletter-unsubscribe-1click — RFC 8058 one-click unsubscribe handler.
 *
 * Phase 60 Plan 60-12 Task 6.
 *
 * === Endpoints ===
 * GET /healthz → 200 { ok: true, fn: "rag-newsletter-unsubscribe-1click" }
 * POST / → RFC 8058 one-click unsubscribe (from Gmail/Apple Mail/Outlook)
 * GET / → fallback HTML confirmation page (for manual click-through from email)
 *
 * === Auth ===
 * No JWT required — token IS the credential per RFC 8058 §3 ("must not require
 * user-side authentication"). Token entropy: 32-byte base64 (~256-bit).
 *
 * === Auth flow (two-layer) ===
 * PRIMARY: stored-token compare via constantTimeEqual (DB row is auth boundary)
 * DEFENSE-IN-DEPTH: HMAC envelope `h` param optionally verified if present
 *
 * === Token rotation ===
 * Atomic UPDATE: flip opted_in=false + rotate token in single statement to prevent
 * replay attacks (T-60-12-02). 0-row UPDATE = already unsubscribed = idempotent 200.
 *
 * === Deploy ===
 * Deferred to 60-15 per [[feedback_fn_deploy_before_cron_db_push]].
 * NO cron in this plan.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { constantTimeEqual, verifyUnsubscribeToken } from '../_shared/newsletter-token.ts';
import { shutdownPostHog } from '../_shared/posthog-rag-events.ts';
import { captureRagEvent } from '../_shared/posthog-server.ts';

// ─── Dependency injection ─────────────────────────────────────────────────────

export interface UnsubscribeDeps {
  supabaseAnonClient: ReturnType<typeof createClient>;
  supabaseServiceClient: ReturnType<typeof createClient>;
  signingKey: string;
  supabaseUrl: string;
}

// ─── Generic error response (no token-shape leak) ────────────────────────────

function badRequest(detail = 'Invalid request'): Response {
  return new Response(JSON.stringify({ error: detail }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── HTML success page ────────────────────────────────────────────────────────

function successHtml(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Unsubscribed — LeanShot</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 480px; margin: 80px auto; padding: 0 16px; }
    h1 { font-size: 24px; color: #111; }
    p { color: #666; }
    a { color: #0d9488; }
  </style>
</head>
<body>
  <h1>You're unsubscribed.</h1>
  <p>You will no longer receive the LeanShot Research Digest.</p>
  <p><a href="/settings#newsletter">Resubscribe</a> anytime in Settings.</p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

/**
 * Unsubscribe handler. Exported as named function for direct test import.
 * Per [[reference_deno_test_top_level_serve_trap]]: Deno.serve is guarded
 * by `if (import.meta.main)`.
 */
export async function handleUnsubscribe(
  req: Request,
  deps?: Partial<UnsubscribeDeps>,
): Promise<Response> {
  const url = new URL(req.url);

  // ── GET /healthz ───────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    return new Response(
      JSON.stringify({ ok: true, fn: 'rag-newsletter-unsubscribe-1click' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Only POST and GET allowed from here ────────────────────────────────────
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Parse parameters from URL query ───────────────────────────────────────
  // Both POST and GET carry params in the URL (RFC 8058 POST sends no body)
  const userId = url.searchParams.get('u');
  const presentedToken = url.searchParams.get('t');
  const hmacEnvelope = url.searchParams.get('h'); // optional defense-in-depth

  if (!userId || !presentedToken) {
    return badRequest();
  }

  // ── Env / clients ──────────────────────────────────────────────────────────
  const supabaseUrl = deps?.supabaseUrl ?? Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const signingKey = deps?.signingKey ?? Deno.env.get('NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY') ?? '';

  // Anon client for SELECT (RLS: anon SELECT of token+opted_in by user_id)
  const anonClient = deps?.supabaseAnonClient ?? createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
  });
  // Service client for UPDATE (token rotation requires service role)
  const serviceClient = deps?.supabaseServiceClient ?? createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // ── Fetch stored token (anon SELECT) ──────────────────────────────────────
  const { data: row, error: selectError } = await (anonClient
    .from('newsletter_subscribers') as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: unknown) => { maybeSingle: () => Promise<{
          data: { unsubscribe_token: string; opted_in: boolean } | null;
          error: unknown;
        }> };
      };
    })
    .select('unsubscribe_token,opted_in')
    .eq('user_id', userId)
    .maybeSingle();

  if (selectError || !row) {
    // Generic 400 — no row or error (don't leak distinction per T-60-12-01)
    return badRequest();
  }

  const storedToken = row.unsubscribe_token;

  // ── PRIMARY AUTH: stored-token constant-time compare (T-60-12-01) ─────────
  // CRITICAL: MUST use constantTimeEqual, NOT ===
  if (!constantTimeEqual(storedToken, presentedToken)) {
    return badRequest();
  }

  // ── DEFENSE-IN-DEPTH: HMAC envelope if present (T-60-12-02) ──────────────
  if (hmacEnvelope) {
    const hmacValid = await verifyUnsubscribeToken({
      userId,
      storedToken,
      signingKey,
      presentedToken: hmacEnvelope,
    });
    if (!hmacValid) {
      return badRequest();
    }
  }

  // ── Atomic compare-and-update (rotate token + flip opted_in) ──────────────
  // Single SQL UPDATE with WHERE token = $2 — prevents race + replay (T-60-12-02)
  // Per [[reference_postgres_no_insert_on_conflict_do_delete]]: use UPDATE, not INSERT+ON CONFLICT
  const { data: updateResult } = await (serviceClient
    .from('newsletter_subscribers') as unknown as {
      update: (data: Record<string, unknown>) => {
        eq: (col: string, val: unknown) => {
          eq: (col2: string, val2: unknown) => {
            select: (cols: string) => Promise<{
              data: Array<{ user_id: string }> | null;
              error: unknown;
            }>;
          };
        };
      };
    })
    .update({
      opted_in: false,
      opted_out_at: new Date().toISOString(),
      // Token rotation: new 32-byte base64 token (note: in production the DB generates this;
      // here we use a JS-side rotation that the DB will accept via the UPDATE SET clause)
      unsubscribe_token: btoa(Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => String.fromCharCode(b)).join('')),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('unsubscribe_token', storedToken) // redundant but atomic — T-60-12-02
    .select('user_id');

  // 0 rows = already rotated (concurrent unsubscribe or already opted-out) — idempotent success
  const wasUpdated = Array.isArray(updateResult) && updateResult.length > 0;

  // ── PostHog telemetry (T-60-12 per plan) ──────────────────────────────────
  // Use captureRagEvent (custom event name) not emitAiGeneration ($ai_generation)
  // — unsubscribe is not an AI generation event and must not pollute the cost dashboard.
  try {
    captureRagEvent({
      distinctId: userId,
      name: 'newsletter_unsubscribed',
      properties: {
        trace_id: `unsub-${userId}-${Date.now()}`,
        via: req.method === 'POST' ? 'one-click' : 'manual-click',
        was_rotation_update: wasUpdated,
      },
    });
    await shutdownPostHog();
  } catch {
    // Best-effort telemetry — never block the response
  }

  // ── Response by method ─────────────────────────────────────────────────────
  // POST: RFC 8058 requires 200 (Gmail/Apple Mail expect 200, NOT 302)
  if (req.method === 'POST') {
    return new Response(null, { status: 200 });
  }

  // GET: return HTML success page
  return successHtml();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  Deno.serve((req: Request) => handleUnsubscribe(req));
}
