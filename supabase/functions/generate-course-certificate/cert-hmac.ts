/**
 * cert-hmac.ts — Phase 46 Plan 07 Task 2.
 *
 * Deno (Edge Function runtime) HMAC-SHA256 helpers for the public
 * `/verify/<cert_id>` flow. The token wire format is:
 *
 *   token = base64url(HMAC_SHA256(secret, `${certId}:${userId}:${courseId}:${issuedAt}`))
 *
 * where `base64url` is RFC 4648 §5 (`+`→`-`, `/`→`_`, trailing `=` stripped) —
 * encoded via Node's `Buffer.toString('base64')` + the standard replace-chain.
 *
 * CROSS-RUNTIME PAYLOAD CONTRACT (LOCKED):
 *
 *   Payload format MUST stay IDENTICAL to the browser counterpart at
 *   `src/lib/course/cert-verify-token.ts` (Plan 46-03). The colon-separated
 *   order — certId : userId : courseId : issuedAt — and the lack of any
 *   whitespace, padding, or URL-encoding are part of the wire contract.
 *
 *   ANY divergence (extra field, reordered fields, JSON encoding instead of
 *   colon-join, swapping base64url for base64, etc.) will silently break
 *   every `/verify/<cert_id>?t=<token>` URL ever issued — including ones
 *   already printed onto user-downloaded PDFs. The browser side validates
 *   with constant-time equality and will simply return "not verified" with
 *   no log trail.
 *
 *   See `src/lib/course/cert-hmac.test.ts` (this file's test) +
 *   `src/lib/course/cert-verify-token.test.ts` (browser test) for the locked
 *   cross-runtime vector that catches drift at CI time.
 *
 * Pattern reference: `supabase/functions/_shared/nps-token.ts` (Phase 42)
 * established the project-standard base64url replace-chain + node:crypto
 * timingSafeEqual pattern used here. The only difference is the payload
 * shape: nps-token uses `<b64payload>.<b64mac>` (.-separated, JSON payload);
 * cert-hmac uses bare base64url HMAC because the cert's identifying fields
 * are already in the URL path + query (certId in the path, the rest looked
 * up from the certificates row by certId).
 *
 * T-46-03 mitigation (forged certificate at /verify/<fake_id>?t=<fake_token>):
 *   HMAC binds (certId, userId, courseId, issuedAt) tuple; attacker cannot
 *   forge a token without the secret. timingSafeEqual compare defeats the
 *   timing-oracle byte-leak.
 *
 * T-46-04 mitigation (CERT_VERIFICATION_SECRET leak to browser):
 *   Secret is read by callers via Deno.env at call-time and passed in.
 *   This module does NOT cache or persist the secret. Caller (index.ts)
 *   reads from Deno.env.get('CERT_VERIFICATION_SECRET'); never echoed to
 *   the response body. Only the HMAC output ships to the browser.
 */

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── base64url helper (replace-chain MUST match browser side) ───────────────

function toBase64Url(bytes: Uint8Array | Buffer): string {
  const b64 = Buffer.from(bytes).toString('base64');
  // EXACT replace-chain — same as supabase/functions/_shared/nps-token.ts
  // and src/lib/course/cert-verify-token.ts. Do NOT reorder or substitute.
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Mint a certificate verification token.
 *
 * @param certId    certificates.id
 * @param userId    certificates.user_id (auth.users.id)
 * @param courseId  certificates.course_id
 * @param issuedAt  certificates.issued_at (ISO timestamp string — use the
 *                  EXACT server string returned by the INSERT; round-tripping
 *                  through `new Date(...).toISOString()` may drop or add
 *                  fractional seconds and break HMAC parity).
 * @param secret    CERT_VERIFICATION_SECRET (Supabase Function Secret)
 * @returns base64url HMAC-SHA256 string (43 chars, no padding)
 */
export function mintCertToken(
  certId: string,
  userId: string,
  courseId: string,
  issuedAt: string,
  secret: string,
): string {
  // Colon-separated payload — MUST match browser counterpart byte-for-byte.
  const payload = `${certId}:${userId}:${courseId}:${issuedAt}`;
  const mac = createHmac('sha256', secret).update(payload).digest();
  return toBase64Url(mac);
}

/**
 * Verify a certificate verification token.
 *
 * Constant-time comparison via node:crypto.timingSafeEqual defeats the
 * HMAC-byte timing-oracle attack vector (T-46-03 mitigation).
 *
 * @returns true iff the token byte-matches mintCertToken(...) for the same
 *          inputs. false on any mismatch, length divergence, or invalid input.
 */
export function verifyCertToken(
  token: string,
  certId: string,
  userId: string,
  courseId: string,
  issuedAt: string,
  secret: string,
): boolean {
  if (!token || typeof token !== 'string') return false;
  const expected = mintCertToken(certId, userId, courseId, issuedAt, secret);
  const tBuf = Buffer.from(token, 'utf8');
  const eBuf = Buffer.from(expected, 'utf8');
  if (tBuf.length !== eBuf.length) return false;
  // timingSafeEqual requires equal-length buffers (already checked above).
  return timingSafeEqual(tBuf, eBuf);
}
