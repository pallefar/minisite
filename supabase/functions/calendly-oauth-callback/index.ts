/**
 * `calendly-oauth-callback` Edge Function — Phase 41 Plan 41-04 (EMBED-08).
 *
 * Receives the Calendly redirect (`?code=...&state=...`) at the end of the
 * popup-OAuth flow. Verifies the HMAC state, exchanges the code for an
 * access token (server-side ONLY — `CALENDLY_OAUTH_CLIENT_SECRET` never
 * leaves Deno), then renders a tiny HTML page that posts the token back to
 * `window.opener` via `postMessage` with an EXACT-match `targetOrigin` (the
 * LeanShot app origin from `LEANSHOT_APP_ORIGIN` env — never `'*'`).
 *
 * Threat refs (per 41-04-PLAN.md `<threat_model>`):
 *   - T-41-04-02 (info disclosure via wildcard targetOrigin): NEVER pass
 *     `'*'` to postMessage. Plan-level grep gate enforces this.
 *   - T-41-04-03: client_secret read only via `Deno.env.get` — server-side.
 *   - T-41-04-05 (CSRF): HMAC + 10-min expiry verified before code exchange.
 *   - T-41-04-06 (open redirect): redirect_uri pulled from env, not request.
 *
 * Deploy: deferred to Plan 41-06 closeout (aggregated with `supabase db push
 * --linked`).
 */

const CALENDLY_TOKEN_URL = 'https://auth.calendly.com/oauth/token';

// =============================================================================
// Env helpers (lazy + defensive)
// =============================================================================

function env(name: string, fallback = ''): string {
  return Deno.env.get(name) ?? fallback;
}

const getCalendlyClientId = () => env('CALENDLY_OAUTH_CLIENT_ID');
const getCalendlyClientSecret = () => env('CALENDLY_OAUTH_CLIENT_SECRET');
const getCalendlyRedirectUri = () => env('CALENDLY_OAUTH_REDIRECT_URI');
const getOAuthStateSecret = () => env('OAUTH_STATE_SECRET');
const getLeanshotAppOrigin = () => env('LEANSHOT_APP_ORIGIN', 'https://app.leanshot.app');

// =============================================================================
// HMAC state verification (shared logic with the start Fn)
// =============================================================================

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(input: string): Uint8Array {
  // Re-pad to a multiple of 4, then standard base64.
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
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

/** Constant-time byte-array compare (defends timing-attack on HMAC verify). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export interface VerifyStateResult {
  ok: boolean;
  userId?: string;
  reason?: 'malformed' | 'bad_signature' | 'expired';
}

export async function verifyState(
  state: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<VerifyStateResult> {
  const parts = state.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [payloadB64, sigB64] = parts as [string, string];
  if (!payloadB64 || !sigB64) return { ok: false, reason: 'malformed' };

  // Recompute HMAC over payloadB64 + constant-time compare.
  const expectedSig = await hmacSha256(secret, payloadB64);
  let providedSig: Uint8Array;
  try {
    providedSig = b64urlDecode(sigB64);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!timingSafeEqual(expectedSig, providedSig)) {
    return { ok: false, reason: 'bad_signature' };
  }

  // Decode + validate payload.
  let payloadJson: string;
  try {
    payloadJson = new TextDecoder().decode(b64urlDecode(payloadB64));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  let parsed: { u?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(payloadJson) as { u?: unknown; e?: unknown };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const userId = typeof parsed.u === 'string' ? parsed.u : '';
  const expiresAt = typeof parsed.e === 'number' ? parsed.e : 0;
  if (!userId || !expiresAt) return { ok: false, reason: 'malformed' };
  if (nowMs >= expiresAt) return { ok: false, reason: 'expired' };

  return { ok: true, userId };
}

// =============================================================================
// HTML response helpers
// =============================================================================

function htmlResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * Allow-list of Calendly OAuth error codes per RFC 6749 §4.1.2.1 + Calendly
 * docs. Reflected values outside this list are coerced to `'oauth_error'` to
 * prevent attacker-controlled strings from reaching the response body.
 *
 * Defense-in-depth: the `jsonForScript` escaper below also neutralizes any
 * payload, but the allow-list keeps the user-facing error string meaningful.
 */
const CALENDLY_OAUTH_ERROR_ALLOWLIST = new Set<string>([
  'access_denied',
  'invalid_request',
  'unauthorized_client',
  'unsupported_response_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
]);

export function sanitizeCalendlyOAuthError(raw: string): string {
  return CALENDLY_OAUTH_ERROR_ALLOWLIST.has(raw) ? raw : 'oauth_error';
}

/**
 * Escape a value for safe inline-script embedding. `JSON.stringify` alone does
 * NOT escape `<`, `>`, `&`, or U+2028/U+2029 — an attacker-controlled string
 * containing `</script>` can break out of the surrounding `<script>` block
 * (CR-01 in Phase 41 review).
 */
// U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) are valid JSON
// string contents but terminate JS source lines — they MUST be escaped when
// embedding JSON inside a `<script>` block. Built via fromCharCode so the
// surrounding source file stays plain ASCII (editors strip these silently).
const LS_RE = new RegExp(String.fromCharCode(0x2028), 'g');
const PS_RE = new RegExp(String.fromCharCode(0x2029), 'g');

function jsonForScript(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LS_RE, '\\u2028')
    .replace(PS_RE, '\\u2029');
}

