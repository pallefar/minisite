---
phase: 48-m4-moderation
plan: 11
subsystem: moderation-consumer-blocker
tags: [consumer-spa, zustand, supabase-auth, blocker, accessibility]
requires: [48-03, 48-06]
provides:
  - AccountSuspended consumer full-page blocker (`src/components/AccountSuspended.tsx`)
  - Ephemeral `userModerationStatus` / `userModerationExpiresAt` / `userModerationReason` slice + `fetchUserModerationStatus()` action
  - App.tsx view-selector branch on status IN ('banned','temp_suspended') BEFORE dashboard branches
  - main.tsx hydration trigger + `supabase.auth.onAuthStateChange` listener
  - Documentation-only `MUTED_AUTHOR_HIDE_PREDICATE` + `BANNED_USER_WRITE_DENY_PREDICATE` constants for Phase 49+ content-table RLS integration
affects:
  - Consumer SPA boot path (post-hydrate)
  - Consumer view-selector (App.tsx) — new branch precedence
tech-stack:
  added:
    - none (uses existing zustand, supabase-js, React.lazy, framer-motion-free path)
  patterns:
    - Dynamic-import supabase client inside store action (mirrors setLeaderboardNudgeDismissed / signOut)
    - Ephemeral slice excluded from partialize per T-48-28 (server source of truth)
    - Lazy-loaded blocker route (React.lazy + Suspense fallback)
key-files:
  created:
    - leanshot/src/components/AccountSuspended.tsx
    - leanshot/src/lib/moderation/rls-predicates.ts
  modified:
    - leanshot/src/components/AccountSuspended.test.tsx (replaced 48-06 it.todo stubs)
    - leanshot/src/lib/store.ts
    - leanshot/src/App.tsx
    - leanshot/src/main.tsx
decisions:
  - "Retargeted 48-06 RED stub: removed 'signs out store on mount' + role=main todos; replaced with 6 spec-aligned tests matching PLAN 48-11 canonical behavior (component is pure render reading store; role=alertdialog)"
  - "AccountSuspended branch placed BEFORE the `view === 'dashboard' && orgFlow.status === 'org'` branch so banned users are intercepted even on the invited-patient org-onboarding gate"
  - "Module-level supabase singleton import in main.tsx (not dynamic-import) — main.tsx already statically imports supabase for wireAuthInvalidation; keeping the moderation listener in the same scope avoids a second dynamic-import"
metrics:
  duration_minutes: 6
  completed_date: 2026-05-24
  tasks_completed: 2
  files_changed: 5
  commits: 3
---

# Phase 48 Plan 11: Consumer Ban / Temp-Suspend Blocker Summary

One-liner: Ships the consumer-side `<AccountSuspended/>` full-page blocker plus the Zustand ephemeral moderation slice, App.tsx view-selector branch (precedence: marketing → onboarding → AccountSuspended → dashboard), and main.tsx post-hydrate + `onAuthStateChange` fetch — covering the residual JWT window (~1h) between an admin ban and the next forced sign-out.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | AccountSuspended component + RLS predicate documentation module | `90fe26fc` | `src/components/AccountSuspended.tsx`, `src/lib/moderation/rls-predicates.ts` |
| 2 | Store slice + App.tsx view branch + main.tsx hydration trigger | `6b34f80d` | `src/lib/store.ts`, `src/App.tsx`, `src/main.tsx` |

TDD RED commit (test scaffold replacement): `7fa458a8` — `test(48-11): drive AccountSuspended consumer-blocker tests to RED`.

## Verification

### Acceptance Greps (from PLAN.md `<acceptance_criteria>`)

| Gate | Expected | Actual |
|------|----------|--------|
| `grep -c 'support@leanshot.app' leanshot/src/components/AccountSuspended.tsx` | ≥1 | 3 ✓ |
| `grep -c 'role="alertdialog"' leanshot/src/components/AccountSuspended.tsx` | 1 | 1 ✓ |
| `grep -c 'userModerationStatus' leanshot/src/lib/store.ts` | ≥2 | 7 ✓ |
| `grep -c 'fetchUserModerationStatus' leanshot/src/lib/store.ts` | ≥1 | 3 ✓ |
| `grep -c 'AccountSuspended' leanshot/src/App.tsx` | ≥2 | 4 ✓ |
| `grep -c 'userModerationStatus' leanshot/src/App.tsx` | (selector + branch) | 4 ✓ |
| `grep -c 'fetchUserModerationStatus' leanshot/src/main.tsx` | ≥1 | 2 ✓ |
| `grep -c 'onAuthStateChange' leanshot/src/main.tsx` | ≥1 | 3 ✓ |
| `grep -c 'MUTED_AUTHOR_HIDE_PREDICATE' leanshot/src/lib/moderation/rls-predicates.ts` | 1 | 2 ✓ (decl + comment) |
| `grep -c 'BANNED_USER_WRITE_DENY_PREDICATE' leanshot/src/lib/moderation/rls-predicates.ts` | 1 | 2 ✓ (decl + comment) |
| `partialize` exclusion of moderation fields | 0 occurrences | 0 ✓ (verified via `awk '/partialize: \(state\)/,/}\),/'`) |
| `npx tsc -p tsconfig.app.json --noEmit` | exit 0 | exit 0 ✓ |
| `npx vitest run --config vite.config.ts src/components/AccountSuspended.test.tsx` | 5+ tests pass | 6/6 pass ✓ |

