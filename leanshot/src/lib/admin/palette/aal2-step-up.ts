/**
 * Phase 27 Plan 27-03 — aal2 freshness gate for destructive palette actions (D-12).
 *
 * RESEARCH correction #4 — DUAL freshness mechanism:
 *   1. PRIMARY: JWT `auth_time` claim (server-issued, tamper-evident).
 *      OIDC-conventional, but the live Supabase project's GoTrue version may
 *      or may not surface it in the access_token payload — the live probe
 *      lands in 27-03-SUMMARY.md after first real session decode.
 *   2. FALLBACK: localStorage timestamp written by requireAal2Fresh() when
 *      mfa.challengeAndVerify resolves successfully. Tamperable on a
 *      compromised admin laptop, but the admin laptop is already a trust
 *      anchor per Phase 24 D-09 (accepted residual risk in threat model
 *      T-27-03-01).
 *   3. ABSENT BOTH: returns false (fail-closed → forces a fresh challenge).
 *
 * Defense in depth: every destructive RPC the palette dispatches into ALSO
 * re-checks `is_admin_at_least` + the `aal` JWT claim server-side per Pattern
 * S1. This helper is UX only.
 */
import { supabase } from '@/lib/supabase';

/** D-12: 15-minute freshness window. */
export const AAL2_FRESHNESS_MS = 15 * 60 * 1000;

/** localStorage key used by the fallback freshness path (RESEARCH correction #4). */
export const AAL2_LS_KEY = 'leanshot_aal2_last_verified';

interface JwtPayload {
  aal?: string;
  auth_time?: number; // unix seconds (OIDC convention)
  iat?: number;
  [k: string]: unknown;
}

/**
 * Base64URL → JSON decode of the JWT payload segment.
 * Handles missing '=' padding and the URL-safe `-`/`_` alphabet.
 */
function decodeJwtPayload(jwt: string): JwtPayload | null {
  try {
    const parts = jwt.split('.');
    const body = parts[1];
    if (!body) return null;
    const normalized = body.replace(/-/g, '+').replace(/_/g, '/');
    // Pad to multiple of 4
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Returns true when the current session is at AAL2 AND was challenged within
 * AAL2_FRESHNESS_MS. Implementation order matches the plan contract:
 *
 *   1. mfa.getAuthenticatorAssuranceLevel() — fail-closed if !== 'aal2'.
 *   2. supabase.auth.getSession() → decode JWT payload.
 *   3. If payload.auth_time exists: freshness = (now - auth_time*1000) < window.
 *   4. Else fallback: read localStorage AAL2_LS_KEY timestamp.
 *   5. Both absent → return false.
 */
export async function isAal2Fresh(): Promise<boolean> {
  const { data: aalData, error: aalErr } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalErr || aalData?.currentLevel !== 'aal2') return false;

  const { data: sessData } = await supabase.auth.getSession();
  const jwt = sessData?.session?.access_token;
  // No session at all → not fresh
  if (!jwt) return false;

  const payload = decodeJwtPayload(jwt);

  // Primary: JWT auth_time
  if (payload && typeof payload.auth_time === 'number' && payload.auth_time > 0) {
    const ageMs = Date.now() - payload.auth_time * 1000;
    return ageMs < AAL2_FRESHNESS_MS;
  }

  // Fallback: localStorage timestamp set on last successful challengeAndVerify
  try {
    const raw = globalThis.localStorage?.getItem(AAL2_LS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return Date.now() - ts < AAL2_FRESHNESS_MS;
  } catch {
    return false;
  }
}

export interface Aal2ChallengeInput {
  factorId: string;
  code: string;
}

/**
 * Ensures the session is AAL2-fresh. If stale, invokes `onChallenge` to obtain
 * the TOTP code from the UI, runs mfa.challengeAndVerify, and persists the
 * verification timestamp to localStorage for the fallback freshness path.
 *
 * Throws Error('aal2_challenge_failed') on a verify failure (the caller MUST
 * abort the destructive action).
 */
export async function requireAal2Fresh(
  onChallenge: () => Promise<Aal2ChallengeInput>,
): Promise<void> {
  if (await isAal2Fresh()) return;

  const { factorId, code } = await onChallenge();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    throw new Error('aal2_challenge_failed');
  }

  try {
    globalThis.localStorage?.setItem(AAL2_LS_KEY, String(Date.now()));
  } catch {
    // localStorage may be disabled (Safari private). The auth_time JWT path
    // will still work; in the absence of both, the next isAal2Fresh() call
    // simply forces another challenge. Not fatal here.
  }
}
