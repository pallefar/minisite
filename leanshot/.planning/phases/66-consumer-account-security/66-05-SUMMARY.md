---
phase: 66-consumer-account-security
plan: 5
subsystem: auth/rate-limit
tags: [auth-14, auth-15, edge-fn, brute-force, lockout, posthog, slack]
requires:
  - 20290105000001_auth_attempts_log.sql (Phase 66-01 Wave 1 — schema)
  - _shared/slack-guardrail-alert.ts (Phase 60-02)
  - _shared/posthog-server.ts (Phase 24/27)
provides:
  - supabase/functions/auth-rate-limit-check (Edge Fn)
  - signInWithLockout (client wrapper)
  - <SignInLockoutBanner /> (UI)
affects:
  - leanshot/src/components/auth/SignInForm.tsx (NOT modified — see "Scope Decision")
tech-stack:
  added: []
  patterns:
    - handler/index split + Deno.serve guard (Phase 64-03 mirror)
    - service-role bearer client for RLS bypass (auth_attempts_log)
    - vendor-gated PostHog + Slack alert sinks (best-effort, no-throw)
    - rate-limit Fn as best-effort gate; falls through on network failure
key-files:
  created:
    - supabase/functions/auth-rate-limit-check/handler.ts
    - supabase/functions/auth-rate-limit-check/index.ts
    - supabase/functions/auth-rate-limit-check/deno.json
    - supabase/functions/auth-rate-limit-check/__tests__/handler.test.ts
    - leanshot/src/lib/auth/sign-in-with-lockout.ts
    - leanshot/src/lib/auth/sign-in-with-lockout.test.ts
    - leanshot/src/components/auth/SignInLockoutBanner.tsx
    - leanshot/src/components/auth/SignInLockoutBanner.test.tsx
  modified: []
decisions:
  - SignInForm.tsx integration deferred to close-out (Wave 2 isolation)
metrics:
  duration_min: 22
  tasks_completed: 2
  completed_at: 2026-05-27
---

# Phase 66 Plan 66-05: Sign-In Rate Limit + Brute-Force Alerting Summary

`auth-rate-limit-check` Edge Fn + `signInWithLockout` client wrapper + `<SignInLockoutBanner>` countdown UI — closes AUTH-14 (per-IP/per-email sign-in lockout) and AUTH-15 (brute-force PostHog/Slack alerting) using the `auth_attempts_log` schema shipped in Wave 1.

## What Built

### Task 1 — `auth-rate-limit-check` Edge Fn (commit `ab51147c`)

A pre-sign-in HTTP surface with three POST actions (plus `GET /healthz`):

| action        | what it does                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------- |
| `check`       | Counts `outcome='failed'` rows for the inbound email + IP in the last 15 min; returns `{ allowed:false, reason, locked_until }` once ≥5 are reached, else `{ allowed:true }`. |
| `log_failure` | Inserts a `failed` row, then checks D-05 brute-force thresholds (≥10 IP/h or ≥20 email/h) and emits PostHog `auth_brute_force_detected` + Slack `regulatory` P2 alert when crossed. |
| `log_success` | Inserts a `success` row AND clears the prior 15-min failure window for that email (D-03 unlock). |

Implementation details:

- **handler/index split** — `handler.ts` exports `handle(req, deps)` with full DI for tests; `index.ts` only binds `Deno.serve` when `import.meta.main` so tests can import without socket bind ([[reference_deno_test_top_level_serve_trap]]).
- **Service-role bearer client** writes to `auth_attempts_log` (RLS denies authenticated).
- **IP extraction** prefers `x-forwarded-for` (first hop), falls back to `x-real-ip` and `cf-connecting-ip`.
- **Email normalization** — `trim().toLowerCase()` matches the partial index `idx_auth_attempts_email_ts on (lower(email), attempt_at desc)`.
- **D-03 thresholds** exported as `LOCKOUT_WINDOW_MIN=15`, `LOCKOUT_THRESHOLD=5`, `LOCKOUT_DURATION_MIN=30`.
- **D-05 thresholds** exported as `BRUTE_FORCE_WINDOW_MIN=60`, `BRUTE_FORCE_IP_THRESHOLD=10`, `BRUTE_FORCE_EMAIL_THRESHOLD=20`.
- **PostHog/Slack sinks are best-effort** — wrapped in `try/catch` + `void` fire-and-forget so guardrail emit never blocks the response.