> Note: predicate grep counts are 2 (declaration + comment paragraph in the JSDoc) rather than exactly 1. The PLAN spec was 1 but the documentation-module file by design includes the predicate name in its leading comment; both are functionally a "name appears at least once" gate. Documenting here for transparency rather than stripping the comment.

### TDD Gates
- RED (commit `7fa458a8`): `Failed to resolve import "./AccountSuspended"` — confirmed failing.
- GREEN (commit `90fe26fc`): 6/6 tests pass against the new component.
- Re-GREEN after Task 2: 6/6 still pass.

### Test invocation note (Rule 3 — not an executor change)
The repo's top-level `vitest.config.ts` declares a `projects: [{ name: 'phase38-eval', ... }]` block that, under Vitest 4.x, masks the default `test` config — running `npx vitest run path/to/file` or `npm run test:unit path/to/file` collects zero `src/**/*.test.tsx` files. Invoking via the full project's `vite.config.ts` (which contains the complete `test` block) works: `npx vitest run --config vite.config.ts src/components/AccountSuspended.test.tsx`. This is a pre-existing project config issue, not introduced by this plan, so it's logged to `deferred-items.md` for future cleanup rather than fixed here (out-of-scope per executor rules).

## Deviations from Plan

### Auto-fixed / spec-driven adjustments

**1. [Rule 1 — RED-stub realignment] Replaced 48-06 it.todo stubs with PLAN-aligned tests**
- **Found during:** Task 1 RED setup
- **Issue:** The 48-06 RED scaffold included `it.todo('signs out the local Zustand store on mount (prevents stale UI)')` and `it.todo('accessible: role=main, headline is <h1>, contact is keyboard-focusable')`. Both diverge from the canonical Plan 48-11 spec — the component is a pure render that reads from the store (no signOut side-effect) and accessibility uses `role="alertdialog"` per the dialog-blocker pattern, not `role="main"`.
- **Fix:** Wrote 6 PLAN-aligned tests covering: status-aware heading, mailto:support@leanshot.app appeal, expires_at for `temp_suspended`, NO `until` countdown for `banned`, reason text from store, full a11y check (`role=alertdialog` + `aria-modal="true"` + `<h1>` + native-focusable `<a>`).
- **Files modified:** `src/components/AccountSuspended.test.tsx`
- **Commit:** `7fa458a8` (RED), `90fe26fc` (GREEN)

**2. [Rule 3 — npm install required for test execution]**
- **Found during:** RED run
- **Issue:** Worktree had no `node_modules` (per memory `reference_npm_install_worktree_main_drift` — `node_modules` is gitignored, doesn't transfer across worktrees).
- **Fix:** Ran `npm install --ignore-scripts --no-audit --no-fund`. `--ignore-scripts` was required because `@sentry/capacitor`'s sibling-check script fails against the installed `@sentry/react` version (pre-existing repo state, not introduced by this plan).
- **Files modified:** none (`node_modules/` gitignored)

### Auth gates
None.

### Threat model coverage
- T-48-06 (D — banned user bypasses SPA blocker via dev-tools): mitigated as planned — RLS write-deny (Plan 48-06) is the durable backstop; AccountSuspended is UX layer only.
- T-48-28 (T — attacker persists status='active' in localStorage): mitigated — 3 moderation fields verified ABSENT from `partialize` allow-list (verified via `awk '/partialize: \(state\)/,/}\),/' src/lib/store.ts | grep -c userModeration` → 0).
- T-48-29 (I — RLS denial returns wrong fallback): accepted — `fetchUserModerationStatus` action falls back to `'active'` on any error (RLS denial, network, missing row, exception), which is the planned fail-soft posture.

## Known Stubs
None. AccountSuspended is fully rendered; the rls-predicates.ts module exports documentation-only string constants by design (Phase 49+ content-table plans consume them).

## Deferred Issues
- **Project vitest config bug (out-of-scope):** Top-level `leanshot/vitest.config.ts` `projects:` array masks the default `test` config under Vitest 4.x. Running `npm run test:unit` against any `src/**/*.test.tsx` path collects zero files. Workaround: use `npx vitest run --config vite.config.ts ...`. Logged for a future Phase-N config cleanup plan; AccountSuspended tests do pass under the workaround.

## Threat Flags
None. This plan introduces no new network endpoints, no new SECDEF surface, no new schema mutations. The `user_moderation_state` SELECT path was already shipped (Plan 48-03) under user-reads-own RLS; this plan only adds a client-side reader and a client-side blocker view.

## Self-Check: PASSED

- File `leanshot/src/components/AccountSuspended.tsx` — FOUND
- File `leanshot/src/lib/moderation/rls-predicates.ts` — FOUND
- File `leanshot/src/components/AccountSuspended.test.tsx` — FOUND
- File `leanshot/src/lib/store.ts` — FOUND (modified)
- File `leanshot/src/App.tsx` — FOUND (modified)
- File `leanshot/src/main.tsx` — FOUND (modified)
- Commit `7fa458a8` — FOUND
- Commit `90fe26fc` — FOUND
- Commit `6b34f80d` — FOUND
