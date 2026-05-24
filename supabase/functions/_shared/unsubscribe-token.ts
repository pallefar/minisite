/**
 * Phase 49 Plan 49-08 — 1-click unsubscribe HMAC mint/verify helper.
 *
 * D-13: email-delivered unsubscribe links are unauthenticated bearer tokens;
 * the URL signature IS the auth. RFC 8058 List-Unsubscribe-Post requires the
 * receiving handler to accept the GET+POST without an Authorization header,
 * so the cryptographic guarantee on the token is the only barrier between an
 * attacker and a flipped notification preference.
 *
 * Token wire format:
 *
 *   <payload-b64url>.<hmac-b64url>
 *
 * Where:
 *   payload = JSON.stringify({ user_id, category, exp })
 *   hmac    = HMAC_SHA256(signingKey, payloadEncoded)
 *
 * Tampering with the payload (user_id swap, category swap, exp extension)
 * breaks the HMAC and `verifyUnsubscribeToken` returns null.
 *
 * Constant-time compare via `timingSafeEqual` prevents byte-by-byte timing
 * oracles.
 *
 * Runtime:
 *   - Deno (Supabase Edge Functions). `node:crypto` is the Deno std shim per
 *     Phase 42 RESEARCH §Pattern 7.
 *   - Test runtime: `deno test`. The optional `key?` parameter on both mint
 *     and verify lets tests inject a fixture key without setting Deno.env.
 *
 * base64url chain matches the Postgres↔TS parity rule in memory
 * `reference_base64url_postgres_vercel_mint_verify`: replace '+'→'-',
 * '/'→'_', drop trailing '='. Re-pad symmetrically on decode.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

export type UnsubscribeCategory = 'daily_community_digest' | 'weekly_community_digest';

export interface UnsubscribeTokenPayload {
  user_id: string;
  category: UnsubscribeCategory;
  exp: number; // unix seconds
}

const KEY_ENV = 'UNSUBSCRIBE_SECRET';

const ALLOWED_CATEGORIES: ReadonlySet<UnsubscribeCategory> = new Set([
  'daily_community_digest',
  'weekly_community_digest',
]);

/**
 * Read the signing key from the Deno environment.
 *
 * Throws on missing/empty so callers fail fast instead of minting tokens
 * that nothing can ever verify.
 */
function readSigningKey(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const v: string | undefined = g.Deno?.env?.get?.(KEY_ENV);
  if (!v || v.length === 0) {
    throw new Error(
      `unsubscribe-token: ${KEY_ENV} not set. Generate via openssl rand -base64 32 and set as Supabase Function Secret.`,
    );
  }
  return v;
}

// ─── base64url helpers (no padding) ──────────────────────────────────────────

function toBase64Url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(s: string): Buffer {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sign a 1-click unsubscribe token.
 *
 * @param payload  user_id + category + exp (unix seconds).
 * @param key      Optional test seam — when omitted, reads from Deno.env.
 */
export function mintUnsubscribeToken(payload: UnsubscribeTokenPayload, key?: string): string {
  const signingKey = key ?? readSigningKey();
  const json = JSON.stringify({
    user_id: payload.user_id,
    category: payload.category,
    exp: payload.exp,
  });
  const payloadEncoded = toBase64Url(Buffer.from(json, 'utf8'));
  const macBytes = createHmac('sha256', signingKey).update(payloadEncoded).digest();
  return `${payloadEncoded}.${toBase64Url(macBytes)}`;
}

/**
 * Verify a 1-click unsubscribe token.
 *
 * Returns the decoded payload on success, or `null` on any of:
 *   - missing dot separator
 *   - malformed base64url
 *   - HMAC mismatch (constant-time compare)
 *   - missing required fields
 *   - category outside the whitelist (`daily_community_digest`,
 *     `weekly_community_digest`)
 *   - expired (Date.now()/1000 > payload.exp)
 *
 * @param token  Raw token from the email URL `?t=` query param.
 * @param key    Optional test seam — when omitted, reads from Deno.env.
 */
export function verifyUnsubscribeToken(
  token: string,
  key?: string,
): UnsubscribeTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadEncoded, macEncoded] = parts;
  if (!payloadEncoded || !macEncoded) return null;

  const signingKey = key ?? readSigningKey();
  const expectedMac = createHmac('sha256', signingKey).update(payloadEncoded).digest();
  let providedMac: Buffer;
  try {
    providedMac = fromBase64Url(macEncoded);
  } catch {
    return null;
  }
  if (providedMac.length !== expectedMac.length) return null;
  if (!timingSafeEqual(providedMac, expectedMac)) return null;

  let payload: UnsubscribeTokenPayload;
  try {
    const json = fromBase64Url(payloadEncoded).toString('utf8');
    payload = JSON.parse(json) as UnsubscribeTokenPayload;
  } catch {
    return null;
  }

  // Shape-check.
  if (
    !payload ||
    typeof payload.user_id !== 'string' ||
    payload.user_id.length === 0 ||
    typeof payload.category !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    return null;
  }
  // Category whitelist — defence-in-depth even when HMAC validates.
  if (!ALLOWED_CATEGORIES.has(payload.category as UnsubscribeCategory)) return null;
  // Expiry.
  if (Math.floor(Date.now() / 1000) > payload.exp) return null;

  return payload;
}
