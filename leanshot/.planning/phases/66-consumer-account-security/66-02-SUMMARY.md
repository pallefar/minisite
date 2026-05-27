---
phase: 66-consumer-account-security
plan: 2
subsystem: auth
tags: [totp, mfa, aal2, backup-codes, supabase-auth, react, typescript]

# Dependency graph
requires:
  - phase: 24-admin-security
    provides: src/lib/admin/totp.ts (Supabase mfa.enroll/challenge/verify wrappers) + generateBackupCodes
  - phase: 25-admin-palette
    provides: src/lib/admin/palette/aal2-step-up.ts (isAal2Fresh + AAL2_LS_KEY + AAL2_FRESHNESS_MS)
provides:
  - src/lib/auth/totp-shared.ts — single shared TOTP wrapper (enroll/verify/list/unenroll) + backup-code generator
  - src/lib/auth/backup-codes-shared.ts — SHA-256 hashBackupCode + constant-time verifyBackupCode (no new npm deps)
  - src/lib/auth/aal2-consumer.ts — requireAal2ForConsumerAction with 3-purpose union (delete/export/change-email) and 4 distinct failure reasons
  - src/lib/admin/totp.ts converted to thin re-export so Phase 25 importers keep working unchanged
affects: [66-03, 66-04, 66-05, 66-06, 66-07]

