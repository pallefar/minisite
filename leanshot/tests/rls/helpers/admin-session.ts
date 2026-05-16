/**
 * Mint a real user-context access_token via the Supabase Auth REST API,
 * bypassing supabase-js + GoTrueClient entirely.
 *
 * # Why this exists (Plan 23-05 pivot, 2026-05-16)
 *
 * The earlier `mintTestJwt` helper (now removed) signed JWTs locally with
 * `SUPABASE_JWT_SECRET` (HS256). That approach is structurally broken on this
 * Supabase project because the project has migrated to ES256 asymmetric
 * signing — verified via the Management API:
 *   GET /v1/projects/ytnsipxxmzgaebkqmokp/config/auth/signing-keys
 *   → HS256 key status="previously_used"; ES256 key status="in_use"
 * PostgREST validates user JWTs against the ES256 `in_use` key whose private
 * counterpart is held by Supabase's signing infrastructure and never exposed.
 *
 * # How this works
 *
 * Two-step admin flow over plain fetch — NO supabase-js, NO GoTrueClient
 * instantiation, NO cross-contamination per
 * [[reference_rls_fixture_gotrueclient_flake]]:
 *
 *   1. POST /auth/v1/admin/generate_link  (service_role auth)
 *      → returns `hashed_token` + `email_otp` for the email
 *
 *   2. POST /auth/v1/verify  (anon auth)
 *      → exchanges the token for a session with a real ES256-signed access_token
 *
 * The returned access_token is signed by the project's `in_use` ES256 key,
 * carries the user's real `sub`/`role` claims, and is accepted by PostgREST
 * for all RLS-gated operations as that user.
 *
 * # Required env
 *
 * - `SUPABASE_URL` — project URL (e.g. https://ytnsipxxmzgaebkqmokp.supabase.co)
 * - `SUPABASE_SERVICE_ROLE_KEY` — service_role JWT (already in GH Actions secrets)
 * - `SUPABASE_ANON_KEY` — anon JWT (already in GH Actions secrets)
 *
 * No `SUPABASE_JWT_SECRET` needed — this is the whole point of the pivot.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

interface GenerateLinkResponse {
  email_otp?: string;
  hashed_token?: string;
  action_link?: string;
  // ... other fields not needed
}

interface VerifySessionResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  user?: { id: string };
  // GoTrue error shape:
  error?: string;
  error_description?: string;
  msg?: string;
  code?: string;
}

/**
 * Mint a real user-context access_token for `email`. The user MUST already
 * exist (create via `admin.auth.admin.createUser({email, email_confirm: true})`
 * before calling this).
 *
 * @throws If env vars missing, generate_link fails, or verify fails.
 */
export async function getUserAccessToken(email: string): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    throw new Error(
      'getUserAccessToken requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY env vars',
    );
  }

  // Step 1: admin generates a one-time magiclink for this user
  const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!linkRes.ok) {
    throw new Error(
      `admin/generate_link failed: HTTP ${linkRes.status} — ${await linkRes.text()}`,
    );
  }
  const linkBody = (await linkRes.json()) as GenerateLinkResponse;

  // Step 2: verify exchanges the token for a real session.
  // Prefer hashed_token (newer API); fall back to email_otp + email.
  const verifyBody = linkBody.hashed_token
    ? { type: 'magiclink', token_hash: linkBody.hashed_token }
    : { type: 'magiclink', token: linkBody.email_otp, email };

  if (!linkBody.hashed_token && !linkBody.email_otp) {
    throw new Error(
      `admin/generate_link returned no usable token: ${JSON.stringify(linkBody)}`,
    );
  }

  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(verifyBody),
  });
  if (!verifyRes.ok) {
    throw new Error(
      `auth/v1/verify failed: HTTP ${verifyRes.status} — ${await verifyRes.text()}`,
    );
  }
  const session = (await verifyRes.json()) as VerifySessionResponse;
  if (!session.access_token) {
    throw new Error(
      `auth/v1/verify returned no access_token: ${JSON.stringify(session)}`,
    );
  }
  return session.access_token;
}
