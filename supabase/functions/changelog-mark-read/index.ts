/**
 * Phase 42 Plan 42-06 (POLISH-11) — Changelog "mark read" Edge Function.
 *
 * POST /functions/v1/changelog-mark-read
 *
 * Auth:
 *   Authorization: Bearer <user-jwt>
 *
 * Body: (none required; empty JSON `{}` accepted)
 *
 * Behavior:
 *   1. Verify Bearer token via admin.auth.getUser() → returns auth.uid().
 *   2. UPSERT user_changelog_dismissed:
 *      INSERT (user_id, last_seen_published_at, updated_at)
 *      VALUES (auth.uid(), now(), now())
 *      ON CONFLICT (user_id) DO UPDATE SET
 *        last_seen_published_at = EXCLUDED.last_seen_published_at,
 *        updated_at = EXCLUDED.updated_at;
 *   3. Respond 200 { last_seen_published_at }.
 *
 * Idempotent — repeat invocation simply advances the timestamp.
 *
 * Threat-model:
 *   T-42-06-03 (forged mark-read): the token MUST round-trip through
 *   Supabase Auth (admin.getUser). A forged user_id in the body is ignored —
 *   only the verified JWT subject is used as the user_id.
 *
 * References:
 *   - reference_supabase_functions_deploy_no_linked_flag — deploy omits --linked
 *   - reference_grep_gate_comment_strip — no SECDEF here; nothing to grep
 *
 * Internals (`__internal`) are exported for the Deno test suite.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ============================================================================
// CORS
// ============================================================================

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

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

// ============================================================================
// Lazy admin singleton (per project pattern, see account-delete/index.ts)
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

// Proxy enables setAdminForTest after module import (Deno tests set env after import).
let _adminOverride: unknown | null = null;
function setAdminForTest(client: unknown): void {
  _adminOverride = client;
}
function resetAdminForTest(): void {
  _adminOverride = null;
  _adminInstance = null;
}

const admin = new Proxy({} as Record<string | symbol, unknown>, {
  get(_t: unknown, prop: string | symbol): unknown {
    // deno-lint-ignore no-explicit-any
    const a: any = (_adminOverride ?? getAdmin()) as any;
    const val = a[prop];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(a) : val;
  },
}) as unknown as SupabaseClient;

// ============================================================================
// Core handler
// ============================================================================

async function handleMarkRead(req: Request): Promise<Response> {
  // Method gate (zod-equivalent: only POST is valid input).
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  // Bearer JWT required.
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: userData, error: userErr } = (await ((admin.auth as any).getUser(jwt))) as {
    data: { user?: { id?: string } | null };
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (userErr || !userData?.user?.id) return jsonError(401, 'unauthenticated');
  const userId = userData.user.id;

  // Body is optional — accept empty body, accept malformed (we don't use it).
  // No payload to validate beyond Method + Auth.

  const nowIso = new Date().toISOString();

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { error: upsertErr } = (await (admin
    .from('user_changelog_dismissed')
    .upsert(
      {
        user_id: userId,
        last_seen_published_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'user_id' },
    ) as any)) as { error: { message?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (upsertErr) {
    console.error('[changelog-mark-read] upsert failed', upsertErr.message);
    return jsonError(500, 'internal');
  }

  return jsonResponse(200, { last_seen_published_at: nowIso });
}

// ============================================================================
// Deno.serve entrypoint
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (denoGlobal?.serve) {
  denoGlobal.serve(handleMarkRead);
}

// ============================================================================
// Test internals
// ============================================================================

export const __internal = {
  handleMarkRead,
  setAdminForTest,
  resetAdminForTest,
};
