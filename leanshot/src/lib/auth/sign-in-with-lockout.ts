/**
 * sign-in-with-lockout.ts — client-side wrapper for the auth-rate-limit-check
 * Edge Fn that intercepts `supabase.auth.signInWithPassword`.
 *
 * Phase 66 Plan 66-05 (AUTH-14 + AUTH-15).
 *
 * Flow per 66-05-PLAN Task 2:
 *
 *   1. POST `/functions/v1/auth-rate-limit-check` { email, action: 'check' }
 *      → server inspects auth_attempts_log; returns `allowed: false` when the
 *        D-03 threshold (5 failures in 15 min by email OR IP) is crossed,
 *        else `{ allowed: true }`.
 *
 *   2. If `allowed === false` → return `{ ok: false, reason: 'locked',
 *      lockedUntil }` WITHOUT invoking Supabase. The caller renders
 *      `<SignInLockoutBanner>` from the returned `lockedUntil`.
 *
 *   3. Else call `supabase.auth.signInWithPassword({ email, password })`.
 *
 *   4. On success → POST `{ email, action: 'log_success' }` (fire-and-forget;
 *      response is ignored — the success path MUST NOT block the UI), then
 *      return `{ ok: true, user }`.
 *
 *   5. On Supabase failure → POST `{ email, action: 'log_failure',
 *      failure_reason }` (fire-and-forget) and return
 *      `{ ok: false, reason: 'invalid_credentials' }`.
 *
 * === Network failure policy ===
 * The rate-limit Fn is best-effort (D-04: cannot proxy Supabase's
 * `/auth/v1/token` surface). When the `check` POST itself fails (network
 * down, Fn cold-start timeout, 5xx) we DO NOT block sign-in — we fall
 * through to Supabase. The protection's primary purpose is to ABSORB
 * brute-force traffic; failing-closed would expose the entire sign-in
 * surface to a single-Fn outage, which is worse than the open-on-fail
 * residual risk (documented in 66-CARRY-OVER + Phase 70 monitoring).
 *
 * Log POSTs are fire-and-forget. They are awaited only when the caller
 * passes `{ awaitLogging: true }` (test seam).
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';

// ─── Public types ───────────────────────────────────────────────────────────

export type LockoutReason = 'email' | 'ip';

export interface SignInWithLockoutSuccess {
  ok: true;
  user: User;
}

export interface SignInWithLockoutLocked {
  ok: false;
  reason: 'locked';
  lockoutReason: LockoutReason;
  lockedUntil: Date;
}

export interface SignInWithLockoutInvalid {
  ok: false;
  reason: 'invalid_credentials';
}

export interface SignInWithLockoutUnknown {
  ok: false;
  reason: 'unknown';
  message?: string;
}

export type SignInWithLockoutResult =
  | SignInWithLockoutSuccess
  | SignInWithLockoutLocked
  | SignInWithLockoutInvalid
  | SignInWithLockoutUnknown;

export interface SignInWithLockoutOptions {
  /**
   * Override the rate-limit Fn URL. Defaults to
   * `${VITE_SUPABASE_URL}/functions/v1/auth-rate-limit-check`.
   */
  rateLimitUrl?: string;
  /**
   * Override fetch (tests). Defaults to global `fetch`.
   */
  fetchImpl?: typeof fetch;
  /**
   * When true, `log_success` / `log_failure` POSTs are awaited before the
   * result resolves. Production code keeps them fire-and-forget; tests use
   * this to assert side effects deterministically.
   */
  awaitLogging?: boolean;
  /**
   * Supabase anon key for the Fn Authorization header. Defaults to
   * `import.meta.env.VITE_SUPABASE_ANON_KEY` when available.
   */
  anonKey?: string;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

interface CheckResponseLocked {
  allowed: false;
  reason: LockoutReason;
  locked_until: string;
}

interface CheckResponseAllowed {
  allowed: true;
}

type CheckResponse = CheckResponseLocked | CheckResponseAllowed;