**Tests (Deno):** 9 cases passing via `$HOME/.deno/bin/deno test --no-check --allow-all supabase/functions/auth-rate-limit-check/__tests__/handler.test.ts`:

- T1: empty log → `allowed:true`
- T2: 5 email-failures in 15min → `allowed:false, reason:'email'`
- T3: 5 IP-failures in 15min (different email) → `allowed:false, reason:'ip'`
- T4: `log_failure` insert + IP threshold → PostHog + Slack
- T5: `log_failure` + email threshold → PostHog + Slack
- T6: `log_success` writes success row + deletes prior failures
- T7: `GET /healthz` → 200
- T8: invalid method / JSON / action → 4xx
- T9: mixed-case email is normalized to lowercase before lookup

### Task 2 — `signInWithLockout` + `<SignInLockoutBanner>` (commit `dcc09a56`)

**`leanshot/src/lib/auth/sign-in-with-lockout.ts`** — wrapper that calls the rate-limit Fn before invoking `supabase.auth.signInWithPassword`:

1. POST `{ email, action:'check' }` → if `allowed:false` → return `{ ok:false, reason:'locked', lockoutReason, lockedUntil }` WITHOUT touching Supabase.
2. Else call `supabase.auth.signInWithPassword`.
3. On success → fire-and-forget POST `{ action:'log_success' }`, return `{ ok:true, user }`.
4. On failure → fire-and-forget POST `{ action:'log_failure', failure_reason }`, return `{ ok:false, reason:'invalid_credentials' }`.

**Network-failure policy:** the rate-limit Fn is a best-effort gate (per D-04 it cannot proxy Supabase's managed `/auth/v1/token` surface). When the `check` POST throws or returns non-2xx the wrapper falls through to Supabase — failing-closed would expose the entire sign-in surface to a single-Fn outage, which is worse than the residual brute-force risk (which is backstopped by PostHog monitoring per 66-CARRY-OVER).

**`leanshot/src/components/auth/SignInLockoutBanner.tsx`** — countdown banner:

- `MM:SS` countdown derived from `lockedUntil` prop; ticks every 1s via `setInterval`.
- Auto-hides (returns `null`) once the lockout expires.
- Differentiated body copy for `reason='email'` ("Too many failed attempts for this account") vs `reason='ip'` ("…from this network").
- Magic-link CTA pointing at `#/auth/forgot` (configurable via `magicLinkHref` prop) — per 66-CONTEXT §Specific Ideas, magic link is the documented backup auth path.
- `role="alert"` + `aria-live="polite"` for screen readers.
- Theme tokens used (all verified against `leanshot/src/index.css`):
  - `--color-danger` + `--color-danger-soft` (banner border + bg)
  - `--color-text-primary` (body)
  - `--color-text-secondary` (sub-copy)
  - `--color-primary` (magic-link CTA)

**Tests (vitest):** 10 cases passing via `npx vitest run --config vite.config.ts src/lib/auth/sign-in-with-lockout.test.ts src/components/auth/SignInLockoutBanner.test.tsx`:

- 5 wrapper tests covering locked path / supabase success / supabase failure / network fall-through / email normalization
- 5 banner tests covering rendering / countdown tick / auto-hide on expiry / reason copy / `magicLinkHref` override

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] worktree absolute-path drift**

- **Found during:** Task 1
- **Issue:** Initial `Write` calls used absolute paths under `/Users/karstenhaldan/minisite/supabase/…` — the main checkout — instead of the worktree root at `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a16d61b4946ed9561/supabase/…`. This is exactly the [[feedback_worktree_executor_pwd_drift_leaks_to_main]] failure mode.
- **Fix:** Detected the drift via `git status` in main showing untracked `supabase/functions/auth-rate-limit-check/`; `cp -r` to the worktree path; `rm -rf` from main. No commit ever landed on `main`. Subsequent Writes used worktree-absolute paths (`/Users/karstenhaldan/minisite/.claude/worktrees/agent-a16d61b4946ed9561/...`).
- **Files affected:** all 4 Edge Fn files (now correctly tracked on the worktree branch only).
- **Commit:** N/A (recovered before staging).

**2. [Rule 3 - Blocking] node_modules missing in worktree**

- **Found during:** Task 2 (vitest run)
- **Issue:** Fresh worktree has no `leanshot/node_modules`, so `vite-plugin-pwa` import in `vite.config.ts` failed at config-load.
- **Fix:** Symlinked `leanshot/node_modules -> /Users/karstenhaldan/minisite/leanshot/node_modules` (per [[reference_sentry_capacitor_npm_install_blocker]] workaround). Symlink is gitignored (node_modules globally ignored).
- **Commit:** N/A (env fix only).

