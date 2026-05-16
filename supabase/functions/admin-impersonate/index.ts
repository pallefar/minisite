// A1 PROBE verdict: PASS (336ms) — using Option A (primary) implementation per 22-A1-PROBE.md.
// Option A: admin.auth.admin.updateUserById({app_metadata}) + admin.auth.admin.generateLink('magiclink').
// No Custom Access Token Hook fallback; no IMPERSONATION_JWT_SIGNING_KEY vault secret needed.
//
/**
 * `admin-impersonate` Edge Function — Phase 22 Plan 22-03 (ADMIN-03 / D-05).
 *
 * Read-only impersonation primitive for the owner/admin operator surface.
 *
 *   POST /functions/v1/admin-impersonate    (verify_jwt = true — caller JWT required)
 *
 * Request body:
 *   { action: 'start', target_user_id: <uuid> }   →
 *     200 { action_link, expires_at }   — magiclink for admin's browser to assume target session
 *     400 cannot_impersonate_self        — target_user_id === caller.id
 *     400 cannot_impersonate_admin       — target.profiles.is_staff = true
 *     403 forbidden                      — caller is NOT is_staff
 *   { action: 'end', target_user_id: <uuid> }     →
 *     200 { ok: true } — clears app_metadata.impersonator_id (idempotent no-op if already null)
 *
 * Invariants:
 *   1. is_staff is re-checked SERVER-SIDE in the function body. The gateway
 *      verify_jwt=true only verifies identity, not authorization (Pitfall in
 *      reference_supabase_edge_function_deploy.md).
 *   2. Admins cannot impersonate themselves or other admins per D-05.
 *   3. Impersonation TTL = 30 minutes (encoded in app_metadata.impersonation_exp).
 *   4. Audit row written via service-role insert into public.audit_logs with
 *      action='impersonate_start' or 'impersonate_end' + impersonator_id +
 *      target_user_id. user_id is set to the caller (the actor performing the
 *      admin action) and user_id_hash is sha256-hex of caller.id::text.
 *   5. Lazy admin singleton + Proxy (analog: affiliate-payout/index.ts:67-88) so
 *      module import doesn't capture empty env in Deno tests.
 *   6. RLS write-deny: target's NEXT JWT carries impersonator_id in app_metadata
 *      (A1 PROBE verified 336ms propagation). The 51 deny-write policies from
 *      migration 20270601000012 read `request.jwt.claims #>> '{app_metadata,impersonator_id}'`
 *      and block all writes from impersonated sessions.
 *
 * Test seam: `__internal.setAdminForTest(fake)` + `__internal.handle(req)`.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Lazy env reads — see analog rationale (affiliate-payout/index.ts:40-43).
const getSupabaseUrl = () => Deno.env.get('SUPABASE_URL') ?? '';
const getSupabaseServiceRoleKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMPERSONATION_TTL_MS = 30 * 60 * 1000;

// ============================================================================
// Lazy admin singleton (test-injectable via __internal.setAdminForTest)
// ============================================================================

let _adminInstance: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}
// Proxy reads _adminInstance lazily on EACH method call so setAdminForTest works
// after import (the Deno test suite stubs the admin AFTER importing this module).
const admin = new Proxy({} as Record<string | symbol, unknown>, {
  // deno-lint-ignore no-explicit-any
  get(_t: any, prop: string | symbol): unknown {
    const a = getAdmin() as unknown as Record<string | symbol, unknown>;
    const val = a[prop];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(a) : val;
  },
}) as unknown as SupabaseClient;

// ============================================================================
// Helpers
// ============================================================================

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

function bearerFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

/** sha256-hex of input — for user_id_hash column (matches audit_trigger pattern). */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface ImpersonateBody {
  action?: 'start' | 'end';
  target_user_id?: string;
}

// ============================================================================
// Core handler
// ============================================================================

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  // 1. Parse body
  let body: ImpersonateBody;
  try {
    body = (await req.json()) as ImpersonateBody;
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const action = body.action ?? 'start';
  const targetId = body.target_user_id;
  if (!targetId || typeof targetId !== 'string' || !UUID_RE.test(targetId)) {
    return jsonError(400, 'invalid_target_user_id');
  }
  if (action !== 'start' && action !== 'end') {
    return jsonError(400, 'invalid_action');
  }

  // 2. Identify caller from bearer.
  const bearer = bearerFromReq(req);
  if (!bearer) return jsonError(401, 'unauthorized');

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: callerData, error: callerErr } = (await (admin as any).auth.getUser(bearer)) as {
    data: { user: { id: string; email?: string } | null };
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (callerErr || !callerData?.user) {
    return jsonError(401, 'unauthorized');
  }
  const callerId = callerData.user.id;

  // 3. is_staff gate (server-side re-check; gateway verify_jwt only confirms identity).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: callerProfile, error: profErr } = (await (admin as any)
    .from('profiles')
    .select('is_staff')
    .eq('id', callerId)
    .single()) as {
    data: { is_staff?: boolean } | null;
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (profErr || !callerProfile?.is_staff) {
    return jsonError(403, 'forbidden');
  }

  // 4. Self-guard.
  if (targetId === callerId) {
    return jsonError(400, 'cannot_impersonate_self');
  }

  // 5. Admin-guard: cannot impersonate other admins (D-05).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: targetProfile } = (await (admin as any)
    .from('profiles')
    .select('is_staff,email')
    .eq('id', targetId)
    .single()) as {
    data: { is_staff?: boolean; email?: string } | null;
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (targetProfile?.is_staff) {
    return jsonError(400, 'cannot_impersonate_admin');
  }

  // 6. Dispatch action.
  if (action === 'start') {
    return await handleStart(callerId, targetId, targetProfile?.email);
  }
  return await handleEnd(callerId, targetId);
}

