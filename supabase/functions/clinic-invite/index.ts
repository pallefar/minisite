/**
 * `clinic-invite` Edge Function — Phase 9 Plan 09-06 backend slice.
 *
 * Single Deno.serve dispatcher serving four endpoints by URL pathname:
 *
 *   /functions/v1/clinic-invite/send    POST  JWT-authed operator
 *   /functions/v1/clinic-invite/lookup  GET   anon-OR-JWT (token in query)
 *   /functions/v1/clinic-invite/accept  POST  JWT-authed patient
 *   /functions/v1/clinic-invite/reject  POST  JWT-authed patient
 *
 * Invariants:
 *
 *   1. **D-02 + W-1 anti-enumeration on /send.** ALWAYS returns
 *      `{ok: true, invite_id: '<uuid>'}` regardless of whether the email
 *      maps to an existing `auth.users` row. The invite_id is generated
 *      server-side by the `send_invite` RPC (Plan 09-01). No branching on
 *      email existence is possible from this endpoint — the auth.users
 *      lookup is deferred to /lookup (where the token's existence is the
 *      auth secret) and /accept (where the JWT email is compared against
 *      invite.email).
 *
 *   2. **Pitfall #11 — no cookies.** CORS allows `*` Origin and NO
 *      `Access-Control-Allow-Credentials` header. Operator + patient
 *      authentication is via Authorization Bearer JWT; anonymous /lookup
 *      uses the URL token as the auth secret. There is no Set-Cookie
 *      header on any response.
 *
 *   3. **Pitfall #1 collapse.** The accept_invite_existing and
 *      accept_invite_new RPCs from Plan 09-01 have identical bodies (the
 *      `memberships UNIQUE(user_id, org_id) WHERE revoked_at IS NULL`
 *      partial index is the single-identity floor). This function always
 *      calls `accept_invite_existing` for simplicity.
 *
 *   4. **Rate limits, layered.** /send uses the Phase 4 DB-backed
 *      `increment_rate_limit` RPC keyed on `operator.user.id` (20/hour).
 *      /lookup uses an in-memory bucket keyed on IP-or-token (10/min).
 *      /accept uses an in-memory bucket keyed on invite_id (5/min). See
 *      rate-limit.ts for the rationale.
 *
 *   5. **JWT auth via operator-scoped Supabase client.** The Phase 9 RPCs
 *      (send_invite, accept_invite_existing, reject_invite) use
 *      `auth.uid()` for the operator/patient identity. We MUST issue the
 *      RPC call with a Supabase client that carries the user's JWT
 *      (NOT the service-role admin client) so `auth.uid()` resolves
 *      correctly. The admin client is used only for unauthenticated
 *      reads (e.g., the /lookup join on invites + orgs).
 *
 *   6. **CSP-clean.** No external origins introduced beyond
 *      `api.resend.com` (server-side only — never reaches the browser).
 *      The leanshot/vercel.json connect-src does NOT need to change.
 */
import 'jsr:@std/dotenv/load';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
// Phase 32 plan 32-05 (I18N-04): inviter-locale localization for the
// subject + plain-text alt. The recipient may not yet be a user (the W-1
// anti-enumeration invariant forbids branching on email existence here),
// so we resolve the INVITER's locale per plan 32-05 Task 3 Step 3 lock
// table — operator picks the language they speak with the patient.
import { renderInLocale } from '../_shared/i18n-server.ts';
import { resolveLocale } from '../_shared/profiles-locale.ts';
import {
  checkAcceptRateLimit,
  checkLookupRateLimit,
  checkSendRateLimit,
} from './rate-limit.ts';
import { sendInviteEmail } from './resend.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PUBLIC_APP_ORIGIN = Deno.env.get('PUBLIC_APP_ORIGIN') ?? 'https://app.leanshot.app';

// Service-role admin client — used only for:
//   - `admin.auth.getUser(jwt)`         (JWT → user.id resolution)
//   - `admin.auth.admin.listUsers`      (email-existence check in /lookup)
//   - `admin.from('invites').select`    (anonymous /lookup join)
//   - `admin.from('audit_logs').insert` (non-critical audit row from /send)
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface SendBody {
  org_id?: string;
  email?: string;
  requested_scope?: Record<string, unknown>;
}

