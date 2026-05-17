/**
 * `clinic-patient-invite` Edge Function — Phase 29 Plan 05.
 *
 * Ships the ORG-10 runtime: patient consent invites from clinic admins.
 * Blueprint: Phase 28 `clinic-org-invite/index.ts` (D-07).
 *
 * Routes:
 *   POST /functions/v1/clinic-patient-invite/send    — JWT-authed clinic admin
 *   POST /functions/v1/clinic-patient-invite/preview — anonymous; token in body
 *   POST /functions/v1/clinic-patient-invite/accept  — anonymous; two-phase D-08
 *
 * Invariants:
 *
 *   1. **W-1 anti-enumeration.** /send ALWAYS returns `{ok: true, invite_id: '<uuid>'}`
 *      regardless of whether patient_email maps to an existing `auth.users` row.
 *      The `send_org_patient_invite` RPC (Plan 29-02) inserts unconditionally.
 *
 *   2. **W-1 preview anti-enumeration.** /preview returns 404 with identical body
 *      `{ok: false, error: 'invite_not_found'}` for invalid, expired, OR used tokens.
 *
 *   3. **D-08 two-phase accept.** /accept calls `accept_org_patient_invite` RPC first
 *      (commits all DB writes atomically). After RPC success, calls
 *      `admin.auth.admin.generateLink` (best-effort). If generateLink fails: invite
 *      is still marked accepted; Sentry captures the warning; returns
 *      `{ok: false, error: 'magic_link_failed', invite_accepted: true}`.
 *
 *   4. **Startup health check.** If RESEND_API_KEY is absent, function logs a
 *      warning and proceeds (no-op send path). Invites still persist via the RPC.
 *
 *   5. **Non-PHI email only.** Email body contains org_name + accept-link only.
 *      NO patient name, NO diagnosis, NO dose values (HIPAA-safe per Phase 25 D-12).
 *
 *   6. **No cookies.** CORS `*` Origin, no `Access-Control-Allow-Credentials`.
 *      Authentication via Authorization Bearer JWT only (for /send).
 */

import 'jsr:@std/dotenv/load';
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as Sentry from '../_shared/sentry.ts';
import { corsHeaders } from './cors.ts';

// ---------------------------------------------------------------------------
// Startup health checks (per [[reference_vendor_gated_send_health_check]])
// ---------------------------------------------------------------------------

