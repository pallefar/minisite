/**
 * `share` Edge Function — Phase 8 doctor read-share gate.
 *
 * Plan 08-02 deliverable. This is the only public-internet surface for the
 * read-share trust boundary: no JWT, no Authorization header — auth is the
 * 6-digit code on /redeem and the HttpOnly recipient cookie on /snapshot.
 *
 * ## Routes
 *   POST /redeem   — { token, code } → 200 + Set-Cookie (single-use code)
 *   GET  /snapshot?token=… (cookie required) → snapshot JSON
 *
 * ## Critical deviations from `ai-chat` (08-02-PLAN.md):
 *   1. **CORS** — ACAO echoes Origin from an env-driven allow-list, NEVER
 *      `*`, with `Access-Control-Allow-Credentials: true` (cookies). See
 *      `cors.ts` for rationale (Pitfalls 3 + 4, ME-4).
 *   2. **Rate-limit** — Per-share (Pitfall 5), keyed on `share_id`, NOT
 *      per-user. Implemented via `increment_share_attempt` RPC + the FSM
 *      ordered in HI-3 (see `handleRedeem` below).
 *   3. **No JWT verification** — `/redeem` is unauthenticated (the code IS
 *      the auth); `/snapshot` auth is the cookie. We DO NOT call
 *      `admin.auth.getUser(...)`.
 *
 * ## Threat-model mitigations enforced here
 *   T-08-S1 single-use code consumption via `redeem_share` RPC
 *   T-08-S2 cookie hash check on every /snapshot request
 *   T-08-S3 per-share bcrypt + rate-limit (5/min/share)
 *   T-08-T1 no `expires_at` mutation; revoke_share only writes revoked_at
 *   T-08-T2 Cache-Control: private, no-store + Vary: Origin, Cookie on every response
 *   T-08-I1 share_snapshot_view does NOT join the AI conversation table
 *   T-08-I2 never echo Postgres error strings — fixed `{error:'internal'}`
 *   T-08-I3 photo signed URL TTL = min(remaining_share_seconds, 300)
 *   T-08-R1 log_share_view called BEFORE snapshot SELECT; RPC error → 500
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { BASE_RESPONSE_HEADERS, buildCorsHeaders } from './cors.ts';
import { getRecipientCookie, setRecipientCookie } from './cookie.ts';
import { parseIpFamily, parseUaFamily, sha256Hex } from './hash.ts';

// ─── Module-level admin client ──────────────────────────────────────────────
// Service-role bypasses RLS — but Plan 08-02 BL-2 invariants apply: we only
// call the 4 designated RPCs + 2 SELECTs + 1 storage mint. No raw INSERT /
// UPDATE / DELETE on `shares` or `audit_logs` from this function — the RPCs
// are the audited mutation surface.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Constants ───────────────────────────────────────────────────────────────
const RATE_LIMIT_THRESHOLD = 5; // failed attempts allowed before 429
const RATE_LIMIT_WINDOW_SEC = 60; // sliding window for the per-share counter
const PHOTO_TTL_CAP_SEC = 300; // photo signed URL TTL ceiling (Pitfall, T-08-I3)
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/; // base64url, sized for v1 16-byte tokens
const CODE_PATTERN = /^\d{6}$/; // strict 6-digit ASCII

// ─── Public types (mirror src/types/share.ts at the wire layer) ──────────────
interface RedeemBody {
  token?: unknown;
  code?: unknown;
}

interface ShareRow {
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
  code_consumed_at: string | null;
  recipient_session_hash: string | null;
  access_code_hash: string;
  failed_attempts_count: number;
  last_attempt_at: string | null;
}

// ─── Response helpers ────────────────────────────────────────────────────────
function jsonError(
  status: number,
  code: string,
  headers: Record<string, string>,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(JSON.stringify({ error: code, ...extra }), { status, headers });
}

function jsonOk(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

// ─── Request signal extraction ──────────────────────────────────────────────
function extractRequestSignal(req: Request): { uaFamily: string; ipFamily: string } {
  const ua = req.headers.get('User-Agent') ?? '';
  const xff = req.headers.get('X-Forwarded-For') ?? '';
  return {
    uaFamily: parseUaFamily(ua),
    ipFamily: parseIpFamily(xff),
  };
}

// ─── Shares-row lookup by token hash ────────────────────────────────────────
async function findShareByToken(token: string): Promise<ShareRow | null> {
  const tokenHash = await sha256Hex(token);
  const { data, error } = await admin
    .from('shares')
    .select(
      'id, user_id, expires_at, revoked_at, code_consumed_at, recipient_session_hash, access_code_hash, failed_attempts_count, last_attempt_at',
    )
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) {
    console.error('[share] shares lookup error', error.message);
    throw new Error('shares-lookup-failed');
  }
  return (data as ShareRow | null) ?? null;
}

// ─── Lifecycle gates (revoked / expired / consumed) ─────────────────────────
type LifecycleError = 'revoked' | 'expired' | 'already-consumed' | null;

function gateLifecycle(share: ShareRow, checkConsumed: boolean): LifecycleError {
  if (share.revoked_at !== null) return 'revoked';
  if (Date.parse(share.expires_at) <= Date.now()) return 'expired';
  if (checkConsumed && share.code_consumed_at !== null) return 'already-consumed';
  return null;
}

// ─── /redeem handler ────────────────────────────────────────────────────────
//
// HI-3 — Rate-limit FSM ordering (DO NOT REORDER):
//   Step 5 READS `failed_attempts_count` BEFORE attempting the code verify;
//   step 7 INCREMENTS only AFTER a wrong code is observed. The step-5 read on
//   a subsequent request observes the increment from step 7 of the previous
//   request — this is the intended FSM. Reversing the order (incrementing
//   before the verify, or reading after) breaks the per-share rate-limit
//   invariant and can either undercount or double-count attempts. Do not
//   "optimize" this during refactor.
async function handleRedeem(req: Request, headers: Record<string, string>): Promise<Response> {
  // 1. Parse + validate body shape.
  let body: RedeemBody;
  try {
    body = (await req.json()) as RedeemBody;
  } catch {
    return jsonError(400, 'invalid-format', headers);
  }
  if (typeof body?.token !== 'string' || body.token === '') {
    return jsonError(400, 'missing-token', headers);
  }
  if (typeof body?.code !== 'string' || body.code === '') {
    return jsonError(400, 'missing-code', headers);
  }
  if (!TOKEN_PATTERN.test(body.token) || !CODE_PATTERN.test(body.code)) {
    return jsonError(400, 'invalid-format', headers);
  }
  const { token, code } = body as { token: string; code: string };

  // 2 + 3. token → hash → shares row lookup.
  const share = await findShareByToken(token);
  if (!share) return jsonError(404, 'not-found', headers);

  // 4. Lifecycle gates.
  const lifecycle = gateLifecycle(share, /* checkConsumed */ true);
  if (lifecycle === 'revoked') return jsonError(410, 'revoked', headers);
  if (lifecycle === 'expired') return jsonError(410, 'expired', headers);
  if (lifecycle === 'already-consumed') {
    return jsonError(410, 'already-consumed', headers);
  }

  // 5. HI-3 STEP 5 — Rate-limit READ. Read failed_attempts_count BEFORE
  //    attempting verify. The counter we observe here is the cumulative
  //    increment written by step 7 of previous failed requests. Do NOT
  //    reorder vs. step 7.
  const lastAttemptMs = share.last_attempt_at ? Date.parse(share.last_attempt_at) : 0;
  const windowOpen = Date.now() - lastAttemptMs < RATE_LIMIT_WINDOW_SEC * 1000;
  if (share.failed_attempts_count >= RATE_LIMIT_THRESHOLD && windowOpen) {
    const retryAfterSec = Math.max(
      1,
      RATE_LIMIT_WINDOW_SEC - Math.floor((Date.now() - lastAttemptMs) / 1000),
    );
    return jsonError(429, 'rate-limited', headers, { retry_after_sec: retryAfterSec });
  }

  // 6. Verify the 6-digit code via Plan 08-01 RPC (BL-2 — RPC shipped in Wave 1).
  const { data: verifyOk, error: verifyErr } = await admin.rpc('verify_share_code', {
    p_share_id: share.id,
    p_code: code,
  });
  if (verifyErr) {
    console.error('[share] verify_share_code RPC error', verifyErr.message);
    return jsonError(500, 'internal', headers);
  }

  if (!verifyOk) {
    // 7. HI-3 STEP 7 — Rate-limit WRITE. Increment ONLY after the verify
    //    returned false. Do NOT reorder vs. step 5.
    const { error: incErr } = await admin.rpc('increment_share_attempt', {
      p_share_id: share.id,
    });
    if (incErr) {
      console.error('[share] increment_share_attempt RPC error', incErr.message);
      // Still return invalid-code — rate-limit error shouldn't leak schema
      // details, and the next request will observe the un-incremented value
      // (slightly looser bound, but inverting the order to write-before-verify
      // is worse — see HI-3 note).
    }
    return jsonError(401, 'invalid-code', headers);
  }

  // 8. Code right — issue cookie + call redeem_share.
  const opaqueBytes = new Uint8Array(16);
  crypto.getRandomValues(opaqueBytes);
  const opaqueB64 = btoa(String.fromCharCode(...opaqueBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const opaqueHash = await sha256Hex(opaqueB64);

  const { uaFamily, ipFamily } = extractRequestSignal(req);

  const { error: redeemErr } = await admin.rpc('redeem_share', {
    p_share_id: share.id,
    p_recipient_session_hash: opaqueHash,
    p_ua_family: uaFamily,
    p_ip_family: ipFamily,
  });
  if (redeemErr) {
    // P0002 here = single-use race (someone else redeemed between our gate
    // check and the RPC). Surface as already-consumed for a stable UX.
    console.error('[share] redeem_share RPC error', redeemErr.message);
    if (redeemErr.code === 'P0002') {
      return jsonError(410, 'already-consumed', headers);
    }
    return jsonError(500, 'internal', headers);
  }

  // Cookie Max-Age must not outlive the share. Floor to seconds.
  const remainingMs = Date.parse(share.expires_at) - Date.now();
  const maxAgeSec = Math.max(1, Math.floor(remainingMs / 1000));

  // Build the response headers including Set-Cookie.
  const responseHeaders = new Headers(headers);
  setRecipientCookie(responseHeaders, opaqueB64, maxAgeSec);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: responseHeaders,
  });
}