interface AcceptBody {
  token?: string;
  consent_scope?: Record<string, unknown>;
}

interface RejectBody {
  token?: string;
}

interface LookupInvite {
  id: string;
  email: string;
  requested_scope: Record<string, unknown>;
  org: { id: string; name: string; logo_storage_path: string | null };
  operator_first_name: string;
  expires_at: string;
}

interface LookupResponse {
  state:
    | 'valid_logged_in'
    | 'valid_logged_out_existing'
    | 'valid_new_user'
    | 'expired'
    | 'already_used'
    | 'canceled'
    | 'not_found'
    | 'load_error';
  invite?: LookupInvite;
}

// =============================================================================
// Helpers
// =============================================================================

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function makeRawToken(): string {
  // 16 random bytes → 32-char url-safe base64.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

function clientIpFromReq(req: Request): string {
  // Supabase Edge Runtime sets `x-forwarded-for`. Take the leftmost entry
  // (the original client) since the platform appends edge hops on the right.
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const first = xff.split(',')[0]?.trim();
  if (first) return first;
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

function userScopedClient(jwt: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

async function publicLogoUrl(logoStoragePath: string | null): Promise<string | null> {
  if (!logoStoragePath) return null;
  try {
    const { data } = admin.storage.from('org-logos').getPublicUrl(logoStoragePath);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

async function operatorFirstNameFromInvitedBy(invitedBy: string | null): Promise<string> {
  // The `auth.users.raw_user_meta_data` `first_name` field is a soft contract.
  // Fall back to a generic name when missing.
  if (!invitedBy) return 'Your clinic';
  try {
    const { data } = await admin.auth.admin.getUserById(invitedBy);
    const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
    const first = typeof meta.first_name === 'string' ? meta.first_name : '';
    if (first.trim()) return first.trim();
    const email = data?.user?.email ?? '';
    if (email.includes('@')) {
      const local = email.split('@')[0] ?? '';
      if (local) return local;
    }
    return 'Your clinic';
  } catch {
    return 'Your clinic';
  }
}

async function emailExistsInAuth(email: string): Promise<boolean> {
  try {
    // listUsers `email` filter is supported in supabase-js v2 admin SDK.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data } = await (admin.auth.admin as any).listUsers({ email });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const users = (data?.users ?? []) as Array<{ id: string }>;
    return users.length > 0;
  } catch {
    return false;
  }
}

// =============================================================================
// /send (POST, operator-authed)
// =============================================================================

async function handleSend(req: Request): Promise<Response> {
  // 1. JWT presence.
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  // 2. Resolve operator from JWT via service-role admin (cheaper than a round-trip).
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonError(401, 'unauthenticated');
  const operator = userData.user;

  // 3. Per-operator rate limit (20/hour) — cheap gate before parsing.
  const allowed = await checkSendRateLimit(admin, operator.id);
  if (!allowed) return jsonError(429, 'rate_limited');

  // 4. Parse + validate body.
  let body: SendBody;
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return jsonError(400, 'bad_json');
  }
  const orgId = (body.org_id ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const requestedScope = body.requested_scope ?? {};
  if (!orgId || !email) return jsonError(400, 'missing_fields');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError(400, 'invalid_email');
  }

  // 5. Generate token + hash. Raw token is what we email; hash is what
  //    we persist via the RPC.
  const rawToken = makeRawToken();
  const tokenHash = await sha256Hex(rawToken);

  // 6. Call send_invite via an operator-scoped client so `auth.uid()`
  //    resolves to the operator inside the RPC.
  const operatorClient = userScopedClient(jwt);
  const { data: rpcData, error: rpcErr } = await operatorClient.rpc('send_invite', {
    p_email: email,
    p_org_id: orgId,
    p_invite_token_hash: tokenHash,
    p_requested_scope: requestedScope,
  });

  if (rpcErr) {
    // Map known RPC error codes to stable HTTP codes. T-09-33 (anti-
    // enumeration) is preserved because all the codes here are about
    // operator identity / permissions, never about the patient email.
    const code = rpcErr.code ?? '';
    const msg = (rpcErr.message ?? '').toLowerCase();
    if (code === '28000' || msg.includes('unauthenticated')) {
      return jsonError(401, 'unauthenticated');
    }
    if (code === '42501' || msg.includes('forbidden')) {
      return jsonError(403, 'forbidden');
    }
    console.error('[clinic-invite] send_invite RPC error', rpcErr.message);
    return jsonError(500, 'send_failed');
  }

  // RPC returns `table(invite_id uuid)` — supabase-js may give us
  // `data: [{invite_id}]` or `data: {invite_id}` depending on version.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const inviteRow = Array.isArray(rpcData) ? (rpcData[0] as any) : (rpcData as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const inviteId: string | undefined = inviteRow?.invite_id;
  if (!inviteId) {
    return jsonError(500, 'send_failed');
  }

  // 7. Resolve org for the email body (logo + name + operator first name).
  //    We use the admin client to read orgs because the operator-scoped
  //    client's RLS would also work here — admin is cheaper since we
  //    already know it's the operator's own org (RPC checked has_permission).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: orgRow } = await (admin.from('orgs').select('id, name, logo_storage_path').eq('id', orgId) as any).maybeSingle();
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const orgName = (orgRow?.name as string | undefined) ?? 'Your clinic';
  const orgLogoUrl = await publicLogoUrl((orgRow?.logo_storage_path as string | null | undefined) ?? null);
  const operatorFirstName = await operatorFirstNameFromInvitedBy(operator.id);
  const inviteUrl = `${PUBLIC_APP_ORIGIN}/clinic-invite/${rawToken}`;
  const expiresAtISO = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // 8. Dispatch via Resend. Failure does NOT block the response — the
  //    operator already created the invite, and email-provider hiccups
  //    are out-of-band. We log + still return the universal 200.
  //
  // Phase 32 plan 32-05 (I18N-04): localize subject + plain-text alt via
  // INVITER's profiles.locale (operator.id). Recipient may not yet be a
  // user, so we cannot resolve recipient locale here without violating
  // the W-1 anti-enumeration invariant.
  const lng = await resolveLocale(operator.id, admin);
  const i18nVars = {
    name: operatorFirstName,
    org_name: orgName,
    reset_url: inviteUrl,
  };
  const subjectOverride = await renderInLocale(lng, 'clinic_invite.subject', i18nVars);
  const textOverride = await renderInLocale(lng, 'clinic_invite.body', i18nVars);

  const dispatch = await sendInviteEmail({
    to: email,
    orgName,
    orgLogoUrl,
    operatorFirstName,
    inviteUrl,
    expiresAt: expiresAtISO,
    subjectOverride,
    textOverride,
  });
  if (!dispatch.ok) {
    console.error('[clinic-invite] resend dispatch failed', dispatch.error ?? 'unknown');
    // Write a best-effort audit row so the operator-side dashboard can
    // surface "email-undelivered" follow-up later. The send_invite RPC
    // already wrote a `membership_invite_sent` row; this is an extra
    // signal-only log so we suppress duplicate-trigger fires.
    try {
      await admin.from('audit_logs').insert({
        user_id: operator.id,
        user_id_hash: null,
        table_name: 'invites',
        row_id: inviteId,
        action: 'email_dispatch_failed',
        actor_type: 'org_operator',
        org_id: orgId,
      });
    } catch {
      /* best-effort — pre-existing audit_logs CHECK may not allow this action */
    }
  }

  // 9. Universal 200. W-1 invariant: response shape never branches on
  //    email existence (the RPC inserted a fresh invites row regardless,
  //    and we already shipped the email — both pathways converge here).
  return jsonResponse(200, { ok: true, invite_id: inviteId });
}

// =============================================================================
// /lookup (GET, anonymous-or-JWT)
// =============================================================================

async function handleLookup(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  if (!token) return jsonError(400, 'missing_token');

  // Rate-limit before any I/O (T-09-32 brute-force defense).
  const rlKey = `${clientIpFromReq(req)}:${token.slice(0, 8)}`;
  if (!checkLookupRateLimit(rlKey)) {
    return jsonError(429, 'rate_limited');
  }

  const tokenHash = await sha256Hex(token);

  // Anonymous SELECT via admin client (the invites RLS allows org-managers
  // and the patient-by-email — but the anonymous /lookup path needs the
  // admin's view to compute the state-machine branch).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: inviteRow } = await (admin
    .from('invites')
    .select(
      'id, email, org_id, invited_by, expires_at, accepted_at, rejected_at, consumed_at, requested_scope, orgs(id, name, logo_storage_path)',
    )
    .eq('invite_token_hash', tokenHash) as any).maybeSingle();
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (!inviteRow) {
    return jsonResponse(200, { state: 'not_found' } satisfies LookupResponse);
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const row = inviteRow as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Build the invite payload (only included for valid states). We
  // intentionally fetch operator_first_name even for terminal states so
  // the UI's StateE/StateG can show "Ask {clinic} for a new invite".
  const orgsRel = row.orgs ?? {};
  const operatorFirstName = await operatorFirstNameFromInvitedBy(row.invited_by ?? null);
  const inviteOut: LookupInvite = {
    id: row.id,
    email: row.email,
    requested_scope: (row.requested_scope ?? {}) as Record<string, unknown>,
    org: {
      id: orgsRel.id ?? row.org_id,
      name: orgsRel.name ?? 'Your clinic',
      logo_storage_path: orgsRel.logo_storage_path ?? null,
    },
    operator_first_name: operatorFirstName,
    expires_at: row.expires_at,
  };

  // Terminal states (order matters — already_used > canceled > expired).
  if (row.accepted_at) {
    return jsonResponse(200, { state: 'already_used', invite: inviteOut } satisfies LookupResponse);
  }
  if (row.rejected_at && row.consumed_at) {
    // Distinguish patient-rejection (rejected_at set, accepted_at null) from
    // operator-cancellation. cancel_invite RPC sets BOTH rejected_at and
    // consumed_at; reject_invite (patient) also does. From the patient's
    // perspective both are "already used" — they can't redeem either way.
    // The UI maps both to State F/G as a single closed-state message.
    return jsonResponse(200, { state: 'already_used', invite: inviteOut } satisfies LookupResponse);
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return jsonResponse(200, { state: 'expired', invite: inviteOut } satisfies LookupResponse);
  }

  // Live invite — branch on caller's auth state.
  const jwt = jwtFromReq(req);
  if (jwt) {
    const { data: ud } = await admin.auth.getUser(jwt);
    const callerEmail = (ud?.user?.email ?? '').toLowerCase();
    if (callerEmail && callerEmail === row.email.toLowerCase()) {
      return jsonResponse(200, { state: 'valid_logged_in', invite: inviteOut } satisfies LookupResponse);
    }
    // Caller is signed in but with a different email. Treat as logged-out
    // for the state-machine — they need to sign in as the invited address.
  }

  const exists = await emailExistsInAuth(row.email);
  if (exists) {
    return jsonResponse(200, { state: 'valid_logged_out_existing', invite: inviteOut } satisfies LookupResponse);
  }
  return jsonResponse(200, { state: 'valid_new_user', invite: inviteOut } satisfies LookupResponse);
}

// =============================================================================
// /accept (POST, patient-authed)
// =============================================================================

async function handleAccept(req: Request): Promise<Response> {
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  let body: AcceptBody;
  try {
    body = (await req.json()) as AcceptBody;
  } catch {
    return jsonError(400, 'bad_json');
  }
  const rawToken = (body.token ?? '').trim();
  const consentScope = body.consent_scope ?? {};
  if (!rawToken) return jsonError(400, 'missing_token');

  const tokenHash = await sha256Hex(rawToken);

  // We use the invite_id as the rate-limit key, but we don't know the
  // invite_id until we look up the invite. Resolve the invite_id via the
  // admin client first; if it doesn't exist, fall back to throttling on
  // the token-hash so an attacker can't burn through tokens by trying
  // unknown ones repeatedly.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: probe } = await (admin
    .from('invites')
    .select('id')
    .eq('invite_token_hash', tokenHash) as any).maybeSingle();
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const rlKey = probe?.id ?? `nf:${tokenHash.slice(0, 8)}`;
  if (!checkAcceptRateLimit(rlKey)) {
    return jsonError(429, 'rate_limited');
  }

  const patientClient = userScopedClient(jwt);
  // Pitfall #1 collapse: always call accept_invite_existing — the _new
  // variant has an identical body per Plan 09-01 RPC notes.
  const { data: rpcData, error: rpcErr } = await patientClient.rpc('accept_invite_existing', {
    p_invite_token_hash: tokenHash,
    p_consent_scope: consentScope,
  });

  if (rpcErr) {
    const code = rpcErr.code ?? '';
    const msg = (rpcErr.message ?? '').toLowerCase();
    if (code === '28000' || msg.includes('unauthenticated')) {
      return jsonError(401, 'unauthenticated');
    }
    if (msg.includes('invite_email_mismatch')) {
      return jsonError(403, 'email_mismatch');
    }
    if (msg.includes('invite_not_found_or_used')) {
      return jsonError(404, 'invalid_invite');
    }
    if (code === '22023' || msg.includes('consent_scope')) {
      return jsonError(400, 'invalid_scope');
    }
    if (code === '42501' || msg.includes('forbidden')) {
      return jsonError(403, 'forbidden');
    }
    console.error('[clinic-invite] accept_invite RPC error', rpcErr.message);
    return jsonError(500, 'accept_failed');
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (!row?.membership_id) return jsonError(500, 'accept_failed');
  return jsonResponse(200, {
    ok: true,
    membership_id: row.membership_id,
    org_id: row.org_id,
  });
}

// =============================================================================
// /reject (POST, patient-authed)
// =============================================================================

async function handleReject(req: Request): Promise<Response> {
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  let body: RejectBody;
  try {
    body = (await req.json()) as RejectBody;
  } catch {
    return jsonError(400, 'bad_json');
  }
  const rawToken = (body.token ?? '').trim();
  if (!rawToken) return jsonError(400, 'missing_token');

  const tokenHash = await sha256Hex(rawToken);

  const patientClient = userScopedClient(jwt);
  const { error: rpcErr } = await patientClient.rpc('reject_invite', {
    p_invite_token_hash: tokenHash,
  });
  if (rpcErr) {
    const code = rpcErr.code ?? '';
    const msg = (rpcErr.message ?? '').toLowerCase();
    if (code === '28000' || msg.includes('unauthenticated')) {
      return jsonError(401, 'unauthenticated');
    }
    if (msg.includes('invite_email_mismatch')) {
      return jsonError(403, 'email_mismatch');
    }
    if (msg.includes('invite_not_found_or_used')) {
      return jsonError(404, 'invalid_invite');
    }
    console.error('[clinic-invite] reject_invite RPC error', rpcErr.message);
    return jsonError(500, 'reject_failed');
  }
  return jsonResponse(200, { ok: true });
}

// =============================================================================
// Dispatcher
// =============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight — applies to ALL endpoints under this function.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  // Supabase Edge Functions are mounted at `/functions/v1/<name>/...`,
  // so the last path segment is what we dispatch on. We also accept the
  // bare function name `/clinic-invite` for local-dev convenience.
  const segments = url.pathname.split('/').filter(Boolean);
  // Find `clinic-invite` and take the next segment.
  const fnIdx = segments.indexOf('clinic-invite');
  const action = fnIdx >= 0 ? (segments[fnIdx + 1] ?? '') : (segments[segments.length - 1] ?? '');

  try {
    if (action === 'send') {
      if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
      return await handleSend(req);
    }
    if (action === 'lookup') {
      if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
      return await handleLookup(req);
    }
    if (action === 'accept') {
      if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
      return await handleAccept(req);
    }
    if (action === 'reject') {
      if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
      return await handleReject(req);
    }
    return jsonError(404, 'unknown_action');
  } catch (e) {
    console.error('[clinic-invite] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal_error');
  }
});

// =============================================================================
// Internal exports for the Deno test suite
// =============================================================================
export const __internal = {
  sha256Hex,
  makeRawToken,
  handleSend,
  handleLookup,
  handleAccept,
  handleReject,
};
