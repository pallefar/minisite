/**
 * Phase 35 Plan 35-03 (D-05) — xp-event Edge Function.
 *
 * POST /functions/v1/xp-event
 *
 * Auth: Authorization: Bearer <user-jwt>  (user-JWT, not service-role)
 *
 * Body:
 *   { event: Phase35EventEnum, properties: Record<string, unknown> }
 *
 * Responses:
 *   200 { ok: true }                    — PostHog capture fired (or no-op if POSTHOG_PROJECT_KEY missing)
 *   400 { error: 'invalid_body' }       — missing/invalid event enum or body shape
 *   401 { error: 'unauthenticated' }    — missing/invalid Authorization
 *   405 { error: 'method_not_allowed' } — non-POST
 *   500 { error: 'internal_error' }
 *
 * Architecture invariants:
 *   1. User-JWT auth — admin.auth.getUser(jwt) validates token; user.id used as distinctId.
 *   2. Property allowlist — only 8 PHI-safe keys allowed through; everything else is dropped
 *      before captureServer (T-35-03-04 PHI leak prevention, Phase 25 HIPAA-08 defense-in-depth).
 *   3. 6-event enum enforced via Zod — prevents arbitrary event name injection.
 *   4. NO DB writes — pure PostHog server-side capture (supplementary analytics).
 *      Ledger writes happen via DB triggers (Plan 35-03 Task 1). This Fn is analytics-only.
 *   5. Vendor-gated: if POSTHOG_PROJECT_KEY missing → captureServer no-op + 200 (reference_vendor_gated_send_health_check).
 *   6. shutdownPostHog() in finally — mandatory per PITFALL 1 (events_batch dropped on isolate teardown).
 *
 * Patterns mirrored:
 *   - admin-grant-freeze-token/index.ts (user-JWT auth + Zod body + captureServer + finally-shutdown)
 *   - record-activation/index.ts:171-277 (full handler shape)
 *   - _shared/posthog-server.ts captureServer + shutdownPostHog
 */

import { z } from 'npm:zod@3';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.105.4';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';

// ============================================================================
// CORS
// ============================================================================

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('authorization') ?? req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

// ============================================================================
// Zod body schema (6-event enum per Plan 35-03 SCOPE)
// ============================================================================

const Phase35EventEnum = z.enum([
  'xp_earned',
  'level_up',
  'streak_milestone',
  'freeze_token_granted',
  'challenge_completed',
  'badge_unlocked',
]);

const BodySchema = z.object({
  event: Phase35EventEnum,
  properties: z.record(z.unknown()),  // open shape; sanitized via ALLOWED_PROPERTY_KEYS below
});

// ============================================================================
// PHI allowlist — 8 keys (T-35-03-04, Phase 25 HIPAA-08 defense-in-depth)
// ONLY these 8 keys are forwarded to PostHog. Any other key is silently dropped.
// This prevents PHI leak even when the SPA has a bug that sends weight_kg, dose, etc.
// ============================================================================

const ALLOWED_PROPERTY_KEYS = new Set<string>([
  'xp_delta',
  'action_type',
  'level_before',
  'level_after',
  'badge_id',
  'challenge_id',
  'streak_days',
  'freeze_tokens_remaining',
]);

function sanitizeProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (ALLOWED_PROPERTY_KEYS.has(k)) {
      out[k] = v;
    }
    // Keys outside the allowlist are silently dropped (T-35-03-04)
  }
  return out;
}

// ============================================================================
// Lazy admin singleton — test-injectable (mirrors makeLazyAdmin pattern)
// ============================================================================

let _adminInstance: SupabaseClient | null = null;

function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    _adminInstance = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}

// deno-lint-ignore no-explicit-any
export function __setAdminForTest(client: any): void {
  _adminInstance = client as SupabaseClient;
}

export function __resetAdmin(): void {
  _adminInstance = null;
}

// ============================================================================
// Core handler
// ============================================================================

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  try {
    // 1. User-JWT auth (T-35-03-05 spoofing mitigation).
    //    Uses admin.auth.getUser() — server-side JWT verification, not trust-the-body.
    //    T-35-03-08: user.id from validated JWT; any user_id in body is ignored.
    const jwt = jwtFromReq(req);
    if (!jwt) return jsonError(401, 'unauthenticated');

    const a = getAdmin();
    // deno-lint-ignore no-explicit-any
    const { data: userRes, error: authErr } = await (a.auth as any).getUser(jwt) as {
      data: { user?: { id?: string } | null };
      error: { message?: string } | null;
    };
    if (authErr || !userRes?.user?.id) return jsonError(401, 'unauthenticated');
    const userId = userRes.user.id;

    // 2. Body validation (6-event enum + record shape).
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(400, 'invalid_body');
    }
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return jsonError(400, 'invalid_body');
    const { event, properties } = parsed.data;

    // 3. Sanitize properties — drop any key NOT in the 8-key allowlist.
    //    Defense-in-depth against PHI leak (T-35-03-04 + Phase 25 HIPAA-08).
    //    Example: client sends { xp_delta: 25, weight_kg: 80 } → only { xp_delta: 25 } reaches PostHog.
    const sanitized = sanitizeProperties(properties);

    // 4. Server-side PostHog capture (D-05 supplementary analytics).
    //    Vendor-gated: captureServer is a no-op if POSTHOG_PROJECT_KEY is missing
    //    (reference_vendor_gated_send_health_check — safe to deploy before secrets set).
    //    CaptureArgs uses `userId` field per posthog-server.ts:94-96 (not `distinctId`).
    //    Per 35-02 deviation note: `userId` is the correct field — caught from posthog-server.ts CaptureArgs.
    captureServer({
      userId,
      event,
      properties: sanitized,
    });

    return jsonResponse(200, { ok: true });
  } catch (e) {
    console.error('[xp-event] handler error', e);
    return jsonError(500, 'internal_error');
  } finally {
    // CRITICAL: flush PostHog batch before Deno isolate tears down (PITFALL 1).
    // Even on error paths (auth, validation), shutdownPostHog must be called.
    try {
      await shutdownPostHog();
    } catch (e) {
      console.error('[xp-event] shutdownPostHog failed', e);
    }
  }
}

// Guard: only bind the server when running as a real Deno Edge Function.
// Tests import index.ts and call __internal.handler directly without Deno.serve.
// deno-lint-ignore no-explicit-any
const _denoGlobal: any = (globalThis as any).Deno;
if (_denoGlobal?.serve) {
  _denoGlobal.serve(handler);
}

// ============================================================================
// Test internals — exported for Deno test suite
// ============================================================================

export const __internal = {
  handler,
  setAdminForTest: __setAdminForTest,
  resetAdminForTest: __resetAdmin,
  /** Exposed for property-allowlist unit tests. */
  sanitizeProperties,
};