function defaultRateLimitUrl(override?: string): string | null {
  if (override) return override;
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const base = env?.VITE_SUPABASE_URL;
    if (!base) return null;
    return `${base.replace(/\/+$/, '')}/functions/v1/auth-rate-limit-check`;
  } catch {
    return null;
  }
}

function defaultAnonKey(override?: string): string | null {
  if (override) return override;
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.VITE_SUPABASE_ANON_KEY ?? null;
  } catch {
    return null;
  }
}

/**
 * Build standard headers for the Fn POST. Supabase Edge Functions deployed
 * under the default JWT requirement still need an anon key in the
 * Authorization header even for "unauthenticated" surfaces — the Edge
 * gateway rejects pure no-auth POSTs without it. This Fn does NOT use the
 * bearer for caller identity (only the Fn-level service-role key inside
 * the handler does), so the anon key is purely a gateway-pass.
 */
function buildHeaders(anonKey: string | null): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (anonKey) {
    h['apikey'] = anonKey;
    h['Authorization'] = `Bearer ${anonKey}`;
  }
  return h;
}

async function callRateLimitFn(args: {
  url: string;
  headers: HeadersInit;
  fetchImpl: typeof fetch;
  body: Record<string, unknown>;
}): Promise<Response> {
  return args.fetchImpl(args.url, {
    method: 'POST',
    headers: args.headers,
    body: JSON.stringify(args.body),
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function signInWithLockout(
  supabase: SupabaseClient,
  email: string,
  password: string,
  options: SignInWithLockoutOptions = {},
): Promise<SignInWithLockoutResult> {
  const url = defaultRateLimitUrl(options.rateLimitUrl);
  const anonKey = defaultAnonKey(options.anonKey);
  const fetchImpl = options.fetchImpl ?? fetch;
  const awaitLogging = options.awaitLogging ?? false;

  const normalizedEmail = email.trim().toLowerCase();

  // ── Step 1: pre-flight check ────────────────────────────────────────────
  // Skip when the rate-limit URL cannot be resolved (env-less local dev or
  // SSR/test). The fall-through preserves the sign-in path — the Fn is a
  // gate, not a hard dependency.
  if (url) {
    try {
      const headers = buildHeaders(anonKey);
      const res = await callRateLimitFn({
        url,
        headers,
        fetchImpl,
        body: { email: normalizedEmail, action: 'check' },
      });

      if (res.ok) {
        const body = (await res.json()) as CheckResponse;
        if (body.allowed === false) {
          return {
            ok: false,
            reason: 'locked',
            lockoutReason: body.reason,
            lockedUntil: new Date(body.locked_until),
          };
        }
      } else {
        console.warn('[sign-in-with-lockout] rate-limit check returned', res.status);
      }
    } catch (err) {
      console.warn('[sign-in-with-lockout] rate-limit check threw — falling through:', err);
    }
  }

  // ── Step 2: invoke Supabase sign-in ─────────────────────────────────────
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  // ── Step 3a: failure → log_failure + return invalid_credentials ─────────
  if (error || !data?.user) {
    const failurePost = (async () => {
      if (!url) return;
      try {
        await callRateLimitFn({
          url,
          headers: buildHeaders(anonKey),
          fetchImpl,
          body: {
            email: normalizedEmail,
            action: 'log_failure',
            failure_reason: error?.message ?? 'invalid_credentials',
          },
        });
      } catch (err) {
        console.warn('[sign-in-with-lockout] log_failure threw:', err);
      }
    })();
    if (awaitLogging) await failurePost;
    return { ok: false, reason: 'invalid_credentials' };
  }

  // ── Step 3b: success → log_success + return user ────────────────────────
  const successPost = (async () => {
    if (!url) return;
    try {
      await callRateLimitFn({
        url,
        headers: buildHeaders(anonKey),
        fetchImpl,
        body: {
          email: normalizedEmail,
          action: 'log_success',
        },
      });
    } catch (err) {
      console.warn('[sign-in-with-lockout] log_success threw:', err);
    }
  })();
  if (awaitLogging) await successPost;

  return { ok: true, user: data.user };
}