/** HTML-escape for element-text contexts. Defense-in-depth for `<title>`. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the HTML page that fires `postMessage` back to the opener and closes
 * the popup. `targetOrigin` is the EXACT LeanShot app origin — never `'*'`.
 *
 * T-41-04-02 mitigation: targetOrigin is interpolated via `jsonForScript`
 * which escapes HTML-script-breakout characters (`<`, `>`, `&`, U+2028/9).
 * Plain `JSON.stringify` is NOT sufficient — see CR-01 in 41-REVIEW.md.
 */
export function buildPostMessageHtml(args: {
  payload: Record<string, unknown>;
  leanshotOrigin: string;
  title?: string;
}): string {
  const { payload, leanshotOrigin, title = 'Calendly connected' } = args;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <p>Closing window…</p>
    <script>
      try {
        if (window.opener) {
          window.opener.postMessage(${jsonForScript(payload)}, ${jsonForScript(leanshotOrigin)});
        }
      } catch (e) {
        // noop — best-effort message; user can retry from PageEditor
      }
      window.close();
    </script>
  </body>
</html>`;
}

// =============================================================================
// Calendly token exchange
// =============================================================================

interface CalendlyTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export async function exchangeCodeForToken(args: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; token: CalendlyTokenResponse } | { ok: false; status: number }> {
  const { code, clientId, clientSecret, redirectUri, fetchImpl } = args;
  const f = fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await f(CALENDLY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const json = (await res.json()) as CalendlyTokenResponse;
  return { ok: true, token: json };
}

// =============================================================================
// handleCallback
// =============================================================================

export async function handleCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const calendlyError = url.searchParams.get('error') ?? '';
  const leanshotOrigin = getLeanshotAppOrigin();

  // 1. Surface Calendly-side errors (e.g. user denied consent) → close popup
  //    with error payload. Origin guard still applies. Per CR-01 (41-REVIEW)
  //    the raw `error` value is whitelisted to RFC 6749 codes before being
  //    reflected into the response (defense-in-depth alongside jsonForScript).
  if (calendlyError) {
    return htmlResponse(
      200,
      buildPostMessageHtml({
        payload: {
          type: 'calendly-oauth-result',
          error: sanitizeCalendlyOAuthError(calendlyError),
        },
        leanshotOrigin,
        title: 'Calendly connection failed',
      }),
    );
  }

  if (!code || !state) {
    return htmlResponse(
      400,
      buildPostMessageHtml({
        payload: { type: 'calendly-oauth-result', error: 'missing_params' },
        leanshotOrigin,
      }),
    );
  }

  // 2. Env sanity check.
  const clientId = getCalendlyClientId();
  const clientSecret = getCalendlyClientSecret();
  const redirectUri = getCalendlyRedirectUri();
  const stateSecret = getOAuthStateSecret();
  if (!clientId || !clientSecret || !redirectUri || !stateSecret) {
    return htmlResponse(
      500,
      buildPostMessageHtml({
        payload: { type: 'calendly-oauth-result', error: 'oauth_not_configured' },
        leanshotOrigin,
      }),
    );
  }

  // 3. Verify HMAC state (CSRF defense — T-41-04-05).
  const stateResult = await verifyState(state, stateSecret);
  if (!stateResult.ok) {
    return htmlResponse(
      400,
      buildPostMessageHtml({
        payload: {
          type: 'calendly-oauth-result',
          error: `invalid_state_${stateResult.reason ?? 'unknown'}`,
        },
        leanshotOrigin,
      }),
    );
  }

  // 4. Exchange code → access token. CALENDLY_OAUTH_CLIENT_SECRET stays
  //    server-side — never reflected in the response.
  const exchange = await exchangeCodeForToken({
    code,
    clientId,
    clientSecret,
    redirectUri,
  });
  if (!exchange.ok) {
    // No upstream error echo — opaque code per Pitfall 6 + page-publish parity.
    return htmlResponse(
      502,
      buildPostMessageHtml({
        payload: { type: 'calendly-oauth-result', error: 'token_exchange_failed' },
        leanshotOrigin,
      }),
    );
  }

  // 5. Strip refresh_token before posting back — in-memory token is short-lived
  //    + planner-locked (Open Question 2 + T-41-04-04). The browser side has
  //    no persistence path for the refresh token, so we don't ship it.
  const { access_token: accessToken, expires_in: expiresIn } = exchange.token;
  if (!accessToken) {
    return htmlResponse(
      502,
      buildPostMessageHtml({
        payload: { type: 'calendly-oauth-result', error: 'token_missing' },
        leanshotOrigin,
      }),
    );
  }

  return htmlResponse(
    200,
    buildPostMessageHtml({
      payload: {
        type: 'calendly-oauth-result',
        token: accessToken,
        expires_in: typeof expiresIn === 'number' ? expiresIn : null,
      },
      leanshotOrigin,
    }),
  );
}

// =============================================================================
// Deno.serve dispatcher
// =============================================================================

if (import.meta.main) {
  Deno.serve(async (req: Request): Promise<Response> => {
    try {
      if (req.method !== 'GET') {
        return new Response('method_not_allowed', { status: 405 });
      }
      return await handleCallback(req);
    } catch (e) {
      console.error(
        '[calendly-oauth-callback] unhandled',
        e instanceof Error ? e.message : 'unknown',
      );
      // Best-effort close on the popup side even on crash.
      return htmlResponse(
        500,
        buildPostMessageHtml({
          payload: { type: 'calendly-oauth-result', error: 'internal_error' },
          leanshotOrigin: getLeanshotAppOrigin(),
        }),
      );
    }
  });
}

// =============================================================================
// Internal exports for the Deno test suite
// =============================================================================

export const __internal = {
  handleCallback,
  buildPostMessageHtml,
  verifyState,
  exchangeCodeForToken,
  sanitizeCalendlyOAuthError,
};