// ─── /snapshot handler ──────────────────────────────────────────────────────
async function handleSnapshot(req: Request, headers: Record<string, string>): Promise<Response> {
  // 1. Parse token from query.
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  if (!token || !TOKEN_PATTERN.test(token)) {
    return jsonError(400, 'missing-token', headers);
  }

  // 2. Shares row lookup.
  const share = await findShareByToken(token);
  if (!share) return jsonError(404, 'not-found', headers);

  // 3. Lifecycle gates — DB-row check per request (D-02 SC#3 primary).
  // We do NOT check `code_consumed_at` here because the snapshot path is
  // post-consumption: an active cookie is the proof of redeem.
  const lifecycle = gateLifecycle(share, /* checkConsumed */ false);
  if (lifecycle === 'revoked') return jsonError(401, 'revoked', headers);
  if (lifecycle === 'expired') return jsonError(401, 'expired', headers);

  // 4. Cookie presence + binding.
  const cookieValue = getRecipientCookie(req);
  if (!cookieValue) return jsonError(401, 'requires-code', headers);
  const cookieHash = await sha256Hex(cookieValue);
  if (cookieHash !== share.recipient_session_hash) {
    return jsonError(401, 'invalid-session', headers);
  }

  // 5. Audit BEFORE serve (T-08-R1). RPC failure = 500, never silent success.
  const { uaFamily, ipFamily } = extractRequestSignal(req);
  const { error: auditErr } = await admin.rpc('log_share_view', {
    p_share_id: share.id,
    p_ua_family: uaFamily,
    p_ip_family: ipFamily,
  });
  if (auditErr) {
    console.error('[share] log_share_view RPC error', auditErr.message);
    return jsonError(500, 'internal', headers);
  }

  // 6. Read snapshot from share_snapshot_view (service-role grant).
  const { data: snapshot, error: snapErr } = await admin
    .from('share_snapshot_view')
    .select('*')
    .eq('user_id', share.user_id)
    .maybeSingle();
  if (snapErr) {
    console.error('[share] share_snapshot_view error', snapErr.message);
    return jsonError(500, 'internal', headers);
  }
  if (!snapshot) {
    return jsonError(404, 'not-found', headers);
  }

  // 7. Mint photo signed URLs. TTL = min(remaining_share_seconds, 300).
  const remainingMs = Date.parse(share.expires_at) - Date.now();
  const remainingSec = Math.max(1, Math.floor(remainingMs / 1000));
  const photoTtlSec = Math.min(remainingSec, PHOTO_TTL_CAP_SEC);

  const photosRaw = (snapshot as Record<string, unknown>).photos;
  if (Array.isArray(photosRaw)) {
    const signed = await Promise.all(
      photosRaw.map(async (p) => {
        const photo = p as { id?: string; timestamp?: string; storage_path?: string };
        if (!photo.storage_path) {
          return { ...photo, signed_url: '' };
        }
        const { data: signedData, error: signedErr } = await admin.storage
          .from('photos')
          .createSignedUrl(photo.storage_path, photoTtlSec);
        if (signedErr || !signedData?.signedUrl) {
          console.error('[share] createSignedUrl error', signedErr?.message ?? 'unknown');
          return { ...photo, signed_url: '' };
        }
        // Strip storage_path from the wire shape — recipient never needs the
        // raw bucket path; signed_url is sufficient and time-bound.
        return {
          id: photo.id,
          timestamp: photo.timestamp,
          signed_url: signedData.signedUrl,
        };
      }),
    );
    (snapshot as Record<string, unknown>).photos = signed;
  }

  // 8. Return 200 with snapshot + expires_at + share_id (BL-1 / D-02(c)).
  // `share_id` is the opaque uuid of the shares row — Plan 08-06's print
  // footer renders this; NEVER use snapshot.user_id (patient identifier).
  return jsonOk(
    200,
    {
      snapshot,
      expires_at: share.expires_at,
      share_id: share.id,
    },
    headers,
  );
}

// ─── Entry point ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req);

  // CORS preflight — base headers include Cache-Control: private, no-store
  // so even an OPTIONS response is uncacheable (ME-1 / Pitfall 7).
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: { ...BASE_RESPONSE_HEADERS, ...cors },
    });
  }

  const headers = { ...BASE_RESPONSE_HEADERS, ...cors };
  const url = new URL(req.url);

  try {
    if (url.pathname.endsWith('/redeem') && req.method === 'POST') {
      return await handleRedeem(req, headers);
    }
    if (url.pathname.endsWith('/snapshot') && req.method === 'GET') {
      return await handleSnapshot(req, headers);
    }
    return jsonError(404, 'not-found', headers);
  } catch (err) {
    // T-08-I2: never echo Postgres or other error messages to the client.
    console.error('[share] handler error', err instanceof Error ? err.message : 'unknown');
    return jsonError(500, 'internal', headers);
  }
});

// Exposed for unit tests — handler functions are not re-exported by default
// because Deno.serve binds them; the test suite imports these to invoke
// without spawning a real server.
export { handleRedeem, handleSnapshot };
