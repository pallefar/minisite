/**
 * Phase 66 Plan 66-02 — Consumer-surface AAL2 gate.
 *
 * Wraps the Phase 25 admin step-up primitives (`isAal2Fresh` +
 * `requireAal2Fresh` from `src/lib/admin/palette/aal2-step-up`) into a
 * single async API consumer surfaces call before performing one of three
 * sensitive actions:
 *
 *   - delete-account
 *   - export-all-data
 *   - change-email
 *
 * Behaviour (per 66-02-PLAN Task 2 + Phase 66 D-02):
 *
 *   1. If the user has NO verified TOTP factor enrolled, the gate is
 *      SKIPPED and returns `{ ok: false, reason: 'mfa_not_enabled' }` —
 *      the caller proceeds with the action regardless. (Consumer TOTP is
 *      OPTIONAL per HIPAA-15 / Phase 25 D-11.)
 *
 *   2. If the current session is already at AAL2 AND was challenged
 *      within the freshness window (default 15 minutes), the gate
 *      returns `{ ok: true }` without prompting the user.
 *
 *   3. Otherwise, the caller-supplied `onChallenge` callback is invoked
 *      to render a TOTP modal. The callback resolves to either
 *      `{ code }` (user submitted) or `{ cancelled: true }` (user
 *      dismissed). On `{ code }`, we run `verifyTotpChallenge` against
 *      the user's first verified factor; on success we persist the
 *      freshness timestamp and return `{ ok: true }`.
 *
 *   4. The `reason` enum distinguishes the three failure modes:
 *      `mfa_not_enabled` (gate skipped — caller may proceed),
 *      `cancelled` (user dismissed the modal — caller MUST abort),
 *      `invalid_code` (TOTP verify failed — caller MUST abort + can
 *      offer retry), `session_stale` (no session at all — caller MUST
 *      redirect to sign-in).
 *
 * NOTE — re-uses canonical Phase 25 primitives (D-02):
 *   - `isAal2Fresh()`           from `@/lib/admin/palette/aal2-step-up`
 *   - `AAL2_LS_KEY`             from `@/lib/admin/palette/aal2-step-up`
 *   - `AAL2_FRESHNESS_MS`       from `@/lib/admin/palette/aal2-step-up`
 *   - `verifyTotpChallenge()`   from `@/lib/auth/totp-shared`
 *   - `listEnrolledFactors()`   from `@/lib/auth/totp-shared`
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AAL2_FRESHNESS_MS, AAL2_LS_KEY, isAal2Fresh } from '@/lib/admin/palette/aal2-step-up';
import { listEnrolledFactors, verifyTotpChallenge } from '@/lib/auth/totp-shared';
import { supabase } from '@/lib/supabase';

/**
 * Consumer-surface AAL2 purposes — used for analytics / audit-log tagging
 * by the caller. The gate itself doesn't branch on purpose; it's surfaced
 * as a parameter so each callsite is grep-able and the modal copy can
 * personalise ("Confirm deleting your account", etc.).
 */
export type Aal2ConsumerPurpose = 'delete-account' | 'export-all-data' | 'change-email';

export type Aal2GateResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'mfa_not_enabled' | 'cancelled' | 'invalid_code' | 'session_stale';
    };

export type Aal2ChallengeOutcome = { code: string } | { cancelled: true };

export interface RequireAal2Opts {
  /**
   * Override the freshness window (default {@link AAL2_FRESHNESS_MS} = 15min).
   * Tests use small windows to exercise the stale path.
   */
  freshWindowMs?: number;
  /**
   * Caller-provided callback that renders a TOTP modal and resolves with
   * either the user-entered code or `{ cancelled: true }`. The gate does
   * NOT own UI; this is the seam between this pure-logic module and the
   * (Wave 2) consumer modal component.
   */
  onChallenge?: () => Promise<Aal2ChallengeOutcome>;
}

/**
 * Internal — read the persisted freshness timestamp + check it against
 * the (possibly overridden) window. Used when `opts.freshWindowMs` is
 * supplied, in which case we can't trust the underlying `isAal2Fresh()`
 * helper (it bakes the 15min constant in).
 */
function readFreshnessTs(): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(AAL2_LS_KEY);
    if (!raw) return null;
    const ts = Number(raw);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    return ts;
  } catch {
    return null;
  }
}

