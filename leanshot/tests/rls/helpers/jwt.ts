/**
 * Minimal JWT minting helper for RLS test fixtures.
 *
 * Uses Node.js built-in `node:crypto` (available since Node 16) — no extra
 * dependency required.
 *
 * Purpose: Replace `buildAnonClient(...).auth.signInWithPassword(...)` calls in
 * RLS test fixtures with direct service-role-minted JWTs. This eliminates the
 * GoTrueClient cross-contamination class documented in
 * [[reference_rls_fixture_gotrueclient_flake]] (supabase-js v2.105 Multiple
 * GoTrueClient instances under vitest parallelism).
 *
 * Usage:
 *   import { mintTestJwt } from './helpers/jwt';
 *   const jwt = await mintTestJwt({ sub: userId, role: 'authenticated', aud: 'authenticated' });
 *   const client = createClient(URL, ANON_KEY, {
 *     global: { headers: { Authorization: `Bearer ${jwt}` } },
 *     auth: { persistSession: false, autoRefreshToken: false },
 *   });
 *
 * Required env var: SUPABASE_JWT_SECRET (the project-level JWT secret from
 * Supabase dashboard > Settings > API > JWT Secret).
 *
 * Project ref: ytnsipxxmzgaebkqmokp
 */

import { createHmac } from 'node:crypto';

/**
 * Base64url-encode a buffer or string without padding characters.
 */
function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Mint a short-lived HS256 JWT signed with SUPABASE_JWT_SECRET.
 *
 * Minimum claims required for supabase-js to accept the token as an
 * authenticated session:
 *   - sub:  user UUID
 *   - role: 'authenticated'
 *   - aud:  'authenticated'
 *   - exp:  Unix timestamp (now + 600s by default)
 *
 * Throws if SUPABASE_JWT_SECRET is not set.
 */
export async function mintTestJwt(
  claims: Record<string, unknown> & { sub: string },
  ttlSeconds = 600,
): Promise<string> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error(
      'mintTestJwt: SUPABASE_JWT_SECRET env var is not set. ' +
        'Add it to .env.local (Supabase dashboard > Settings > API > JWT Secret) ' +
        'and to the GitHub Actions secret store.',
    );
  }

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      iat: now,
      exp: now + ttlSeconds,
      ...claims,
    }),
  );

  const signingInput = `${header}.${payload}`;
  const sig = createHmac('sha256', secret).update(signingInput).digest();
  const signature = base64url(sig);

  return `${signingInput}.${signature}`;
}