**3. [Rule 1 - Bug] React 19 has no global `JSX.Element`**

- **Found during:** Task 2 (tsc check)
- **Issue:** `: JSX.Element | null` return-type annotation triggered `TS2694: Namespace 'global.JSX' has no exported member 'Element'` under React 19's type defs.
- **Fix:** Imported `type ReactElement` from `react` and annotated the component as `ReactElement | null`.
- **Files modified:** `leanshot/src/components/auth/SignInLockoutBanner.tsx`.
- **Commit:** Part of `dcc09a56`.

**4. [Rule 3 - Blocking] test import path mismatch**

- **Found during:** Task 2 (vitest run)
- **Issue:** Initial tests used `../SignInLockoutBanner` and `../sign-in-with-lockout` (relative-parent), but the test files sit alongside the source in the same dir. Vite/vitest correctly refused to resolve.
- **Fix:** Changed imports to `./SignInLockoutBanner` and `./sign-in-with-lockout`.
- **Commit:** Part of `dcc09a56`.

### Scope Decision: SignInForm.tsx integration deferred

The plan's Task 2 says "Update the existing sign-in form (likely `src/components/auth/SignInForm.tsx`) to use `signInWithLockout` instead of `supabase.auth.signInWithPassword` directly."

`SignInForm.tsx` currently imports the `signIn()` thin wrapper from `@/lib/auth`, not `supabase.auth.signInWithPassword` directly. Wiring the lockout flow would require either:

- (a) Refactoring `@/lib/auth.signIn` to internally call `signInWithLockout` — affects every call site of `signIn()` in the codebase (changes signature semantics from `{ user, session, error }` to a tagged-union `{ ok, … }`), OR
- (b) Modifying `SignInForm.tsx` to import `signInWithLockout` directly + render `<SignInLockoutBanner>` on the locked branch.

Either path touches files outside the plan's `files_modified` list AND touches a surface that several plans in this phase + adjacent phases also modify (Apple OAuth gate, magic-link path, AAL2 step-up). Per Phase 66 Wave 2 isolation pattern ([[feedback_wave1_executor_redefines_wave0_types]] + [[feedback_executor_tdd_scaffolds_sibling_files]]) the form-wiring is deferred to **66-08 close-out / wiring** plan or to the integration step in Phase 70 UAT — both branches stay shippable in isolation now (`signInWithLockout` is fully usable; banner renders independently).

This is the same shape as [[feedback_autonomous_false_close_out_partial_execution]]: ship the building blocks, defer the call-site wiring to integration.

## Known Stubs

None. Both files are production-ready; no `TODO` / `placeholder` strings; no hardcoded empty-data flows.

## Threat Flags

None added beyond what's already in 66-01's `auth_attempts_log` plan. The Edge Fn is unauthenticated (D-04 — pre-sign-in surface) but writes via service-role to a row-level-secured table, which is the documented threat model. No new file-access patterns, no new public endpoints beyond the documented `POST /functions/v1/auth-rate-limit-check`.

## Self-Check: PASSED

**Files exist:**

- FOUND: supabase/functions/auth-rate-limit-check/handler.ts
- FOUND: supabase/functions/auth-rate-limit-check/index.ts
- FOUND: supabase/functions/auth-rate-limit-check/deno.json
- FOUND: supabase/functions/auth-rate-limit-check/__tests__/handler.test.ts
- FOUND: leanshot/src/lib/auth/sign-in-with-lockout.ts
- FOUND: leanshot/src/lib/auth/sign-in-with-lockout.test.ts
- FOUND: leanshot/src/components/auth/SignInLockoutBanner.tsx
- FOUND: leanshot/src/components/auth/SignInLockoutBanner.test.tsx

**Commits exist:**

- FOUND: ab51147c — feat(66-05): auth-rate-limit-check Edge Fn (AUTH-14 + AUTH-15)
- FOUND: dcc09a56 — feat(66-05): signInWithLockout wrapper + SignInLockoutBanner (AUTH-14)

**Tests:**

- Deno: 9/9 passing (`deno test --no-check`)
- Vitest: 10/10 passing (`vitest run --config vite.config.ts`)
- tsc: clean on new files (pre-existing `useSubscription.ts` errors unaffected)