# Tech tracking
tech-stack:
  added: []  # zero new npm deps — see deviation #1
  patterns:
    - Shared lib pattern src/lib/auth/* used by both admin and consumer surfaces (Phase 66 D-01)
    - Thin re-export migration for back-compat (src/lib/admin/totp.ts → @/lib/auth/totp-shared)
    - Caller-injected SupabaseClient parameter (default to the singleton) for testability without module-level vi.mock
    - Caller-supplied onChallenge() callback as the UI seam — keeps the gate pure-logic and React-free

key-files:
  created:
    - leanshot/src/lib/auth/totp-shared.ts
    - leanshot/src/lib/auth/totp-shared.test.ts
    - leanshot/src/lib/auth/backup-codes-shared.ts
    - leanshot/src/lib/auth/aal2-consumer.ts
    - leanshot/src/lib/auth/aal2-consumer.test.ts
  modified:
    - leanshot/src/lib/admin/totp.ts (replaced 68 LOC of canonical impl with 32-LOC re-export shim)

key-decisions:
  - "Backup-code hashing uses SHA-256 (not argon2id) to match the SHIPPED Phase 24 admin scheme — eliminates a new npm dep + supply-chain risk; verifyBackupCode uses constant-time compare"
  - "Caller injects SupabaseClient via default parameter — keeps tests free from module-level vi.mock of @/lib/supabase and lets future server-side callers pass a service-role client"
  - "freshWindowMs override branches to a tighter LS-direct check; default path delegates to Phase 25 isAal2Fresh() so the JWT auth_time primary path is preserved"
  - "Gate skip on no-MFA returns ok:false + reason:'mfa_not_enabled' rather than ok:true — caller decides whether to proceed (per Phase 66 D-02 + HIPAA-15 the answer is yes, but making it explicit prevents accidental gating)"

patterns-established:
  - "src/lib/auth/* is the canonical shared MFA lib — admin and consumer paths converge here"
  - "Aal2GateResult discriminated union forces callers to handle all 4 failure reasons explicitly"
  - "Aal2ChallengeOutcome (code | cancelled) is the UI-modal contract for Wave 2 plans"

requirements-completed: [AUTH-12, AUTH-13]

# Metrics
duration: ~15min
completed: 2026-05-27
---

# Phase 66 Plan 66-02: Consumer Account Security — Shared MFA Helper Layer

**Pure-logic extraction of TOTP enrollment, verification, listing, unenrollment, backup-code generation/hashing, and consumer AAL2 step-up gate into `src/lib/auth/*` — admin (Phase 25) keeps working via a 32-line thin re-export shim, no new npm dependencies.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-27T07:00:00Z
- **Completed:** 2026-05-27T07:13:00Z
- **Tasks:** 2 (both `type="auto"`)
- **Files created:** 5
- **Files modified:** 1 (admin/totp.ts → re-export shim)

## Accomplishments

- `src/lib/auth/totp-shared.ts` exports `enrollTotp`, `verifyTotp`, `verifyTotpChallenge` (new `{ ok, aal }` envelope), `listEnrolledFactors`, `unenrollFactor`, `generateBackupCodes`, `BACKUP_CODE_ALPHABET`, plus `MfaFactor` / `VerifyTotpChallengeResult` / `EnrollTotpOpts` / `VerifyTotpOpts` types.
- `src/lib/auth/backup-codes-shared.ts` exports `hashBackupCode` (SHA-256 hex), `verifyBackupCode` (constant-time), and re-exports `generateBackupCodes` for convenience.
- `src/lib/auth/aal2-consumer.ts` exports `requireAal2ForConsumerAction(client, purpose, opts)` with the `Aal2ConsumerPurpose` 3-purpose union (`'delete-account' | 'export-all-data' | 'change-email'`) and the `Aal2GateResult` discriminated union covering 4 distinct failure reasons.
- `src/lib/admin/totp.ts` is now a 32-line re-export shim — Phase 25 `SetupTotpPage.tsx` + `__tests__/totp.test.ts` (8 tests, all GREEN via re-export) continue to work without any call-site edits.
- 24 new vitest unit tests, all GREEN (`src-lib-unit` project, node env): 15 in `totp-shared.test.ts`, 9 in `aal2-consumer.test.ts`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract TOTP wrappers + Backup-codes helper into shared lib** — `7494c543` (feat)
2. **Task 2: Add `aal2-consumer.ts` wrapper around existing admin step-up** — `81b1d786` (feat)

_Note: This plan ships pure lib + tests. Wave 2 plans (66-03+) will wire the gate into delete-account / export-all-data / change-email confirm modals._

## Files Created/Modified

- `leanshot/src/lib/auth/totp-shared.ts` — Canonical Supabase Auth MFA wrappers + `generateBackupCodes`. All previous `@/lib/admin/totp` exports re-exported through here.
- `leanshot/src/lib/auth/totp-shared.test.ts` — 15 unit tests for the shared module (generator, enroll, challenge+verify success/error, listFactors filter, unenroll throw, hash determinism, constant-time compare).
- `leanshot/src/lib/auth/backup-codes-shared.ts` — SHA-256 `hashBackupCode` + constant-time `verifyBackupCode`. Mirrors the Postgres `encode(digest(x,'sha256'),'hex')` scheme exercised by `tests/rls/admin-backup-codes-rls.test.ts` (Phase 24).
- `leanshot/src/lib/auth/aal2-consumer.ts` — Consumer-surface AAL2 gate. 4-case result union; LS freshness ts is persisted ONLY on successful verify.
- `leanshot/src/lib/auth/aal2-consumer.test.ts` — 9 unit tests covering all 5 plan-required behaviours plus session-stale, missing-onChallenge, and freshWindowMs override.
- `leanshot/src/lib/admin/totp.ts` — Converted from 68-LOC canonical implementation to 32-LOC re-export shim pointing at `@/lib/auth/totp-shared`.

## Decisions Made

- **SHA-256, not argon2id, for backup-code hashing.** The Phase 24 admin path already ships SHA-256 (`tests/rls/admin-backup-codes-rls.test.ts:124`) — mirroring that scheme keeps consumer + admin code-hash columns interchangeable, requires zero new npm dependencies, and dodges the slopsquat-guard checkpoint that would have triggered on `@noble/hashes` or similar. The Postgres-side Vault-secret HMAC remains the authoritative at-rest hash; this client-side helper is for Edge-Fn lookup paths only.
- **Caller-injected SupabaseClient (default to singleton).** Tests build a minimal `{ auth: { mfa: { enroll, challenge, verify, listFactors, unenroll }, getSession, getAuthenticatorAssuranceLevel } }` stub directly instead of `vi.mock('@/lib/supabase')`. Cleaner per-test setup + the same code path supports future Edge-Fn callers passing a service-role client.
- **freshWindowMs override branches.** When the caller supplies a non-default window (tighter than 15min), we re-derive freshness from the AAL claim + LS ts directly. When the default 15min window is used, we delegate to Phase 25's canonical `isAal2Fresh()` so the JWT `auth_time` primary path (per `aal2-step-up.ts`) keeps working.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing Critical] localStorage polyfill in test file**
- **Found during:** Task 2 (running `aal2-consumer.test.ts`)
- **Issue:** The `src-lib-unit` vitest project runs in `environment: 'node'` (no jsdom), so `globalThis.localStorage` is `undefined`. Three tests asserting freshness-ts persistence failed (`undefined` vs `null`). Without a real store, the impl's `persistFreshnessTs()` couldn't be asserted against.
- **Fix:** Added a `beforeAll` block at the top of `aal2-consumer.test.ts` installing a minimal in-memory `Storage`-shaped polyfill that mirrors the spec's `null` return for missing keys. The implementation itself remains tolerant of undefined `localStorage` (try/catch wrap) per Phase 25 precedent — the polyfill is test-only.
- **Files modified:** `leanshot/src/lib/auth/aal2-consumer.test.ts`
- **Verification:** All 9 tests GREEN after polyfill.
- **Committed in:** `81b1d786` (Task 2)

**2. [Rule 1 — Bug] TypeScript narrowing for `Aal2ChallengeOutcome` discriminated union**
- **Found during:** Task 2 (post-test tsc check)
- **Issue:** `'cancelled' in outcome && outcome.cancelled` doesn't narrow the type for the subsequent `outcome.code` access — TS still considers the `{ cancelled: true }` branch reachable.
- **Fix:** Changed to `if (!('code' in outcome))` so TS narrows the trailing access to `{ code: string }`.
- **Files modified:** `leanshot/src/lib/auth/aal2-consumer.ts`
- **Verification:** `npx tsc -b` clean (excluding pre-existing `useSubscription.ts` errors carried in 66-CARRY-OVER).
- **Committed in:** `81b1d786` (Task 2 — same commit as Fix #1; both happened pre-commit)

**3. [Rule 3 — Blocking] Worktree node_modules symlink to main**
- **Found during:** Task 1 (first vitest run)
- **Issue:** Fresh worktree had no `node_modules`; running tests fails on `@supabase/supabase-js` resolution. Per memory `[[reference_sentry_capacitor_npm_install_blocker]]`, running `npm install` in a fresh worktree blocks on @sentry/capacitor sibling-check.
- **Fix:** `ln -s /Users/karstenhaldan/minisite/leanshot/node_modules ./node_modules` per the documented workaround. Symlink is per-worktree filesystem state — not committed (and `leanshot/node_modules/` is gitignored).
- **Files modified:** None tracked.
- **Verification:** `npx vitest run src/lib/auth/` passes 24/24.
- **Committed in:** N/A (filesystem-only).

**4. [Critical — wrong-cwd write, recovered]** During Task 1 commit prep I issued an Edit against `/Users/karstenhaldan/minisite/leanshot/src/lib/admin/totp.ts` (the **main repo**) instead of the worktree copy, before I had Read the worktree's file. The main repo's working tree was modified. Recovered via `cd /Users/karstenhaldan/minisite/leanshot && git checkout -- src/lib/admin/totp.ts` to discard the leaked write, then Read + Edit applied properly to the worktree path. Main repo working tree restored to clean before any commit. No commits leaked to main. This is the exact failure mode warned about in the system prompt's `<absolute-path safety>` block and in `[[feedback_worktree_executor_pwd_drift_leaks_to_main]]`.

---

**Total deviations:** 4 (2 source-tree fixes, 1 environment setup, 1 recovered foot-gun)
**Impact on plan:** All deviations necessary for correctness/build. No scope creep. The wrong-cwd recovery surfaced + closed cleanly with zero contamination of `main`.

## Issues Encountered

- **Pre-existing `aal2-step-up.test.ts` failures (4 tests).** Known per the prompt's `known_lessons` — NOT a Phase 66 regression. Confirmed `4 failed | 6 passed (10)` matches the documented baseline. Carry to 66-CARRY-OVER for Phase 70 UAT.
- **Pre-existing `useSubscription.ts` tsc errors.** 6 errors of the form `Property 'id' does not exist on type 'User'`. Pre-existing on `main` HEAD (not introduced by this plan); carry to 66-CARRY-OVER.

## Known Stubs

None — all exports are fully wired. The `requireAal2ForConsumerAction` gate is the lib-level surface that Wave 2 modals consume; the modal UI itself is Wave 2's deliverable, not a stub of this plan.

## User Setup Required

None — pure lib + tests, no env vars or external services.

## Next Phase Readiness

- **Wave 2 (66-03+) can import:**
  - `requireAal2ForConsumerAction(supabase, 'delete-account', { onChallenge })` from `@/lib/auth/aal2-consumer`
  - `enrollTotp`, `verifyTotpChallenge`, `listEnrolledFactors`, `unenrollFactor`, `generateBackupCodes` from `@/lib/auth/totp-shared`
  - `hashBackupCode`, `verifyBackupCode` from `@/lib/auth/backup-codes-shared`
- **Phase 25 admin path unaffected** — `SetupTotpPage.tsx` keeps importing from `@/lib/admin/totp`; the 8 admin tests stay GREEN via the re-export shim.
- **No blockers** for Wave 2 wiring.

## Self-Check: PASSED

- File: `leanshot/src/lib/auth/totp-shared.ts` — FOUND
- File: `leanshot/src/lib/auth/totp-shared.test.ts` — FOUND
- File: `leanshot/src/lib/auth/backup-codes-shared.ts` — FOUND
- File: `leanshot/src/lib/auth/aal2-consumer.ts` — FOUND
- File: `leanshot/src/lib/auth/aal2-consumer.test.ts` — FOUND
- File: `leanshot/src/lib/admin/totp.ts` (re-export shim) — verified replaced
- Commit `7494c543` (Task 1) — FOUND
- Commit `81b1d786` (Task 2) — FOUND
- Test sweep `src/lib/auth/` — 24/24 GREEN
- Test sweep `src/lib/admin/__tests__/totp.test.ts` — 8/8 GREEN via re-export

---
*Phase: 66-consumer-account-security*
*Completed: 2026-05-27*
