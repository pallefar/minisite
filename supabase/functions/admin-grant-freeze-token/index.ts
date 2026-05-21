/**
 * Phase 35 Plan 35-02 (GAME-03 + D-10) — admin-grant-freeze-token Edge Function.
 *
 * POST /functions/v1/admin-grant-freeze-token
 *
 * Auth: Authorization: Bearer <user-jwt>
 *
 * Body:
 *   { target_user_id: uuid, delta: 1|2, reason_note: string(1-200) }
 *
 * Responses:
 *   200 { ok: true }                         — grant inserted with audit row
 *   400 { error: 'invalid_body' }            — missing/invalid fields
 *   401 { error: 'unauthenticated' }         — missing/invalid Authorization
 *   403 { error: 'forbidden_not_admin' }     — caller is not support_admin|support_lead|superadmin
 *   405 { error: 'method_not_allowed' }      — non-POST
 *   500 { error: 'db_error' | 'internal_error' }
 *
 * Architecture invariants:
 *   1. User-JWT auth — admin.auth.getUser(jwt) verifies token signature (T-35-02-04 spoofing).
 *   2. Server-side admin role check — profiles.admin_role is read from DB, not from client
 *      surfaceCheck. Prevents privilege escalation (T-35-02-02).
 *   3. Zod body validation — delta clamped to [1,2]; reason_note 1-200 chars (T-35-02-07).
 *   4. granted_by_admin_user_id populated on every admin_grant row (T-35-02-03 repudiation).
 *   5. captureServer + shutdownPostHog in finally per D-05 + PITFALL 1.
 *   6. ETHICAL-ONLY: admin grants are never monetized. D-10 UI says "not for sale".
 *
 * Patterns mirrored:
 *   - record-activation/index.ts:171-277 (user-JWT auth + admin role check + SECDEF RPC + PostHog)
 *   - _shared/lifecycle-utils.ts makeLazyAdmin (test-injectable singleton)
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
// Zod body schema (D-10 + T-35-02-07)
// ============================================================================

const BodySchema = z.object({
  target_user_id: z.string().uuid(),
  delta: z.number().int().min(1).max(2),       // admin grant 1 or 2 tokens
  reason_note: z.string().min(1).max(200),      // human-readable audit reason
});

// ============================================================================
// Lazy admin singleton — test-injectable (mirrors makeLazyAdmin from _shared/lifecycle-utils.ts)
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

// Test seam — called by index.test.ts to inject a mock client.
// deno-lint-ignore no-explicit-any
export function __setAdminForTest(client: any): void {
  _adminInstance = client as SupabaseClient;
}

export function __resetAdmin(): void {
  _adminInstance = null;
}

// ============================================================================
// Valid admin roles (mirrors Phase 27 admin module + D-10 audit scope)
// ============================================================================

const ADMIN_ROLES = new Set(['support_admin', 'support_lead', 'superadmin']);

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
    // 1. User-JWT auth — verifies token signature server-side (T-35-02-04).
    const jwt = jwtFromReq(req);
    if (!jwt) return jsonError(401, 'unauthenticated');

    const a = getAdmin();
    // deno-lint-ignore no-explicit-any
    const { data: userRes, error: authErr } = await (a.auth as any).getUser(jwt) as {
      data: { user?: { id?: string } | null };
      error: { message?: string } | null;
    };
    if (authErr || !userRes?.user?.id) return jsonError(401, 'unauthenticated');
    const callerId = userRes.user.id;

    // 2. Server-side admin role check (T-35-02-02 — NOT just client surfaceCheck).
    const { data: profile, error: profileErr } = await a
      .from('profiles')
      .select('admin_role')
      .eq('id', callerId)
      .maybeSingle();
    if (profileErr) {
      console.error('[admin-grant-freeze-token] profile lookup failed', profileErr);
      return jsonError(500, 'db_error');
    }
    if (!profile?.admin_role || !ADMIN_ROLES.has(profile.admin_role)) {
      return jsonError(403, 'forbidden_not_admin');
    }

    // 3. Body validation (T-35-02-07).
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(400, 'invalid_body');
    }
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return jsonError(400, 'invalid_body');
    const { target_user_id, delta, reason_note } = parsed.data;

    // 4. Insert freeze_tokens_ledger row with granted_by_admin_user_id audit (D-10 + T-35-02-03).
    const { error: insErr } = await a.from('freeze_tokens_ledger').insert({
      user_id: target_user_id,
      delta,
      reason: 'admin_grant',
      granted_by_admin_user_id: callerId,
      source_ref: `admin_grant:${reason_note.slice(0, 80)}`,
    });
    if (insErr) {
      console.error('[admin-grant-freeze-token] insert failed', insErr);
      return jsonError(500, 'db_error');
    }

    // 5. Server-side PostHog capture (D-05 server-side events).
    // CaptureArgs uses `userId` (not `distinctId`) — posthog-server.ts:94-96.
    captureServer({
      userId: callerId,
      event: 'freeze_token_granted',
      properties: {
        target_user_id,
        delta,
        reason: 'admin_grant',
        granted_by_admin_user_id: callerId,
      },
    });

    return jsonResponse(200, { ok: true });
  } catch (e) {
    console.error('[admin-grant-freeze-token] handler error', e);
    return jsonError(500, 'internal_error');
  } finally {
    // CRITICAL: flush PostHog batch before Deno isolate tears down (PITFALL 1).
    try {
      await shutdownPostHog();
    } catch (e) {
      console.error('[admin-grant-freeze-token] shutdownPostHog failed', e);
    }
  }
}

// Guard: only bind the server when running as a real Deno Edge Function.
// Tests import index.ts and call __internal.handler directly without Deno.serve.
// Mirrors the record-activation/index.ts denoGlobal?.serve pattern.
// deno-lint-ignore no-explicit-any
const _denoGlobal: any = (globalThis as any).Deno;
if (_denoGlobal?.serve) {
  _denoGlobal.serve(handler);
}

// ============================================================================
// Test internals — exported for Deno test suite (mirrors record-activation pattern)
// ============================================================================

export const __internal = {
  handler,
  setAdminForTest: __setAdminForTest,
  resetAdminForTest: __resetAdmin,
};
