/**
 * `clinic-org-invite` Edge Function — Phase 28 Plan 01-02 backend slice.
 *
 * Sibling to Phase 9's `clinic-invite` function. Handles org-admin invites
 * (via org_invites table) as a PARALLEL table / function — NOT a discriminator
 * on Phase 9's clinic-invite/send (per addendum A2).
 *
 * Single endpoint:
 *   POST /functions/v1/clinic-org-invite/send  — JWT-authed org admin
 *
 * Invariants:
 *
 *   1. **W-1 anti-enumeration.** ALWAYS returns `{ok: true, invite_id: '<uuid>'}`
 *      regardless of whether the email maps to an existing `auth.users` row.
 *      The `send_org_invite` RPC (Plan 28-01) never branches on email existence
 *      — the invite row is always created and returned. This is identical in
 *      spirit to Phase 9 clinic-invite/send W-1 invariant (addendum A2).
 *
 *   2. **makeInviteTokenHash parity.** The hash logic below matches Phase 9's
 *      `src/lib/clinic.ts:makeInviteTokenHash` exactly:
 *        SHA-256(UTF-8(hexToken)) → hex string.
 *      The DB-side `send_org_invite` RPC uses pgcrypto's equivalent:
 *        encode(digest(token, 'sha256'), 'hex').
 *      NOTE: In this Edge Function, we do NOT call makeInviteTokenHash directly
 *      (the _shared/ module is owned by Plan-02). Instead, the Edge Function
 *      calls `send_org_invite` RPC which generates the token + hash server-side
 *      (per the P28 SECDEF RPC design). The invite_id is returned by the RPC.
 *
 *   3. **Startup health check.** If RESEND_API_KEY is absent, function logs a
 *      warning and proceeds (no-op send path). Invites are still persisted via
 *      the RPC; only the email dispatch is skipped.
 *
 *   4. **No cookies.** CORS `*` Origin, no `Access-Control-Allow-Credentials`.
 *      Authentication via Authorization Bearer JWT only.
 */

import 'jsr:@std/dotenv/load';
import { createClient } from 'npm:@supabase/supabase-js@2';
// Phase 32 plan 32-05 (I18N-04): inviter-locale localization for the
// subject + plain-text alt. Recipient may not yet be a user (W-1
// anti-enumeration). Resolve INVITER's locale per plan 32-05 Task 3 lock.
import { renderInLocale } from '../_shared/i18n-server.ts';
import { resolveLocale } from '../_shared/profiles-locale.ts';

// ---------------------------------------------------------------------------
// Startup health check (per [[reference_vendor_gated_send_health_check]])
// ---------------------------------------------------------------------------