async function handleStart(
  callerId: string,
  targetId: string,
  preFetchedEmail: string | undefined,
): Promise<Response> {
  // Resolve target email (fallback to admin.getUserById if profiles row had none).
  let targetEmail = preFetchedEmail;
  if (!targetEmail) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: tUser } = (await (admin as any).auth.admin.getUserById(targetId)) as {
      data: { user: { email?: string } | null };
      error: { message?: string } | null;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    targetEmail = tUser?.user?.email;
  }
  if (!targetEmail) {
    return jsonError(404, 'target_email_not_found');
  }

  const expiresAt = Date.now() + IMPERSONATION_TTL_MS;

  // Step 1: write app_metadata. A1 PROBE confirmed 336ms propagation to next JWT.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { error: updErr } = (await (admin as any).auth.admin.updateUserById(targetId, {
    app_metadata: {
      impersonator_id: callerId,
      impersonation_exp: expiresAt,
    },
  })) as { data: unknown; error: { message?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (updErr) {
    console.error('[admin-impersonate] updateUserById failed', updErr.message ?? 'unknown');
    return jsonError(500, 'internal');
  }

  // Step 2: mint magiclink. The admin's browser follows the link to assume the
  // target's session. The resulting JWT carries impersonator_id in app_metadata
  // → all RLS write-deny policies fire on subsequent REST calls.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: linkData, error: linkErr } = (await (admin as any).auth.admin.generateLink({
    type: 'magiclink',
    email: targetEmail,
  })) as {
    data: { properties?: { action_link?: string } } | null;
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (linkErr || !linkData?.properties?.action_link) {
    console.error('[admin-impersonate] generateLink failed', linkErr?.message ?? 'no_link');
    // Best-effort: roll back app_metadata write so we don't leave the target
    // in a half-impersonated state when the operator never gets a link.
    try {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      await (admin as any).auth.admin.updateUserById(targetId, {
        app_metadata: { impersonator_id: null, impersonation_exp: null },
      });
      /* eslint-enable @typescript-eslint/no-explicit-any */
    } catch {
      /* swallow — best-effort rollback */
    }
    return jsonError(500, 'link_mint_failed');
  }
  const actionLink = linkData.properties.action_link;

  // Step 3: audit row (service-role insert bypasses RLS; matches audit_trigger pattern).
  const callerHash = await sha256Hex(callerId);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  await (admin as any).from('audit_logs').insert({
    user_id: callerId,
    user_id_hash: callerHash,
    table_name: 'auth.users',
    row_id: targetId,
    action: 'impersonate_start',
    impersonator_id: callerId,
    target_user_id: targetId,
    metadata: { impersonation_exp: expiresAt },
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return jsonResponse(200, { action_link: actionLink, expires_at: expiresAt });
}

async function handleEnd(callerId: string, targetId: string): Promise<Response> {
  // Read current app_metadata to support idempotent no-op when nothing to clear.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: tUser } = (await (admin as any).auth.admin.getUserById(targetId)) as {
    data: { user: { app_metadata?: Record<string, unknown> } | null };
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const currentImpersonator = tUser?.user?.app_metadata?.impersonator_id;
  if (currentImpersonator == null) {
    // Idempotent no-op — neither updateUserById nor audit row.
    return jsonResponse(200, { ok: true, already_ended: true });
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { error: updErr } = (await (admin as any).auth.admin.updateUserById(targetId, {
    app_metadata: { impersonator_id: null, impersonation_exp: null },
  })) as { data: unknown; error: { message?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (updErr) {
    console.error('[admin-impersonate] updateUserById(end) failed', updErr.message ?? 'unknown');
    return jsonError(500, 'internal');
  }

  const callerHash = await sha256Hex(callerId);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  await (admin as any).from('audit_logs').insert({
    user_id: callerId,
    user_id_hash: callerHash,
    table_name: 'auth.users',
    row_id: targetId,
    action: 'impersonate_end',
    impersonator_id: callerId,
    target_user_id: targetId,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return jsonResponse(200, { ok: true });
}

// ============================================================================
// Dispatcher
// ============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await handle(req);
  } catch (e) {
    console.error('[admin-impersonate] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

// ============================================================================
// Test seam
// ============================================================================

export const __internal = {
  handle,
  bearerFromReq,
  setAdminForTest(client: unknown): void {
    _adminInstance = client as SupabaseClient;
  },
};
