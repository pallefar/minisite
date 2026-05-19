/**
 * Phase 42 Plan 42-07 (POLISH-12) — Quarterly NPS signed-token helper.
 *
 * D-21 / Pitfall 11: email response URLs are unauthenticated bearer tokens.
 * Single-use enforcement lives in the `quarterly_nps_nonces` ledger; this
 * module proves the URL was produced by us (HMAC-SHA256 with
 * `QUARTERLY_NPS_SIGNING_KEY`).
 *
 * Token wire format:
 *
 *   <payload-b64url>.<hmac-b64url>
 *
 * Where:
 *   payload = JSON.stringify({ user_id, quarter, score, nonce })
 *   hmac    = HMAC_SHA256(signingKey, payload)
 *
 * Tampering with the score (or any other field) breaks the HMAC.
 *
 * Runtime:
 *   - Deno (Supabase Edge Functions). The `node:crypto` shim is supported by
 *     Deno's std lib per Phase 42 RESEARCH §Pattern 7.
 *   - Test runtime: node --test or vitest. Same `node:crypto` import works.
 *
 * Constant-time verification: we compare HMACs with `timingSafeEqual` so an
 * attacker can't infer correct prefix bytes via timing oracle.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface QuarterlyNpsTokenPayload {
  user_id: string;
  quarter: string; // 'YYYY-QN'
  score: number; // 0..10
  nonce: string;
}

const KEY_ENV = 'QUARTERLY_NPS_SIGNING_KEY';

/**
 * Read the signing key from the environment.
 *
 * Throws a clear error on missing/empty value so callers (and tests) fail
 * fast instead of producing tokens that nothing can ever verify.
 *
 * `getEnv` is a thin shim so callers can override in unit tests.
 */
function readSigningKey(getEnv: (k: string) => string | undefined = readDenoOrProcess): string {
  const v = getEnv(KEY_ENV);
  if (!v || v.length === 0) {
    throw new Error(
      `nps-token: ${KEY_ENV} not set. Generate via openssl rand -base64 32 and set as Supabase Function Secret.`,
    );
  }
  return v;
}

function readDenoOrProcess(k: string): string | undefined {
  // Prefer Deno.env when in Deno; fall back to process.env in Node test contexts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (g.Deno?.env?.get) return g.Deno.env.get(k);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (globalThis as any).process !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).process.env?.[k];
  }
  return undefined;
}

// ─── base64url helpers (no padding) ──────────────────────────────────────────

function toBase64Url(bytes: Uint8Array | Buffer): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Buffer {
  // Re-pad to multiple of 4.
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sign a quarterly-NPS response token.
 *
 * The signing key MUST be set in the function-secret store at deploy time.
 *
 * @param payload  user_id + quarter + score + nonce.
 * @param opts     test seam to inject a fixed key instead of reading env.
 */
export function signQuarterlyNpsToken(
  payload: QuarterlyNpsTokenPayload,
  opts: { signingKey?: string } = {},
): string {
  const key = opts.signingKey ?? readSigningKey();
  const json = JSON.stringify({
    user_id: payload.user_id,
    quarter: payload.quarter,
    score: payload.score,
    nonce: payload.nonce,
  });
  const payloadEncoded = toBase64Url(Buffer.from(json, 'utf8'));
  const macBytes = createHmac('sha256', key).update(payloadEncoded).digest();
  const macEncoded = toBase64Url(macBytes);
  return `${payloadEncoded}.${macEncoded}`;
}

/**
 * Verify a quarterly-NPS response token.
 *
 * Returns the decoded payload on success, or `null` if signature mismatch /
 * malformed input. Callers MUST also enforce single-use via
 * `quarterly_nps_nonces.used_at IS NULL` — this function is purely the HMAC gate.
 *
 * @param token   raw token from the email URL.
 * @param opts    test seam for fixed key.
 */
export function verifyQuarterlyNpsToken(
  token: string,
  opts: { signingKey?: string } = {},
): QuarterlyNpsTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadEncoded, macEncoded] = parts;
  if (!payloadEncoded || !macEncoded) return null;

  const key = opts.signingKey ?? readSigningKey();
  const expectedMac = createHmac('sha256', key).update(payloadEncoded).digest();
  let providedMac: Buffer;
  try {
    providedMac = fromBase64Url(macEncoded);
  } catch {
    return null;
  }
  if (providedMac.length !== expectedMac.length) return null;
  // timingSafeEqual requires equal-length buffers (already checked above).
  if (!timingSafeEqual(providedMac, expectedMac)) return null;

  let payload: QuarterlyNpsTokenPayload;
  try {
    const json = fromBase64Url(payloadEncoded).toString('utf8');
    payload = JSON.parse(json) as QuarterlyNpsTokenPayload;
  } catch {
    return null;
  }

  // Shape-check.
  if (
    !payload ||
    typeof payload.user_id !== 'string' ||
    typeof payload.quarter !== 'string' ||
    typeof payload.score !== 'number' ||
    typeof payload.nonce !== 'string'
  ) {
    return null;
  }
  if (!/^\d{4}-Q[1-4]$/.test(payload.quarter)) return null;
  if (payload.score < 0 || payload.score > 10 || !Number.isInteger(payload.score)) return null;

  return payload;
}