if (!Deno.env.get('RESEND_API_KEY')) {
  console.warn(
    '[clinic-org-invite] RESEND_API_KEY missing; invites will be persisted but emails will NOT be sent',
  );
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PUBLIC_APP_ORIGIN = Deno.env.get('PUBLIC_APP_ORIGIN') ?? 'https://app.leanshot.app';
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'LeanShot <noreply@app.leanshot.app>';

// Service-role admin client — used only for JWT verification.
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function userScopedClient(jwt: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

// ---------------------------------------------------------------------------
// Email dispatch via Resend (no-op if RESEND_API_KEY absent)
// ---------------------------------------------------------------------------

interface OrgInviteEmailParams {
  to: string;
  orgName: string;
  invitedRole: string;
  inviteUrl: string;
  expiresAt: string;
  /** Phase 32 plan 32-05: locale-rendered subject from _shared/i18n-server.ts */
  subjectOverride?: string;
  /** Phase 32 plan 32-05: locale-rendered plain-text alt */
  textOverride?: string;
}

async function sendOrgInviteEmail(params: OrgInviteEmailParams): Promise<{ ok: boolean }> {
  const apiKey = Deno.env.get('RESEND_API_KEY');

  // Health check gate: no-op if key absent.
  if (!apiKey) {
    console.warn('[clinic-org-invite] Email skipped: RESEND_API_KEY not configured');
    return { ok: true };
  }

  // CI stub: skip HTTPS dispatch.
  if (apiKey === 'test-stub') {
    return { ok: true };
  }

  // Phase 32 plan 32-05 (I18N-04): caller passes locale-rendered subject +
  // text; fall back to legacy EN literals when absent.
  const subject = params.subjectOverride ?? `You've been invited to join a clinic on LeanShot`;
  const text =
    params.textOverride ??
    (`You've been invited as a ${params.invitedRole} to join a clinic on LeanShot.\n\n` +
      `Accept your invitation: ${params.inviteUrl}\n\n` +
      `This invitation expires on ${new Date(params.expiresAt).toLocaleDateString()}.`);

  const html = `
    <p>You've been invited as a <strong>${params.invitedRole}</strong> to join a clinic on LeanShot.</p>
    <p><a href="${params.inviteUrl}">Accept Invitation</a></p>
    <p>This invitation expires on ${new Date(params.expiresAt).toLocaleDateString()}.</p>
  `.trim();

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM, to: params.to, subject, html, text }),
    });
    if (!res.ok) {
      console.error(`[clinic-org-invite] resend non-2xx: ${res.status}`);
      return { ok: false };
    }
    try { await res.text(); } catch { /* drain */ }
    return { ok: true };
  } catch (e) {
    console.error('[clinic-org-invite] resend fetch threw', e instanceof Error ? e.name : 'unknown');
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// /send handler
// ---------------------------------------------------------------------------

interface SendBody {
  org_id?: string;
  email?: string;
  role?: string;
}

type OrgMemberRole = 'admin' | 'staff' | 'viewer';

const VALID_ROLES: Set<string> = new Set(['admin', 'staff', 'viewer']);

async function handleSend(req: Request): Promise<Response> {
  // 1. JWT presence.
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  // 2. Resolve caller from JWT.
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonError(401, 'unauthenticated');

  // 3. Parse + validate body.
  let body: SendBody;
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return jsonError(400, 'bad_json');
  }

  const orgId = (body.org_id ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const role = (body.role ?? '').trim();

  if (!orgId || !email || !role) return jsonError(400, 'missing_fields');
  if (!VALID_ROLES.has(role)) return jsonError(400, 'invalid_role');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError(400, 'invalid_email');

  // 4. Call send_org_invite RPC via user-scoped client so auth.uid() resolves
  //    to the caller inside the SECDEF function. The RPC enforces the admin
  //    role check (Pattern S1 dual-layer).
  const operatorClient = userScopedClient(jwt);
  const { data: rpcData, error: rpcErr } = await operatorClient.rpc('send_org_invite', {
    p_org_id: orgId,
    p_email: email,
    p_role: role as OrgMemberRole,
  });

  if (rpcErr) {
    const code = rpcErr.code ?? '';
    const msg = (rpcErr.message ?? '').toLowerCase();
    if (code === '28000' || msg.includes('unauthenticated')) return jsonError(401, 'unauthenticated');
    if (code === '42501' || msg.includes('forbidden')) return jsonError(403, 'forbidden');
    console.error('[clinic-org-invite] send_org_invite RPC error', rpcErr.message);
    return jsonError(500, 'send_failed');
  }

  // RPC returns jsonb {invite_id, token}.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rpcRow = Array.isArray(rpcData) ? (rpcData[0] as any) : (rpcData as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const inviteId: string | undefined = rpcRow?.invite_id;
  const rawToken: string | undefined = rpcRow?.token;

  if (!inviteId) return jsonError(500, 'send_failed');

  // 5. Dispatch email (no-op + warn if key absent — health check gate).
  if (rawToken) {
    const inviteUrl = `${PUBLIC_APP_ORIGIN}/clinic-org-invite/${rawToken}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Phase 32 plan 32-05 (I18N-04): localize via INVITER's profiles.locale.
    // Recipient may not yet be a user (W-1 anti-enumeration).
    const lng = await resolveLocale(userData.user.id, admin);
    const i18nVars = {
      org_name: 'Your clinic',
      role,
      reset_url: inviteUrl,
    };
    const subjectOverride = await renderInLocale(lng, 'clinic_org_invite.subject', i18nVars);
    const textOverride = await renderInLocale(lng, 'clinic_org_invite.body', i18nVars);

    const dispatch = await sendOrgInviteEmail({
      to: email,
      orgName: 'Your clinic',
      invitedRole: role,
      inviteUrl,
      expiresAt,
      subjectOverride,
      textOverride,
    });
    if (!dispatch.ok) {
      console.error('[clinic-org-invite] email dispatch failed (invite persisted)');
    }
  }

  // 6. W-1 invariant: always return 200 + {invite_id}.
  // Identical shape regardless of whether p_email exists in auth.users.
  return jsonResponse(200, { ok: true, invite_id: inviteId });
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const fnIdx = segments.indexOf('clinic-org-invite');
  const action = fnIdx >= 0 ? (segments[fnIdx + 1] ?? '') : (segments[segments.length - 1] ?? '');

  try {
    if (action === 'send') {
      if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
      return await handleSend(req);
    }
    return jsonError(404, 'unknown_action');
  } catch (e) {
    console.error('[clinic-org-invite] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal_error');
  }
});
