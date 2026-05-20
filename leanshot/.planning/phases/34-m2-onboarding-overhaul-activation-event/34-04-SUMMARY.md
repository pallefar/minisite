---
phase: 34-m2-onboarding-overhaul-activation-event
plan: 04
subsystem: auth
tags: [auth, oauth, pkce, onboarding, apple, google]
wave: 2
requires:
  - 34-01  # profiles table baseline (completed_onboarding_at column)
provides:
  - signInWithOAuthProvider  # consumed by Plan 34-06 (goal-step OAuth row)
  - isAppleEnabled           # consumed by Plan 34-06 (button-row gate)
  - /auth/callback view      # PKCE callback path-route
affects:
  - src/App.tsx              # selectView() path branch + render switch
tech-stack:
  added: []
  patterns:
    - vendor-gated-send-via-health-check (Apple OAuth flag — flip in 34-10)
    - vi.hoisted() for vitest mock-fn lift above hoisted vi.mock factories
key-files:
  created:
    - leanshot/src/components/auth/AuthCallbackView.tsx
    - leanshot/src/components/auth/AuthCallbackView.test.tsx
  modified:
    - leanshot/src/lib/auth.ts
    - leanshot/src/lib/auth.test.ts
    - leanshot/src/App.tsx
decisions:
  - PKCE callback uses PATH routing (/auth/callback) not hash (#/auth/callback) — OAuth providers cannot redirect to # fragments (34-RESEARCH Pitfall 1).
  - Path branch matched BEFORE hash #/auth/ in selectView() to defeat any residual-hash interaction with the magic-link flow.
  - Apple gate exported as `isAppleEnabled()` (not duplicated inside the OAuth wrapper) per plan-checker B-03 fix — Plan 34-06 imports it for the button row.
  - Tri-source Apple flag: env (VITE_AUTH_APPLE_ENABLED) > localStorage (leanshot_auth_apple_enabled) > false default. Plan 34-10 flips the env after Apple Services ID + .p8 are registered.
metrics:
  duration_minutes: ~6
  tasks_completed: 2
  unit_tests_added: 9   # 5 in auth.test.ts + 4 in AuthCallbackView.test.tsx
  commits: 4
  completed_date: 2026-05-20
requirements_completed:
  - ONBOARD-02
---

# Phase 34 Plan 34-04: PKCE OAuth + AuthCallbackView Summary

PKCE OAuth wrapper (`signInWithOAuthProvider`) for Google + Apple with
feature-gated Apple via `isAppleEnabled()`; new `/auth/callback` path-route
in App.tsx selecting a new `AuthCallbackView` that exchanges the PKCE code
and routes to `/#/onboarding` (new) or `/#/dashboard` (returning) based on
`profiles.completed_onboarding_at`.

## What Was Built

### Task 1 — `signInWithOAuthProvider` wrapper + Apple gate (`leanshot/src/lib/auth.ts`)

- **`signInWithOAuthProvider('google' | 'apple')`** calls
  `supabase.auth.signInWithOAuth({ provider, options: { redirectTo: \`${origin}/auth/callback\` } })`.
- `redirectTo` is **PATH-based** (`/auth/callback`), never `#/...` — required because OAuth providers cannot redirect to URL fragments
  (34-RESEARCH Pitfall 1). PKCE is the supabase-js v2 default flow.
- Apple short-circuits with `{ error: { message: 'apple_disabled' } }` when
  `isAppleEnabled()` returns false; Supabase is **not** called (vendor-gated
  send pattern — protects users from a 400 from GoTrue when `.p8` is not
  yet registered).
- **`isAppleEnabled()`** exported (plan-checker B-03 fix). Tri-source:
  1. `import.meta.env.VITE_AUTH_APPLE_ENABLED === 'true'` (build-time)
  2. `localStorage['leanshot_auth_apple_enabled'] === 'true'` (runtime override)
  3. `false` (default)
- Per memory `reference_vite_static_env_inlining`: env lookup uses a literal
  key, never a dynamic `import.meta.env[\`VITE_${x}\`]` expression.
- `signInWithMagicLink` **unchanged** — magic-link still uses the hash-based
  `/#/auth/verify` redirect; the main.tsx double-`#` fix (lines 51-69) keeps
  protecting implicit-grant flows only.

### Task 2 — `AuthCallbackView` + App.tsx routing (`leanshot/src/components/auth/AuthCallbackView.tsx`)

- New lazy-loaded React component that on mount:
  1. Calls `supabase.auth.exchangeCodeForSession(window.location.href)` to
     exchange the OAuth `?code=...` for a session (server-side validation by
     GoTrue).
  2. On success, reads `profiles.completed_onboarding_at` for the new
     user.id; routes to `/#/dashboard` (populated) or `/#/onboarding` (null).
  3. On exchange error or missing user, routes to `/#/auth/error`.
- Renders a centred spinner with `role="status"` + `aria-live="polite"`
  (WCAG-compliant loading state). No interactive elements while exchanging.
- Cancellation-safe (`cancelled` flag in useEffect cleanup).

### App.tsx — three additive insertions

1. **View union** (line ~470): added `'auth-callback'` next to `'auth'`.
2. **`selectView()`** (line ~590): inserted PATH branch
   `if (opts.pathname === '/auth/callback' || opts.pathname === '/auth/callback/') return 'auth-callback'`
   **BEFORE** the `#/auth/` hash branch — guarantees the callback URL
   routes here regardless of any residual hash.
3. **Render switch** (line ~1518): added `if (view === 'auth-callback')`
   branch rendering `<AuthCallbackView />` inside `<Suspense fallback={<FullPageLoader />}>`, alongside `view === 'auth'`.

## Test Coverage

- `src/lib/auth.test.ts` — added 5 new cases (18 total, all pass):
  - `signInWithOAuthProvider('google')` → invokes signInWithOAuth with
    PATH redirectTo (no `#`).
  - `signInWithOAuthProvider('apple')` with no override → returns
    `{ error: { message: 'apple_disabled' } }`; signInWithOAuth NOT called.
  - `signInWithOAuthProvider('apple')` with localStorage override → calls
    signInWithOAuth with provider=apple + PATH redirectTo.
  - `isAppleEnabled()` returns false by default.
  - `isAppleEnabled()` returns true when localStorage flag set.
- `src/components/auth/AuthCallbackView.test.tsx` — 4 new cases, all pass:
  - Success + null `completed_onboarding_at` → `/#/onboarding`.
  - Success + populated `completed_onboarding_at` → `/#/dashboard`.
  - Exchange error → `/#/auth/error`, profile lookup not called.
  - Spinner has `role="status"` + `aria-live="polite"` during exchanging.

Both test files exit clean: `npm run test:unit -- --run src/lib/auth.test.ts src/components/auth/AuthCallbackView.test.tsx` → **22 / 22 pass**.

`npx tsc -p tsconfig.app.json --noEmit` → **clean** (no new type errors).

ESLint clean on all files modified/created by this plan
(`src/lib/auth.ts`, `src/lib/auth.test.ts`, `src/components/auth/AuthCallbackView.tsx`, `src/components/auth/AuthCallbackView.test.tsx`).

## Commits

| # | Commit  | Type    | Description |
|---|---------|---------|-------------|
| 1 | eceddbf | test    | Failing tests for signInWithOAuthProvider + isAppleEnabled (RED) |
| 2 | 86f4b48 | feat    | signInWithOAuthProvider PKCE wrapper + isAppleEnabled gate (GREEN) |
| 3 | 527e4e6 | test    | Failing AuthCallbackView tests for PKCE code exchange (RED) |
| 4 | 491f0d5 | feat    | AuthCallbackView + /auth/callback path-route in App.tsx (GREEN) |

## TDD Gate Compliance

Both tasks followed strict RED → GREEN:

- Task 1: RED commit `eceddbf` (5 failing tests) → GREEN commit `86f4b48` (18/18 pass).
- Task 2: RED commit `527e4e6` (test resolve-error: file missing) → GREEN commit `491f0d5` (4/4 pass).

No REFACTOR commit — implementations were minimal and clean on first pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Missing `node_modules` in worktree spawn**
- **Found during:** Task 1 RED test run.
- **Issue:** `git worktree add` creates an empty checkout; `npm run test:unit` failed with `sh: vitest: command not found`. Per memory `feedback_worktree_executor_npm_install_leak`, running `npm install` in a worktree can leak files into the main checkout.
- **Fix:** Created a relative symlink `leanshot/node_modules → /Users/karstenhaldan/minisite/leanshot/node_modules`. Symlink stayed untracked (kept off the commit list).
- **Files modified:** none (symlink only)
- **Commit:** N/A — environment-only fix.

**2. [Rule 1 - Bug] vitest hoist ordering in AuthCallbackView.test.tsx**
- **Found during:** Task 2 GREEN test run (first attempt).
- **Issue:** `vi.mock('@/lib/supabase', () => ({ ..., exchangeCodeForSession: mockExchangeCodeForSession }))` hoists ABOVE `const mockExchangeCodeForSession = vi.fn()` → ReferenceError at module load.
- **Fix:** Switched to `vi.hoisted(() => ({ ... }))` so the mock fns lift to the same hoist tier as `vi.mock`. All four tests pass.
- **Files modified:** `leanshot/src/components/auth/AuthCallbackView.test.tsx`
- **Commit:** rolled into 491f0d5 (Task 2 GREEN — landed before any commit).

**3. [Rule 1 - Bug] ESLint `import-x/order` violation on test file**
- **Found during:** Lint pass after Task 2 implementation.
- **Issue:** Pattern `import (testing-library) → vi.hoisted → vi.mock → import AuthCallbackView` violates `import-x/order` (no second import-group after non-import statements).
- **Fix:** Switched to dynamic `await import('./AuthCallbackView')` inside each test body (same pattern as `auth.test.ts`). Made Test 4 async to accommodate the dynamic import.
- **Files modified:** `leanshot/src/components/auth/AuthCallbackView.test.tsx`
- **Commit:** rolled into 491f0d5 (Task 2 GREEN — landed before any commit).

### Deferred Items (out of scope)

**Pre-existing `import-x/order` errors in `src/App.tsx` (8 total)** — confirmed via `git stash` + lint on stash → errors present on `main` (`beae1b4`) untouched by this plan. NOT fixed because they are pre-existing, in unrelated code regions, and outside this plan's scope per executor SCOPE BOUNDARY rule. Logged here for visibility only.

## Authentication Gates

None — this plan is frontend-only and added no new external auth-touching API surface. The wired Apple OAuth flow ships disabled by default; Plan 34-10 will flip the flag after Apple Services ID + `.p8` are human-registered (vendor-gated send pattern).

## Threat Surface

No new surface beyond the plan's threat_model. Confirmed:
- `/auth/callback` is the same-origin redirect target (T-34-04-03 mitigation).
- `exchangeCodeForSession` server-side validation via supabase-js (T-34-04-01 mitigation).
- Apple gate is UI-only — real auth gate is at Supabase dashboard config (T-34-04-04 accept).

## Known Stubs

None. The Apple flag is intentionally `false` by default; Plan 34-10 owns the
human checkpoint to set `VITE_AUTH_APPLE_ENABLED=true` once Apple Services
ID + `.p8` are registered. This is a documented vendor-gated flow, not a stub.

## Downstream Consumers

- **Plan 34-06** (Wave 3 — `/onboard` route + goal-step OAuth button row):
  imports `signInWithOAuthProvider` + `isAppleEnabled` from `@/lib/auth`.
  Renders the Google button always; Apple button conditionally on
  `isAppleEnabled()`.
- **Plan 34-10** (Apple Services ID + `.p8` human checkpoint): flips
  `VITE_AUTH_APPLE_ENABLED` to `'true'` in Vercel env after Supabase
  `auth.apple` provider secrets are set.

## Self-Check: PASSED

- [x] `leanshot/src/lib/auth.ts` — FOUND (signInWithOAuthProvider + isAppleEnabled exported)
- [x] `leanshot/src/lib/auth.test.ts` — FOUND (5 new cases added)
- [x] `leanshot/src/components/auth/AuthCallbackView.tsx` — FOUND
- [x] `leanshot/src/components/auth/AuthCallbackView.test.tsx` — FOUND (4 cases)
- [x] `leanshot/src/App.tsx` — FOUND (3 insertions: View union, selectView, render switch)
- [x] Commit `eceddbf` (test RED Task 1) — FOUND in `git log`
- [x] Commit `86f4b48` (feat GREEN Task 1) — FOUND in `git log`
- [x] Commit `527e4e6` (test RED Task 2) — FOUND in `git log`
- [x] Commit `491f0d5` (feat GREEN Task 2) — FOUND in `git log`
- [x] `npm run test:unit -- --run src/lib/auth.test.ts src/components/auth/AuthCallbackView.test.tsx` → 22/22 pass
- [x] `npx tsc -p tsconfig.app.json --noEmit` → clean
- [x] ESLint clean on all files created/modified by this plan
