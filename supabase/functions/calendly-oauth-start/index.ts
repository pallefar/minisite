/**
 * `calendly-oauth-start` Edge Function — Phase 41 Plan 41-04 (EMBED-08).
 *
 * Entry point for the PageEditor Calendly inline-preview popup-OAuth flow.
 * V13-EMBED pitfall locks the preview to a popup (NOT a nested iframe — modern
 * browsers block 3p-cookie iframe OAuth via Safari ITP / Chrome 3p-cookie
 * phase-out).
 *
 * Responsibilities:
 *   1. Validate the caller is an authenticated Supabase user (JWT in
 *      `Authorization: Bearer <jwt>` header). Anon → 401.
 *   2. Read OAuth client config from Function Secrets:
 *        - CALENDLY_OAUTH_CLIENT_ID
 *        - CALENDLY_OAUTH_REDIRECT_URI
 *        - OAUTH_STATE_SECRET   (HMAC key for CSRF state)
 *      If any is missing → return 500 `{error:'oauth_not_configured'}`. This
 *      lets the popup render a clean error page instead of a Deno crash.
 *   3. Mint an HMAC-signed state token: `<payloadB64Url>.<sigB64Url>` where
 *      payload is `{u: userId, e: expiresAtMs}` with `e = Date.now()+600_000`.
 *      No DB writes — state is stateless / verified by recomputing HMAC in
 *      the callback (avoids a 3rd migration in this plan).
 *   4. Issue a 302 redirect to Calendly's authorize endpoint, carrying the
 *      signed state through.
 *
 * Threat refs (per 41-04-PLAN.md `<threat_model>`):
 *   - T-41-04-03: client_secret is NEVER read in this Fn — it lives only in
 *     `calendly-oauth-callback`. Start Fn uses `client_id` only.
 *   - T-41-04-05: CSRF — HMAC-signed state with 10-min expiry; attacker
 *     cannot forge state without `OAUTH_STATE_SECRET`.
 *   - T-41-04-06: open redirect — `redirect_uri` is server-side env only;
 *     never accepted from client.
 *
 * Deploy: deferred to Plan 41-06 closeout (aggregated `supabase functions
 * deploy` + `supabase db push --linked`).
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

// =============================================================================
// Env helpers (lazy + defensive)
// =============================================================================

function env(name: string, fallback = ''): string {
  return Deno.env.get(name) ?? fallback;
}

const getSupabaseUrl = () => env('SUPABASE_URL');
const getSupabaseServiceRoleKey = () => env('SUPABASE_SERVICE_ROLE_KEY');
const getCalendlyClientId = () => env('CALENDLY_OAUTH_CLIENT_ID');
const getCalendlyRedirectUri = () => env('CALENDLY_OAUTH_REDIRECT_URI');
const getOAuthStateSecret = () => env('OAUTH_STATE_SECRET');

const CALENDLY_AUTHORIZE_URL = 'https://auth.calendly.com/oauth/authorize';

// =============================================================================
// Admin Supabase client (lazy + test-injectable)
// =============================================================================

// deno-lint-ignore no-explicit-any
let _adminInstance: any = null;

// deno-lint-ignore no-explicit-any
function getAdmin(): any {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}

const adminInstance = new Proxy({} as Record<string | symbol, unknown>, {
  // deno-lint-ignore no-explicit-any
  get(_t: any, prop: string | symbol): unknown {
    const a = getAdmin();
    const val = a[prop];
    return typeof val === 'function' ? val.bind(a) : val;
  },
});

export function __setAdminForTest(fakeAdmin: unknown): void {
  _adminInstance = fakeAdmin;
}

// =============================================================================
// HMAC-signed state helpers (shared logic with the callback Fn)
// =============================================================================

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  // base64 → base64url. Drop padding (`=`) — callback re-pads before decode.
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacSha256(key: string, msg: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return new Uint8Array(sig);
}

export async function signState(
  userId: string,
  ttlMs: number,
  secret: string,
): Promise<string> {
  const expiresAt = Date.now() + ttlMs;
  const payloadJson = JSON.stringify({ u: userId, e: expiresAt });
  const payloadB64 = b64urlEncode(new TextEncoder().encode(payloadJson));
  const sig = await hmacSha256(secret, payloadB64);
  const sigB64 = b64urlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

// =============================================================================
// JWT helper
// =============================================================================

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

// =============================================================================
// Response helpers
// =============================================================================

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

// =============================================================================
// handleStart
// =============================================================================

export async function handleStart(req: Request): Promise<Response> {
  // 1. JWT presence — popup is opened from authenticated PageEditor session,
  //    so the request carries `Authorization: Bearer <jwt>` (the popup URL is
  //    same-origin so the browser sends the cookie/header set by the SDK).
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  // 2. Resolve user from JWT (defends against stale/forged tokens).
  const { data: userData, error: userErr } = await adminInstance.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonError(401, 'unauthenticated');
  const user = userData.user as { id: string };

  // 3. Env config sanity check — surface a clean 500 if Function Secrets are
  //    unset (HUMAN-UAT pre-req per user_setup). NEVER crash.
  const clientId = getCalendlyClientId();
  const redirectUri = getCalendlyRedirectUri();
  const stateSecret = getOAuthStateSecret();
  if (!clientId || !redirectUri || !stateSecret) {
    return jsonError(500, 'oauth_not_configured');
  }

  // 4. Mint a 10-minute HMAC-signed state token.
  const state = await signState(user.id, 600_000, stateSecret);

  // 5. Construct authorize URL.
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  const authorizeUrl = `${CALENDLY_AUTHORIZE_URL}?${params.toString()}`;

  // 6. 302 redirect — the popup browser window follows to Calendly.
  return new Response(null, {
    status: 302,
    headers: { Location: authorizeUrl },
  });
}

// =============================================================================
// Deno.serve dispatcher
// =============================================================================

if (import.meta.main) {
  Deno.serve(async (req: Request): Promise<Response> => {
    try {
      if (req.method !== 'GET') {
        return jsonError(405, 'method_not_allowed');
      }
      return await handleStart(req);
    } catch (e) {
      console.error(
        '[calendly-oauth-start] unhandled',
        e instanceof Error ? e.message : 'unknown',
      );
      return jsonError(500, 'internal_error');
    }
  });
}

// =============================================================================
// Internal exports for the Deno test suite
// =============================================================================

export const __internal = {
  handleStart,
  signState,
  __setAdminForTest,
};