/**
 * Internal — true if the persisted freshness ts is within the window.
 * Used only when caller overrides the default window via
 * `opts.freshWindowMs`. The default path delegates to
 * `isAal2Fresh()` (which checks JWT auth_time first + falls back to LS).
 */
async function isFreshWithinWindow(client: SupabaseClient, windowMs: number): Promise<boolean> {
  // Cheap path — if the helper already considers us fresh on the default
  // 15min window AND our window is >= default, accept it without
  // re-deriving. (We only fall back to LS-only for shorter windows.)
  if (windowMs >= AAL2_FRESHNESS_MS) {
    return isAal2Fresh();
  }

  // Caller asked for a tighter window — re-check the AAL claim then the
  // LS ts directly.
  const { data: aalData } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalData?.currentLevel !== 'aal2') return false;

  const ts = readFreshnessTs();
  if (ts === null) return false;
  return Date.now() - ts < windowMs;
}

/**
 * Persist the AAL2 freshness timestamp so subsequent gate calls in the
 * same browser-tab session can skip the challenge. Silent on
 * localStorage failure (Safari private mode) — the next call will simply
 * force another challenge, which is acceptable degraded UX.
 */
function persistFreshnessTs(): void {
  try {
    globalThis.localStorage?.setItem(AAL2_LS_KEY, String(Date.now()));
  } catch {
    /* noop */
  }
}

/**
 * Run the consumer-surface AAL2 step-up gate.
 *
 * Returns `{ ok: true }` when the caller may proceed with the sensitive
 * action; otherwise returns `{ ok: false, reason }` where `reason`
 * communicates whether the caller should proceed anyway (MFA not
 * enabled), abort silently (cancelled), abort with retry option
 * (invalid_code), or redirect to sign-in (session_stale).
 *
 * The `purpose` parameter is logged by callers for audit/analytics but
 * doesn't branch the gate itself.
 */
export async function requireAal2ForConsumerAction(
  client: SupabaseClient = supabase,
  // The `purpose` arg is intentionally unused inside the gate — see docstring.
  // The leading underscore satisfies strict noUnusedParameters.
  _purpose: Aal2ConsumerPurpose,
  opts?: RequireAal2Opts,
): Promise<Aal2GateResult> {
  // 1. Verify a session exists. No session → session_stale (caller
  //    redirects to sign-in).
  const { data: sessData, error: sessErr } = await client.auth.getSession();
  if (sessErr || !sessData?.session) {
    return { ok: false, reason: 'session_stale' };
  }

  // 2. MFA-not-enabled short-circuit (Phase 66 D-02 / HIPAA-15).
  const factors = await listEnrolledFactors(client);
  if (factors.length === 0) {
    return { ok: false, reason: 'mfa_not_enabled' };
  }

  // 3. Already-fresh short-circuit. If caller overrode the window, use
  //    our window-aware variant; otherwise delegate to the canonical
  //    Phase 25 helper.
  const windowMs = opts?.freshWindowMs ?? AAL2_FRESHNESS_MS;
  const alreadyFresh =
    opts?.freshWindowMs !== undefined
      ? await isFreshWithinWindow(client, windowMs)
      : await isAal2Fresh();
  if (alreadyFresh) {
    return { ok: true };
  }

  // 4. Stale or never-elevated. Need the caller's UI to obtain a code.
  if (!opts?.onChallenge) {
    // No UI hook supplied → treat as cancelled. Defensive — every real
    // caller MUST supply `onChallenge`; this is a misuse signal.
    return { ok: false, reason: 'cancelled' };
  }

  const outcome = await opts.onChallenge();
  if (!('code' in outcome)) {
    // outcome must be { cancelled: true }; narrow here keeps TS happy.
    return { ok: false, reason: 'cancelled' };
  }

  // 5. Run TOTP verify against the first verified factor.
  //    (Consumers have at most one TOTP factor today; if multi-factor
  //    later, the modal can be enhanced to let the user pick — for now,
  //    factors[0] is the canonical TOTP factor.)
  const factor = factors[0]!;
  const result = await verifyTotpChallenge({ factorId: factor.id, code: outcome.code }, client);

  if (!result.ok) {
    return { ok: false, reason: 'invalid_code' };
  }

  persistFreshnessTs();
  return { ok: true };
}
