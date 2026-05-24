/**
 * Phase 48 Plan 09 — ban-enforcement Edge Fn.
 *
 * D-15 CORRECTED 2026-05-23: invoked by apply_user_moderation RPC trigger
 * (Plan 48-03) on status='banned' via pg_net.http_post. Executes
 * service-role DELETE on auth.sessions + auth.refresh_tokens through a
 * SECDEF RPC funneled via the trusted public schema (iter-1 W1 fix —
 * PostgREST exposes only public + graphql_public by default, so direct
 * supabase-js .schema('auth') is not guaranteed to reach auth.* tables).
 *
 * A10 spike (RESEARCH 2026-05-23) confirmed service-role has DML
 * permission on auth.sessions + auth.refresh_tokens. Fallback path
 * (Auth Admin REST endpoint) documented in 48-RESEARCH Pitfall 1 if
 * future Supabase platform change denies DML — not shipped v1.
 *
 * Residual JWT window: current access JWT (~1h exp) remains valid;
 * SPA AccountSuspended blocker (Plan 48-11) + RLS write-deny (Plan 48-06)
 * are durable mitigations.
 *
 * Per memory feedback_negation_grep_defeated_by_comment_string — the
 * rejected API name is documented in PLAN.md / SUMMARY.md only, never
 * in committed source.
 *
 * Auth: SUPABASE_SERVICE_ROLE_KEY bearer (HMAC constant-time compare).
 * Body: { user_id: uuid }.
 * Returns 200 { revoked: true, user_id } on success.
 *
 * Per reference_deno_test_top_level_serve_trap — Deno.serve guarded so
 * `deno test` imports the module without binding the HTTP server.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
} from '../_shared/lifecycle-utils.ts';

// ---------------------------------------------------------------------------
// Body validation (UUID v4-ish — RFC 4122 hex-with-hyphens shape)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BanBody {
  user_id: string;
}

function validateBody(raw: unknown): { ok: true; body: BanBody } | { ok: false } {
  if (!raw || typeof raw !== 'object') return { ok: false };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.user_id !== 'string' || !UUID_RE.test(obj.user_id)) return { ok: false };
  return { ok: true, body: { user_id: obj.user_id } };
}

// ---------------------------------------------------------------------------
// Lazy admin singleton + test-injection seam
// ---------------------------------------------------------------------------

let _adminInstance: SupabaseClient | null = null;
let _adminOverride: unknown | null = null;

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

function setAdminForTest(client: unknown): void {
  _adminOverride = client;
}

function resetAdminForTest(): void {
  _adminOverride = null;
  _adminInstance = null;
}

const admin = new Proxy({} as Record<string | symbol, unknown>, {
  get(_t, prop: string | symbol): unknown {
    // deno-lint-ignore no-explicit-any
    const a: any = (_adminOverride ?? getAdmin()) as any;
    const val = a[prop];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(a) : val;
  },
}) as unknown as SupabaseClient;

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }

  const validated = validateBody(raw);
  if (!validated.ok) return jsonError(400, 'invalid_body');
  const { user_id } = validated.body;

  // D-15 CORRECTED: revoke via SECDEF RPC (iter-1 W1 fix).
  // RPC body executes DELETE on auth.sessions + auth.refresh_tokens under
  // SECDEF context. Funnels DML through the trusted public schema since
  // PostgREST exposes only public + graphql_public by default.
  // A10 spike (2026-05-23) confirmed service-role has DML permission on
  // auth.sessions + auth.refresh_tokens.
  // Idempotent: DELETE on already-absent rows returns 0 rows (no error).
  // deno-lint-ignore no-explicit-any
  const { error: revokeErr } = await (admin as any).rpc('revoke_user_sessions', {
    p_user_id: user_id,
  });
  if (revokeErr) {
    console.error('[ban-enforcement] revoke_user_sessions error', revokeErr.message);
    return jsonError(500, 'session_revoke_failed');
  }

  // Audit log — action_type='session_revoked' disambiguates the
  // service-role caller context (auth.uid()=null) per memory
  // feedback_rpc_auth_uid_vs_service_role_mismatch.
  // deno-lint-ignore no-explicit-any
  const { error: auditErr } = await (admin as any).rpc('log_moderation_action', {
    p_action_type: 'session_revoked',
    p_target_type: 'user',
    p_target_id: user_id,
    p_before: null,
    p_after: null,
    p_reason: 'ban_applied',
  });
  if (auditErr) {
    // Audit failure is non-fatal — sessions are already revoked.
    console.error('[ban-enforcement] log_moderation_action error', auditErr.message);
  }

  return jsonResponse(200, { revoked: true, user_id });
}

// ---------------------------------------------------------------------------
// Deno.serve entrypoint — guarded per reference_deno_test_top_level_serve_trap
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) {
  denoGlobal.serve(handler);
}

// ---------------------------------------------------------------------------
// Test internals
// ---------------------------------------------------------------------------

export const __internal = {
  handler,
  setAdminForTest,
  resetAdminForTest,
};
