/**
 * `admin-reset-totp` Edge Function — Phase 24 Plan 24-05 (D-08 / ADMIN-03).
 *
 * Superadmin-only: clears a target admin user's TOTP factor, sends them an
 * enrollment link via Resend, and writes an audit log via the reset_totp RPC.
 *
 *   POST /functions/v1/admin-reset-totp    (verify_jwt = true)
 *
 * Request body:
 *   { target_user_id: <uuid> }
 *
 * Responses:
 *   200 { ok: true, email_sent: boolean }
 *   401 unauthorized           — missing/invalid bearer
 *   403 forbidden              — caller not superadmin
 *   400 invalid_body           — missing/malformed target_user_id
 *   500 internal               — unexpected error
 *
 * Invariants:
 *   1. is_staff + superadmin re-checked SERVER-SIDE via reset_totp RPC (which also
 *      checks is_admin_at_least('superadmin')). Gateway verify_jwt only confirms identity.
 *   2. reset_totp RPC handles: MFA factor deletion + has_totp=false + audit log.
 *   3. Edge Function handles: email sending via Resend _shared/lifecycle-send.ts helper.
 *   4. captureServer({ event: 'admin_action', properties: { action_name: 'reset_totp' } })
 *      called server-side; shutdownPostHog() in finally per PITFALL 1.
 *   5. Lazy admin singleton via Proxy (analog: admin-impersonate/index.ts).
 *
 * Test seam: __internal.setAdminForTest(fake) + __internal.handle(req).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';
import { sendResendEmail } from '../_shared/lifecycle-send.ts';

// Lazy env reads
const getSupabaseUrl = () => Deno.env.get('SUPABASE_URL') ?? '';
const getSupabaseServiceRoleKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
// after import (test suite stubs the admin AFTER importing this module).
// deno-lint-ignore no-explicit-any
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
  let body: { target_user_id?: string };
  try {
    body = (await req.json()) as { target_user_id?: string };
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const targetId = body.target_user_id;
  if (!targetId || typeof targetId !== 'string' || !UUID_RE.test(targetId)) {
    return jsonError(400, 'invalid_target_user_id');
  }

  // 2. Identify caller from bearer
  const bearer = bearerFromReq(req);
  if (!bearer) return jsonError(401, 'unauthorized');

  // deno-lint-ignore no-explicit-any
  const { data: callerData, error: callerErr } = (await (admin as any).auth.getUser(
    bearer,
  )) as {
    data: { user: { id: string; email?: string } | null };
    error: { message?: string } | null;
  };
  if (callerErr || !callerData?.user) {
    return jsonError(401, 'unauthorized');
  }
  const callerId = callerData.user.id;

  // 3. Resolve caller's profile (is_staff + admin_role check pre-RPC)
  // deno-lint-ignore no-explicit-any
  const { data: callerProfile, error: profErr } = (await (admin as any)
    .from('profiles')
    .select('is_staff, admin_role')
    .eq('id', callerId)
    .single()) as {
    data: { is_staff?: boolean; admin_role?: string } | null;
    error: { message?: string } | null;
  };
  if (profErr || !callerProfile?.is_staff || callerProfile.admin_role !== 'superadmin') {
    return jsonError(403, 'forbidden');
  }

  // 4. Get target user's email for the re-enrollment notification
  // deno-lint-ignore no-explicit-any
  const { data: targetUserData } = (await (admin as any).auth.admin.getUserById(
    targetId,
  )) as {
    data: { user: { email?: string } | null };
    error: { message?: string } | null;
  };
  const targetEmail = targetUserData?.user?.email;

  // 5. Call reset_totp RPC (handles MFA deletion + has_totp=false + audit log)
  // We use the service-role client so the RPC runs with postgres privileges.
  // deno-lint-ignore no-explicit-any
  const { error: rpcErr } = (await (admin as any).rpc('reset_totp', {
    p_target_user_id: targetId,
  })) as { data: unknown; error: { message?: string } | null };
  if (rpcErr) {
    console.error('[admin-reset-totp] reset_totp RPC failed', rpcErr.message ?? 'unknown');
    return jsonError(500, 'rpc_failed');
  }

  // 6. Generate a magic-link enrollment URL for the target user
  let actionLink: string | null = null;
  if (targetEmail) {
    // deno-lint-ignore no-explicit-any
    const { data: linkData, error: linkErr } = (await (admin as any).auth.admin.generateLink({
      type: 'magiclink',
      email: targetEmail,
    })) as {
      data: { properties?: { action_link?: string } } | null;
      error: { message?: string } | null;
    };
    if (!linkErr && linkData?.properties?.action_link) {
      actionLink = linkData.properties.action_link;
    }
  }

  // 7. Send email notification to target user (non-fatal if it fails)
  let emailSent = false;
  if (targetEmail && actionLink) {
    const emailResult = await sendResendEmail({
      to: targetEmail,
      subject: 'Your LeanShot Admin 2FA has been reset',
      html: `
        <p>Hi,</p>
        <p>A superadmin has reset your two-factor authentication on LeanShot Admin.</p>
        <p>Please <a href="${actionLink}">click here to sign in and set up 2FA again</a>.</p>
        <p>If you did not expect this, contact your system administrator immediately.</p>
        <p>— LeanShot Admin</p>
      `,
      text: `Your LeanShot Admin 2FA has been reset by a superadmin.\n\nSign in to re-enroll: ${actionLink}\n\nIf you did not expect this, contact your system administrator.`,
    });
    emailSent = emailResult.ok;
    if (!emailResult.ok) {
      console.warn('[admin-reset-totp] email send failed:', emailResult.error ?? 'unknown');
    }
  }

  // 8. Capture PostHog event (non-fatal; shutdownPostHog in finally)
  try {
    captureServer({
      userId: callerId,
      event: 'admin_action',
      properties: { action_name: 'reset_totp', target_user_id: targetId },
    });
  } catch (e) {
    console.warn('[admin-reset-totp] captureServer failed:', e);
  }

  return jsonResponse(200, { ok: true, email_sent: emailSent });
}

// ============================================================================
// Dispatcher
// ============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await handle(req);
  } catch (e) {
    console.error('[admin-reset-totp] unhandled', e instanceof Error ? e.message : 'unknown');
    return new Response(JSON.stringify({ error: 'internal' }), {
      status: 500,
      headers: corsHeaders,
    });
  } finally {
    await shutdownPostHog();
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
