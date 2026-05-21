/**
 * Phase 37 Plan 37-02 Task 4 — Reply-token HMAC helper.
 *
 * Contract (CONTEXT D-19):
 *   token = base64url(HMAC-SHA256(secret, `${ticket_id}:${user_id}`))
 *   Reply-To header: `reply+<token>@app.leanshot.app`
 *
 * Used by:
 *   - helpdesk-agent-reply send sites (Plan 37-04): generate the token, build
 *     the Reply-To header, pass to email-router.
 *   - helpdesk-inbound (Plan 37-03): verify the token on incoming patient
 *     replies, match the message to the right ticket without a DB round-trip.
 *
 * Threat mitigations:
 *   - T-37-02-01 Tampering — HMAC-SHA256 with a 256-bit vault-stored secret
 *     prevents forgery; constant-time compare prevents timing-oracle leaks.
 *   - T-37-02-02 Information Disclosure — secret is never logged anywhere in
 *     this module (no console.log / console.warn / console.error involving
 *     the secret or token).
 *
 * Runtime: Deno Edge Fn. Uses Web Crypto (crypto.subtle) only — no Node API.
 * Pattern mirrors `_shared/realtime.ts` HMAC usage.
 */

const encoder = new TextEncoder();

async function hmacSign(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return new Uint8Array(sig);
}

function toBase64Url(bytes: Uint8Array): string {
  // btoa expects a binary string of latin-1 chars; build it byte-by-byte to
  // avoid `String.fromCharCode(...bytes)` blowing up the call stack on large
  // inputs (32 bytes here is fine, but the pattern is defensible).
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Generate a base64url-encoded HMAC-SHA256 reply token.
 *
 * Deterministic: same (secret, ticketId, userId) always produces the same
 * token. Callers should treat the token as opaque.
 */
export async function generateReplyToken(
  secret: string,
  ticketId: string,
  userId: string,
): Promise<string> {
  const sig = await hmacSign(secret, `${ticketId}:${userId}`);
  return toBase64Url(sig);
}

/**
 * Verify a reply token against (secret, ticketId, userId).
 *
 * Returns true iff the token matches the HMAC-SHA256 of `${ticketId}:${userId}`
 * under `secret`. Constant-time over the maximum of (token, expected) byte
 * lengths — never short-circuits on length mismatch, never throws.
 *
 * Garbage input safety: any internal error (e.g. importKey failure) becomes a
 * `false` return rather than a thrown exception. The caller (helpdesk-inbound)
 * needs a simple boolean to decide accept/reject, NOT an error to propagate.
 */
export async function verifyReplyToken(
  token: string,
  secret: string,
  ticketId: string,
  userId: string,
): Promise<boolean> {
  let expected: string;
  try {
    expected = await generateReplyToken(secret, ticketId, userId);
  } catch {
    return false;
  }

  // Constant-time compare: iterate over max(len(a), len(b)); mask out-of-range
  // bytes to zero so they don't accidentally match. XOR-OR a "length-mismatch"
  // sentinel so unequal-length inputs always fail (without an early return).
  const a = encoder.encode(token);
  const b = encoder.encode(expected);
  const n = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < n; i++) {
    const av = i < a.length ? a[i]! : 0;
    const bv = i < b.length ? b[i]! : 0;
    mismatch |= av ^ bv;
  }
  return mismatch === 0;
}