if (!Deno.env.get('RESEND_API_KEY')) {
  console.warn(
    '[clinic-patient-invite] RESEND_API_KEY missing; invites will be persisted but emails will NOT be sent',
  );
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const APP_ORIGIN = Deno.env.get('PUBLIC_APP_ORIGIN') ?? 'https://leanshot.app';
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'LeanShot <noreply@app.leanshot.app>';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, code: string, extra?: Record<string, unknown>): Response {
  return jsonResponse(status, { ok: false, error: code, ...extra });
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

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Generate a 64-hex-char random raw token (32 bytes of crypto-random).
 * Mirrors Phase 9 `makeInviteTokenHash` raw-token generation.
 */
function generateRawToken(): string {
  return crypto.getRandomValues(new Uint8Array(32)).reduce(
    (s, b) => s + b.toString(16).padStart(2, '0'),
    '',
  );
}

/**
 * SHA-256 hex hash of a raw token string.
 * Matches Phase 9 `hashInviteToken` (src/lib/clinic.ts:505) — UTF-8 encode then digest.
 */
async function hashToken(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Email dispatch — direct Resend (no-op if RESEND_API_KEY absent).
// Non-PHI template only: org_name + accept-link + expiry.
// NO patient_name, NO diagnosis, NO dose — per Phase 25 D-12.
// ---------------------------------------------------------------------------

interface PatientInviteEmailParams {
  to: string;
  inviteUrl: string;
  expiresDays: number;
}

async function sendPatientInviteEmail(params: PatientInviteEmailParams): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');

  // Health check gate: no-op if key absent.
  if (!apiKey) {
    console.warn('[clinic-patient-invite] Email skipped: RESEND_API_KEY not configured');
    return;
  }

  // CI stub: skip HTTPS dispatch.
  if (apiKey === 'test-stub') {
    return;
  }

  const subject = 'You have been invited to connect with a clinic on LeanShot';
  const acceptUrl = params.inviteUrl;
  const text =
    `A clinic has invited you to connect your treatment tracking on LeanShot.\n\n` +
    `Accept your invitation (expires in ${params.expiresDays} days): ${acceptUrl}\n\n` +
    `If you did not expect this invitation, you can safely ignore this email.`;

  const html = `
    <p>A clinic has invited you to connect your treatment tracking on LeanShot.</p>
    <p><a href="${acceptUrl}">Accept Invitation</a> (expires in ${params.expiresDays} days)</p>
    <p>If you did not expect this invitation, you can safely ignore this email.</p>
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
      console.error(`[clinic-patient-invite] resend non-2xx: ${res.status}`);
    }
    try { await res.text(); } catch { /* drain */ }
  } catch (e) {
    console.error('[clinic-patient-invite] resend fetch threw', e instanceof Error ? e.name : 'unknown');
  }
}

// ---------------------------------------------------------------------------
// /send route — JWT-required clinic admin
// ---------------------------------------------------------------------------

interface SendBody {
  org_id?: string;
  patient_email?: string;
  consent_scope?: Record<string, unknown>;
}

async function handleSend(req: Request): Promise<Response> {
  // 1. JWT presence.
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  // 2. Parse + validate body.
  let body: SendBody;
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return jsonError(400, 'bad_json');
  }

  const orgId = (body.org_id ?? '').trim();
  const patientEmail = (body.patient_email ?? '').trim().toLowerCase();
  const consentScope = body.consent_scope ?? {};

  if (!orgId || !patientEmail) return jsonError(400, 'missing_fields');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patientEmail)) return jsonError(400, 'invalid_email');

  // 3. Generate raw token + hash.
  const rawToken = generateRawToken();
  const tokenHash = await hashToken(rawToken);

  // 4. Call send_org_patient_invite RPC via user-scoped client so auth.uid() resolves
  //    to the caller inside the SECDEF function. The RPC enforces the admin role check
  //    (Pattern S1 dual-layer). RPC never branches on email existence — W-1 invariant.
  const userClient = userScopedClient(jwt);
  const { data: rpcData, error: rpcErr } = await userClient.rpc('send_org_patient_invite', {
    p_org_id: orgId,
    p_patient_email: patientEmail,
    p_invite_token_hash: tokenHash,
    p_consent_scope: consentScope,
  });

  if (rpcErr) {
    const code = rpcErr.code ?? '';
    const msg = (rpcErr.message ?? '').toLowerCase();
    if (code === '28000' || msg.includes('unauthenticated')) return jsonError(401, 'unauthenticated');
    if (code === '42501' || msg.includes('forbidden')) return jsonError(403, 'forbidden');
    console.error('[clinic-patient-invite] send_org_patient_invite RPC error', rpcErr.message);
    return jsonError(500, 'send_failed');
  }

  // RPC returns the invite_id.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rpcRow = Array.isArray(rpcData) ? (rpcData[0] as any) : (rpcData as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const inviteId: string | undefined = rpcRow?.invite_id ?? (typeof rpcData === 'string' ? rpcData : undefined);

  if (!inviteId) {
    console.error('[clinic-patient-invite] send_org_patient_invite returned no invite_id', rpcData);
    return jsonError(500, 'send_failed');
  }

  // 5. Dispatch non-PHI email (no-op + warn if key absent — health check gate).
  //    Email body: accept-link + expiry only. NO patient name, NO clinical context.
  const inviteUrl = `${APP_ORIGIN}/accept-clinic-invite?token=${rawToken}`;
  await sendPatientInviteEmail({ to: patientEmail, inviteUrl, expiresDays: 14 });

  // 6. W-1 invariant: always return 200 + {invite_id}.
  return jsonResponse(200, { ok: true, invite_id: inviteId });
}

// ---------------------------------------------------------------------------
// /preview route — anonymous
// ---------------------------------------------------------------------------

interface PreviewBody {
  token?: string;
}

async function handlePreview(req: Request): Promise<Response> {
  // Parse body.
  let body: PreviewBody;
  try {
    body = (await req.json()) as PreviewBody;
  } catch {
    return jsonError(400, 'bad_json');
  }

  const rawToken = (body.token ?? '').trim();
  if (!rawToken) return jsonError(404, 'invite_not_found');

  const tokenHash = await hashToken(rawToken);

  // Call preview RPC via admin client (anonymous-callable per D-08 step 1).
  const admin = adminClient();
  const { data, error } = await admin.rpc('accept_org_patient_invite_preview', {
    p_invite_token_hash: tokenHash,
  });

  // W-1: identical 404 for invalid, expired, AND used tokens — anti-enumeration.
  if (error) {
    return jsonError(404, 'invite_not_found');
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const row = Array.isArray(data) ? (data[0] as any) : (data as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (!row) {
    return jsonError(404, 'invite_not_found');
  }

  return jsonResponse(200, {
    ok: true,
    org_name: row.org_name ?? null,
    org_logo_url: row.org_logo_url ?? null,
    scope_summary: row.scope_summary ?? {},
  });
}

// ---------------------------------------------------------------------------
// /accept route — anonymous; two-phase D-08
// ---------------------------------------------------------------------------

interface AcceptBody {
  token?: string;
  patient_email?: string;
}

async function handleAccept(req: Request): Promise<Response> {
  // Parse body.
  let body: AcceptBody;
  try {
    body = (await req.json()) as AcceptBody;
  } catch {
    return jsonError(400, 'bad_json');
  }

  const rawToken = (body.token ?? '').trim();
  const patientEmail = (body.patient_email ?? '').trim().toLowerCase();

  if (!rawToken || !patientEmail) return jsonError(400, 'missing_fields');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patientEmail)) return jsonError(400, 'invalid_email');

  const tokenHash = await hashToken(rawToken);
  const admin = adminClient();

  // Phase 1 (commit): call accept_org_patient_invite RPC atomically.
  // The RPC (Plan 29-02) handles: user lookup/create, primary_org_id set,
  // org_consent_grants write, org_patient_links write, invite accepted_at mark.
  // If this fails, return error — nothing committed.
  const { error: rpcErr } = await admin.rpc('accept_org_patient_invite', {
    p_invite_token_hash: tokenHash,
  });

  if (rpcErr) {
    const code = rpcErr.code ?? '';
    const msg = (rpcErr.message ?? '').toLowerCase();
    if (code === 'P0002' || msg.includes('not found') || msg.includes('expired') || msg.includes('accepted')) {
      return jsonError(404, 'invite_not_found');
    }
    console.error('[clinic-patient-invite] accept_org_patient_invite RPC error', rpcErr.message);
    return jsonError(500, 'accept_failed');
  }

  // Phase 2 (post-commit best-effort): mint magic link.
  // If generateLink fails: invite is STILL accepted (source of truth is the DB).
  // Log warning to Sentry; return a usable fallback redirect.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: patientEmail,
    options: {
      redirectTo: `${APP_ORIGIN}/dashboard?welcome=clinic`,
    },
  });

  if (linkErr) {
    Sentry.captureMessage(
      'accept_org_patient_invite generateLink failed — invite accepted but no magic-link',
      {
        level: 'warning',
        extra: { patient_email_hash: tokenHash },
      },
    );
    console.error('[clinic-patient-invite] generateLink failed (invite committed):', linkErr.message);
    // Patient can request fresh magic link from standard login path.
    return jsonResponse(200, {
      ok: false,
      error: 'magic_link_failed',
      invite_accepted: true,
      redirect_url: `${APP_ORIGIN}/login?email=${encodeURIComponent(patientEmail)}&hint=recover`,
    });
  }

  const actionLink = linkData?.properties?.action_link;
  if (!actionLink) {
    Sentry.captureMessage(
      'accept_org_patient_invite generateLink returned no action_link',
      {
        level: 'warning',
        extra: { patient_email_hash: tokenHash },
      },
    );
    return jsonResponse(200, {
      ok: false,
      error: 'magic_link_failed',
      invite_accepted: true,
      redirect_url: `${APP_ORIGIN}/login?email=${encodeURIComponent(patientEmail)}&hint=recover`,
    });
  }

  return jsonResponse(200, { ok: true, redirect_url: actionLink });
}

// ---------------------------------------------------------------------------
// Dispatcher — exported for testability
// ---------------------------------------------------------------------------

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const fnIdx = segments.indexOf('clinic-patient-invite');
  const action = fnIdx >= 0 ? (segments[fnIdx + 1] ?? '') : (segments[segments.length - 1] ?? '');

  try {
    if (action === 'send') {
      if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
      return await handleSend(req);
    }
    if (action === 'preview') {
      if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
      return await handlePreview(req);
    }
    if (action === 'accept') {
      if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
      return await handleAccept(req);
    }
    return jsonError(404, 'unknown_action');
  } catch (e) {
    console.error('[clinic-patient-invite] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal_error');
  }
}

Deno.serve(handler);
