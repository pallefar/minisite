/**
 * Share-token HMAC sign + verify. Edge-runtime-compatible (uses Web Crypto only — no Node crypto).
 *
 * Token format: base64url(body_json) + '.' + base64url(hmac_sig)
 *   where body_json = JSON.stringify({ level, ts, userIdAnon })
 * Secret: Vercel env var SHARE_TOKEN_SECRET (rotated via Vercel dashboard; do NOT commit)
 * TTL: 30 days (verifyShareToken checks expiry)
 */
export interface ShareTokenPayload {
  level: number;
  ts: number; // unix seconds at mint time
  userIdAnon: string; // SHA-256 hash prefix of user_id (16 hex chars; disambiguates without revealing identity)
}

const TTL_SECONDS = 30 * 24 * 60 * 60;

function base64url(input: Uint8Array | string): string {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64url(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? 0 : 4 - (input.length % 4);
  const b64 =
    input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signShareToken(
  payload: ShareTokenPayload,
  secret: string,
): Promise<string> {
  const key = await importKey(secret);
  const bodyJson = JSON.stringify(payload);
  const bodyB64 = base64url(bodyJson);
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(bodyB64)),
  );
  return `${bodyB64}.${base64url(sig)}`;
}

export async function verifyShareToken(
  token: string,
  secret: string,
): Promise<ShareTokenPayload | null> {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const bodyB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  const key = await importKey(secret);
  const expectedSig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(bodyB64)),
  );
  const providedSig = fromBase64url(sigB64);
  if (!constantTimeEqual(expectedSig, providedSig)) return null;

  let payload: ShareTokenPayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(fromBase64url(bodyB64)),
    ) as ShareTokenPayload;
  } catch {
    return null;
  }

  // TTL check (30 days)
  if (
    typeof payload.ts !== 'number' ||
    Date.now() / 1000 - payload.ts > TTL_SECONDS
  )
    return null;
  if (typeof payload.level !== 'number' || payload.level < 1) return null;
  if (
    typeof payload.userIdAnon !== 'string' ||
    payload.userIdAnon.length !== 16
  )
    return null;

  return payload;
}
