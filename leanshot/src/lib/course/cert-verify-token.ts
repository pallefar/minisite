/**
 * Phase 46 Plan 03 — Browser-side cert verification token.
 *
 * Web Crypto HMAC-SHA256 helpers used by the public /verify/<cert_id> route
 * (Plan 46-10). The Edge Fn that mints the token uses node:crypto via
 * Plan 46-07 `cert-hmac.ts`; this file is the BROWSER counterpart and MUST
 * stay byte-compatible with that helper.
 *
 * Contract (LOCKED — Plan 46-07 mirrors this exactly):
 *   - Payload: `${certId}:${userId}:${courseId}:${issuedAt}` (colon-separated)
 *   - Algorithm: HMAC-SHA256 with secret = CERT_VERIFICATION_SECRET
 *   - Encoding: base64url — btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
 *
 * Pattern reference: same replace-chain as supabase/functions/_shared/nps-token.ts
 * (Phase 42 Plan 42-07); only the runtime (Web Crypto vs node:crypto) differs.
 *
 * T-46-03 mitigation: verifyCertToken uses a constant-time XOR-accumulator
 * compare so an attacker cannot infer HMAC bytes by timing-oracle.
 */

// ─── Internal HMAC helper ────────────────────────────────────────────────────

async function hmacSha256(secret: string, message: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(secret);
  const msgBytes = new TextEncoder().encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  // base64url replace-chain — MUST match nps-token.ts / cert-hmac.ts byte-for-byte.
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time string compare (XOR-accumulator). Defeats timing oracle on HMAC. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Mint a cert verification token (browser Web Crypto HMAC-SHA256 base64url).
 *
 * The Edge Fn equivalent in Plan 46-07 produces an identical token for the
 * same inputs (same payload format, same replace-chain).
 *
 * @param certId    certificates.id
 * @param userId    certificates.user_id (auth.users.id)
 * @param courseId  certificates.course_id
 * @param issuedAt  certificates.issued_at (ISO timestamp, NO transformation —
 *                  use the exact server string to avoid round-trip drift)
 * @param secret    CERT_VERIFICATION_SECRET (Supabase Function Secret)
 */
export async function mintCertToken(
  certId: string,
  userId: string,
  courseId: string,
  issuedAt: string,
  secret: string,
): Promise<string> {
  const payload = `${certId}:${userId}:${courseId}:${issuedAt}`;
  return hmacSha256(secret, payload);
}

/**
 * Verify a cert verification token. Returns true iff the token was produced
 * for the exact same (certId, userId, courseId, issuedAt) tuple with the
 * same secret.
 *
 * Constant-time compare prevents timing-oracle leaks (T-46-03).
 *
 * @param token     base64url HMAC-SHA256 from the URL
 * @param certId    certificates.id from the URL
 * @param userId    certificates.user_id from the looked-up row
 * @param courseId  certificates.course_id from the looked-up row
 * @param issuedAt  certificates.issued_at from the looked-up row
 * @param secret    CERT_VERIFICATION_SECRET
 */
export async function verifyCertToken(
  token: string,
  certId: string,
  userId: string,
  courseId: string,
  issuedAt: string,
  secret: string,
): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  const expected = await mintCertToken(certId, userId, courseId, issuedAt, secret);
  return constantTimeEqual(token, expected);
}
