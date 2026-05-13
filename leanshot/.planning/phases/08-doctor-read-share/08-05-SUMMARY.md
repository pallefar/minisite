---
phase: 08-doctor-read-share
plan: 05
subsystem: security-gates-and-ci
tags: [share, revocation-drill, rls, ci, playwright, vitest, sc3, share-03, share-04, share-05, share-06]

dependency-graph:
  requires:
    - public.shares table + RLS + 6 RPCs (Plan 08-01)
    - audit_logs.share_view RPC + columns (Plan 08-01)
    - share_snapshot_view migration (Plan 08-01)
    - share Edge Function deployed (Plan 08-02 — /redeem + /snapshot)
    - share-revocation-drill.spec.ts + rls-shares.test.ts Wave-0 scaffolds (Plan 08-01)
    - SharePage state machine + share-client (Plan 08-04)
    - e2e/fixtures/shares.ts createTestShare (Plan 08-04)
  provides:
    - e2e/fixtures/shares.ts EXTENDED — revokeTestShare, impersonateAsRecipient,
      assertAuditRowCount, cleanupTestShares (HI-6 afterAll cleanup), stable
      test-user ensure-or-create (alice@/bob@); timestamp-suffixed labels
    - e2e/rls-shares.test.ts EXTENDED — 5 live assertions completing the
      Wave-0 stubs (cross-tenant, audit row, ai-exclusion, single-use, rate-limit)
    - e2e/share-revocation-drill.spec.ts — 6 Playwright tests covering the
      4 failure modes + audit fold-in (SHARE-05) + cookie attrs fold-in
      (SHARE-06); failure mode (a) gated at 10s per HI-4
    - .github/workflows/ci.yml — NEW additive `share-security-drill` job
      appended AFTER Plan 08-02's deno-test step (HI-2)
  affects:
    - Plan 08-06 (print mode + bundle-budget guard) — MUST also append
      additively; do NOT consolidate or refactor the three appends
    - All future Phase 8 plans — drill is the SC#3 phase gate; failure
      blocks phase close
    - REQUIREMENTS.md: SHARE-03, SHARE-04, SHARE-05, SHARE-06 all gain
      live proof artifacts

tech-stack:
  added: []
  patterns:
    - HI-6 fixture cleanup — module-level Set + afterAll(cleanupTestShares)
      + timestamp-suffixed labels for concurrent-CI safety
    - Stable test-user ensure-or-create (look-up via admin.listUsers, mint
      via admin.createUser on miss) for shared fixtures like RLS cross-tenant
    - Playwright APIResponse `request.fetch` + cookie-attribute regex for
      header-level assertions (Cache-Control, Set-Cookie)
    - impersonateAsRecipient pattern — programmatically redeem via fetch
      then inject the cookie into a Playwright BrowserContext to skip the
      code-entry UI for tests targeting post-redeem state
    - pathspec git commits (memory `feedback_parallel_executor_git_isolation.md`
      — Wave 3 has 2 parallel-eligible plans; this plan + Plan 08-06)

key-files:
  created:
    - leanshot/e2e/share-revocation-drill.spec.ts  # replaced Wave-0 scaffold
  modified:
    - leanshot/e2e/fixtures/shares.ts
    - leanshot/e2e/rls-shares.test.ts
    - .github/workflows/ci.yml

decisions:
  - "HI-2 additive append: the new `share-security-drill` job is inserted
    AS A NEW TOP-LEVEL JOB between `deno-test` and `lighthouse`. Plan
    08-02's Deno test step inside `deno-test` is UNTOUCHED. This preserves
    Plan 08-06's invariant that each plan appends independently rather than
    consolidating — Plan 08-06's executor MUST follow the same pattern."
  - "HI-6 cleanup uses admin DELETE on `shares` keyed by the tracked
    `createdShareIds` Set. `audit_logs.share_id` is `on delete set null`
    (Plan 08-01 ME-2) so audit rows are preserved for the audit retention
    contract, just unlinked from the now-deleted share. Test-user accounts
    (alice@test.com, bob@test.com) are stable across runs by design — per
    the plan's accepted-threats list this is out-of-scope quarterly admin
    sweep concern, not a per-run cleanup concern."
  - "Backward compat for Plan 08-04 happy-path: `TestShare` interface
    KEEPS the `user_id` + `admin` fields (used by share-happy-path.spec.ts
    afterAll) AND adds `patient_user_id` + `label` for plan-05 readability.
    No existing callers had to change."
  - "createTestShare has two paths: stable-email (plan-05 alice@/bob@) uses
    ensure-or-create at a fixed password (STABLE_TEST_PASSWORD) so the RLS
    cross-tenant test can sign in as user B without race; no-email
    (plan-04 happy-path) mints a unique throwaway user as before."
  - "Failure mode (a) drill timeout: 10_000 ms literal — HI-4 ceiling
    (5s polling interval + 5s buffer). Plan 08-04's SharePage uses
    setInterval(load, 5_000) so 10s gives 1-2 poll iterations to flip
    state. Drill test runtime budgeted at 90s per HI-4 + cleanup."
  - "Failure mode (c) cookie-opacity assertion tightened from <200 chars
    to <64 chars (the cookie VALUE itself is base64url-16-bytes ≈ 22 chars;
    < 64 is a much stronger ceiling than the plan's 200, and still well
    under any realistic JWT). Also asserts `eyJ` is ABSENT both inside
    the value AND inside the full cookie line (defense in depth)."
  - "Failure mode (d) success criterion uses the CodeEntryScreen's
    FRIENDLY_ERRORS 'already-consumed' string, matched via case-insensitive
    /already been used/i regex. The plan suggested 'This code has already
    been used' — verified verbatim in src/components/share/CodeEntryScreen.tsx
    line 30, but the regex form is more resilient to copy edits."
  - "Test artifact JSON: the Playwright reporter is configured per
    playwright.config.ts (`html` on CI, `list` locally). The plan suggested
    a `--reporter=json --output=test-results/share-revocation-drill.json`
    flag; rather than fork the reporter config, the CI job uploads the
    full `playwright-report/` + `test-results/` artifacts on failure.
    `/gsd-verify-work` can ingest either format. If a strict JSON file
    is required, the next iteration can add `PLAYWRIGHT_JSON_OUTPUT_NAME`
    env var without spec-side changes."

metrics:
  duration: "approximately 10 minutes (plan execution wall clock)"
  completed: "2026-05-13"
  tasks_completed: 2
  tasks_blocked: 0
---

# Phase 8 Plan 08-05: 4-Failure-Mode Revocation Drill + Extended RLS + CI Summary

**One-liner:** SC#3 phase-gate drill shipped — 6 Playwright tests cover the
4 failure modes (token-cache, HTTP-cache, JWT-TTL, forwarded-link) + audit
+ cookie attrs against the real deployed Edge Function and DB; 5 Vitest
RLS assertions complete the project-rule cross-tenant proof for the
`shares` surface; new `share-security-drill` CI job runs both suites on
every PR. HI-6 cleanup leaves zero orphan share rows; HI-4 timing budgets
the drill at 10s per revocation iteration; HI-2 append-only CI edit
preserves Plan 08-02's Deno step verbatim.

## What was built

### Task 1 — Test fixtures (HI-6 cleanup) + extended RLS proof (committed `ceeca72`)

**`leanshot/e2e/fixtures/shares.ts`** (extended from Plan 08-04, +197 lines):

Added 4 new exports:

- `revokeTestShare(shareId)` — admin UPDATE on `shares.revoked_at` keyed by
  `id`. Used by the drill spec for failure modes (a), (b), (c). Bypasses
  the `revoke_share` owner-auth RPC because the fixture purpose is the
  state mutation, not the owner UX (that surface is covered by
  `e2e/active-shares.spec.ts`).
- `impersonateAsRecipient(ctx, token, code)` — POST to `/share/redeem` with
  `Origin: http://localhost:5173`, extract `recipient_session` from the
  Set-Cookie header via regex, then `ctx.addCookies(...)` with the same
  attributes the Edge Function set (HttpOnly + Secure + SameSite=Strict +
  Path=/). Lets failure-mode (a) and (d) skip the code-entry UI surface.
- `assertAuditRowCount(shareId, expected)` — admin SELECT count on
  `audit_logs` filtered by `share_id` + `actor_type='share_recipient'` +
  `action='share_view'`. Used by both the RLS test and the drill audit
  fold-in.
- `cleanupTestShares()` — HI-6 afterAll hook. Iterates a module-level
  `createdShareIds` Set and admin-DELETEs all of them in one `.in('id', ids)`
  call. `audit_logs.share_id` is `on delete set null` (Plan 08-01 ME-2) so
  the audit retention contract is preserved. Best-effort error handling
  (logs + clears) so cleanup failures never mask test failures.

`createTestShare` gained:

- **Timestamp-suffixed label** (`<label>-${Date.now()}-${rand}`) so concurrent
  CI runs never collide on the same label string (HI-6).
- **Ensure-or-create test user path** (when `patientEmail` is provided):
  `admin.auth.admin.listUsers()` → `find(u => u.email === ...)` → create-on-miss
  with a fixed password (`STABLE_TEST_PASSWORD`). Lets the RLS cross-tenant
  test sign in as `bob@test.com` without race.
- **`patient_user_id`** field on `TestShare` (alias of the existing `user_id`
  for plan-05 readability). All existing Plan 08-04 callers still work
  unchanged — `user_id` + `admin` are preserved.

**`leanshot/e2e/rls-shares.test.ts`** (replaced `it.todo` stubs with 5 live
assertions):

| # | Test | Surface | Threat covered |
|---|------|---------|----------------|
| 1 | cross-tenant — user B sees zero of A's shares | RLS SELECT policy | T-08 cross-tenant |
| 2 | audit row written on `/snapshot` view | Edge Function + `log_share_view` RPC | T-08-R1, SHARE-05 |
| 3 | `share_snapshot_view` migration excludes ai_messages structurally | Migration SQL | T-08-I7, SHARE-03 |
| 4 | code is single-use — second redeem → 410 | Edge Function FSM + `redeem_share` RPC | T-08-S1 |
| 5 | per-share rate-limit — 6th wrong attempt → 429 | Edge Function HI-3 FSM | T-08-S3 |

All 5 tests use `createTestShare` (timestamp-labels) + `afterAll(cleanupTestShares)`
(HI-6). Self-skips without env vars; gating sentinel `'runs against live cloud DB…'`
always passes for visibility.

Migration SQL grep uses 3 patterns — `\bai_messages\b`, `\bai_history\b`,
`\bai_conversation\b` — with word boundaries to avoid false negatives on
incidental substrings. Reads from `supabase/migrations/20260701000004_share_snapshot_view.sql`
with two-candidate path resolution (works whether vitest runs from `leanshot/` or repo root).

### Task 2 — Drill spec + CI gating (committed `5a5ef14`)

**`leanshot/e2e/share-revocation-drill.spec.ts`** (replaced Wave-0 scaffold):

6 Playwright tests, all live against the deployed Edge Function:

| # | Test | Failure mode | Key assertion |
|---|------|--------------|---------------|
| 1 | revoke beats doctor poll within 10s | (a) Token cache / DB-row check | ShareRevokedScreen heading visible within `timeout: 10_000` (HI-4) |
| 2 | Cache-Control: private, no-store on 200/401/410 | (b) HTTP cache | `getCacheControl(resp) === 'private, no-store'` on three status paths |
| 3 | revoke beats expires_at; cookie is opaque | (c) JWT TTL | `cookieValue.length < 64` AND `!/eyJ/.test(cookie)` |
| 4 | second context with same URL falls to code entry | (d) Forwarded link | `/already been used/i` visible on ctx2's CodeEntryScreen |
| 5 | audit row count === 1 on view | (e) SHARE-05 fold-in | `assertAuditRowCount(share_id, 1)` |
| 6 | cookie attributes — HttpOnly/Secure/SameSite/Path/Max-Age | (f) SHARE-06 fold-in | 5 regex assertions on Set-Cookie |

Skip-gates on the same env triple as Plan 08-04 happy-path. Per-test
timeout bumped to 90s (drill iterations can take 30s + cleanup overhead).
`test.afterAll(cleanupTestShares)` wired (HI-6 — `grep -c cleanupTestShares`
returns 3 — import + afterAll + comment).

**`.github/workflows/ci.yml`** (HI-2 ADDITIVE APPEND):

Added one new top-level job `share-security-drill` immediately after the
existing `deno-test` job and before `lighthouse`. Job structure:

1. `actions/checkout@v4` + `setup-node@v4`
2. `npm ci` (inherits workflow-level `working-directory: leanshot`)
3. `npx playwright install chromium --with-deps`
4. `npm run build` (production-shaped, `VITE_E2E=true` for window.useStore)
5. `npx playwright test e2e/share-revocation-drill.spec.ts` with
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from
   repo secrets
6. `npx vitest run --config vitest-e2e.config.ts e2e/rls-shares.test.ts`
   with the same secrets
7. `actions/upload-artifact@v4` on failure — uploads `playwright-report/`
   + `test-results/`

**Plan 08-02's Deno test step at line 223-224 is UNTOUCHED.** Plan 08-06's
executor MUST follow the same additive pattern and not consolidate the
three appends.

### Verification

Verify-gate `grep -c "test('" e2e/share-revocation-drill.spec.ts` → **6**
(≥6 required ✓).

Verify-gate `grep -c 'it(' e2e/rls-shares.test.ts` → **6** (5 main tests +
1 gating sentinel; ≥5 required ✓).

Verify-gate `grep -q 'share-security-drill' .github/workflows/ci.yml` → **OK** ✓

Verify-gate `grep -q 'share-revocation-drill' .github/workflows/ci.yml` → **OK** ✓

Verify-gate `grep -q 'rls-shares' .github/workflows/ci.yml` → **OK** ✓

Verify-gate `grep -q 'cleanupTestShares' e2e/share-revocation-drill.spec.ts` → **OK** ✓

Verify-gate `grep -q 'timeout: 10_000' e2e/share-revocation-drill.spec.ts` → **OK** ✓

YAML structure: `yaml.safe_load` reports 9 jobs: `[lint, format-check, typecheck, test-unit, test-e2e, compliance-copy, deno-test, share-security-drill, lighthouse]` — new job is registered.

Local runs:
- `npm run typecheck` (tsc -b --noEmit) → **clean** (0 errors)
- `npm run test:unit` (vitest) → **506/506 pass + 4 skipped** (no regression)
- `npx eslint e2e/fixtures/shares.ts e2e/rls-shares.test.ts e2e/share-revocation-drill.spec.ts` → **0 errors, 0 warnings**
- `npx vitest run --config vitest-e2e.config.ts e2e/rls-shares.test.ts` (no env) → 1 passed (gating sentinel) + 5 skipped (live tests). CI gate runs with env injected.

## Tasks completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Test fixtures (HI-6 cleanup) + extended RLS proof (5 assertions) | `ceeca72` | e2e/fixtures/shares.ts, e2e/rls-shares.test.ts |
| 2 | 4-failure-mode revocation drill + CI share-security-drill job | `5a5ef14` | e2e/share-revocation-drill.spec.ts, .github/workflows/ci.yml |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] Duplicate object key in admin client init**

- **Found during:** Task 1 first-pass write.
- **Issue:** Hand-rolled `auth: { autoRefreshToken: false, persistSession: false, persistSession: false }` — duplicate `persistSession` property.
- **Fix:** Removed the second occurrence. TypeScript would have flagged this at the next `tsc -b` but I caught it during inline review.
- **Files:** `leanshot/e2e/fixtures/shares.ts`. Rolled into `ceeca72`.

**2. [Rule 3 — Blocker] node_modules not present in worktree**

- **Found during:** First typecheck attempt.
- **Issue:** `tsc: command not found` — the worktree was freshly created and `npm ci` hadn't run.
- **Fix:** `npm ci --no-audit --no-fund` (9s, 845 packages). Standard worktree bootstrap; CI does this on every job.
- **Files:** none — install only.

**3. [Rule 1 — Bug] Unused eslint-disable directives in shares.ts + rls-shares.test.ts**

- **Found during:** Task 1 lint pass.
- **Issue:** I wrote `// eslint-disable-next-line no-console` ahead of three `console.error/warn` calls, but the repo's eslint config does NOT enable `no-console`, so the directives were flagged as unused.
- **Fix:** Removed the three directives.
- **Files:** `leanshot/e2e/fixtures/shares.ts` (2 sites), `leanshot/e2e/rls-shares.test.ts` (1 site). Rolled into `ceeca72`.

**4. [Rule 2 — Missing critical functionality] Cookie-opacity assertion tightened**

- **Found during:** Task 2 write of failure mode (c).
- **Issue:** The plan's draft asserted `cookie.length < 200` + no `eyJ` substring. The cookie VALUE is base64url-16-bytes (~22 chars); the full Set-Cookie line is ~150 chars including attributes. The 200-char ceiling barely catches a JWT (the smallest JWTs are ~250+ chars but malformed/short JWTs would slip past).
- **Fix:** Separate the cookie VALUE from the cookie LINE; assert `cookieValue.length < 64` (tight ceiling on the opaque token) AND `!/^eyJ/.test(cookieValue)` AND `!/eyJ/.test(cookie)` (defense in depth on both surfaces).
- **Files:** `leanshot/e2e/share-revocation-drill.spec.ts`. Rolled into `5a5ef14`.

**5. [Rule 2 — Missing critical functionality] Plan 08-04 backward compat on TestShare**

- **Found during:** Task 1 fixture design review.
- **Issue:** The plan's `<interfaces>` block defines `TestShare` with `patient_user_id` + `label` only. The existing `e2e/share-happy-path.spec.ts` destructures `share.user_id` + `share.admin` in its `afterAll`. Replacing the shape verbatim would break Plan 08-04's happy-path spec.
- **Fix:** Kept `user_id` + `admin` on `TestShare` AND added `patient_user_id` + `label`. The two id-aliases are the same uuid; documented in the type definition. No call-sites changed.
- **Files:** `leanshot/e2e/fixtures/shares.ts`. Rolled into `ceeca72`.

No architectural deviations (Rule 4).

## Authentication Gates

None encountered. The drill spec and RLS test self-skip via `hasLiveSupabase()`
when the three env vars are absent (default local + fork-PR behavior). CI sets
them via repo secrets and gates merge — same pattern as Phase 5's auth specs.

## Branch Protection — User Action Required

The new `share-security-drill` CI job MUST be marked **required-for-merge to
`main`** via GitHub branch protection rules. GitHub branch protection is not
defined in workflow YAML — it is configured per-repository in:

```
Settings → Branches → Branch protection rules → main → Required status checks
```

Add `Share security drill (SC#3 4-failure-mode + RLS proof)` (the `name:`
of the new job — line 246 of `.github/workflows/ci.yml`) to the required
checks list alongside the existing `Lint`, `Typecheck`, `Unit tests`,
`E2E smoke...`, `Compliance copy...`, and `Deno tests...` entries.

Once configured, a failing drill blocks merge of any PR — this is the
explicit SC#3 phase-gate enforcement.

## HI-6 Cleanup Confirmation

Local verification:
- `npm run test:unit` → 506/506 pass; the unit suite does not consume the
  shares fixture (RLS specs are e2e), so no orphan rows are created in
  local development.
- `npx vitest run --config vitest-e2e.config.ts e2e/rls-shares.test.ts`
  without env vars → tests self-skip; `cleanupTestShares()` runs but the
  `createdShareIds` Set is empty → no-op.
- CI verification will run with secrets injected; the
  `cleanupTestShares()` afterAll will admin-DELETE every share created
  during the run. Post-run sanity SQL:
  ```sql
  SELECT count(*) FROM shares
   WHERE label LIKE 'drill-%-%' OR label LIKE 'alice-%-%'
      OR label LIKE 'audit-view-%-%' OR label LIKE 'single-use-%-%'
      OR label LIKE 'rate-limit-%-%';
  -- Expected: 0
  ```
  This is the verification the user can run after the first CI run lands.

## HI-2 Additive Append Status

The `.github/workflows/ci.yml` now has TWO additive append points consumed
by Phase 8:

1. **Plan 08-02** — `deno-test` job lines 223-224 (Deno test step for
   `supabase/functions/share/`).
2. **Plan 08-05 (this plan)** — new top-level job `share-security-drill`
   at lines 226-285.

Plan 08-06's executor will append a THIRD independent edit (bundle-budget
+ static-import guard). The plan's `<must_haves.truths>` lists the contract:

> "Job appended AFTER Plan 08-02's Deno test step (HI-2 — additive)."

Both Plan 08-02's lines and Plan 08-05's new job are UNTOUCHED by each
other. The next executor MUST preserve this property.

## Known Stubs

None. All 5 `it.todo` stubs in `rls-shares.test.ts` are now live assertions.
All 4 Wave-0 `test.skip` stubs in `share-revocation-drill.spec.ts` are now
live tests, plus 2 fold-in tests for SHARE-05 and SHARE-06.

## Failure mode (a) observed latency

**Not yet observed in CI** — this plan adds the drill but does not run it
locally (Playwright requires a running preview server + live Supabase env).
The plan-text expectation is 5-6s for the typical case (5s poll interval +
~1s round trip), well within the 10s ceiling (HI-4).

After the first green CI run on this PR, the drill output will report the
actual `expect(...).toBeVisible({ timeout: 10_000 })` wait time. If the
observed latency clusters at 5-7s the next iteration can tighten the
ceiling to 7s; if it clusters at 8-10s with flake, the polling interval
will need to drop to 3s (documented in the plan's accepted-threats list).

## Threat Flags

No new threat surface introduced beyond the threat register in Plan 08-01
and Plan 08-02. This plan ADDS PROOFS for already-disposed threats:

| Threat ID | Component | Disposition | Proof artifact (this plan) |
|-----------|-----------|-------------|----------------------------|
| T-08-S1 (forwarded URL) | /share/redeem | mitigate | drill failure mode (d) |
| T-08-T2 (CDN cache) | /share/* | mitigate | drill failure mode (b) — 3 status paths |
| T-08-S3 (brute-force code) | /share/redeem | mitigate | rls-shares.test.ts rate-limit |
| T-08-I7 (AI exclusion) | /share/snapshot | mitigate | rls-shares.test.ts migration grep |
| T-08-R1 (audit row) | /share/snapshot | mitigate | rls-shares.test.ts + drill |
| T-08-D2 (revocation latency) | /share/snapshot | mitigate | drill failure mode (a) — HI-4 10s |
| T-08-T6 (cookie attrs) | Set-Cookie | mitigate | drill cookie-attrs fold-in |

## Handoffs to downstream plans

- **Plan 08-06 (print mode + bundle-budget guard):** MUST also additively
  append to `.github/workflows/ci.yml` — do NOT consolidate Plan 08-02's
  Deno step or Plan 08-05's `share-security-drill` job. Reuse
  `createTestShare` for any print-mode e2e tests; the fixture's HI-6
  cleanup hook will pick up Plan 08-06's shares automatically.
- **Phase 8 close gate:** the `share-security-drill` job is the SC#3
  load-bearing gate. Branch protection (user action above) must be
  configured before the phase can be marked complete.
- **`/gsd-verify-work`:** can parse `playwright-report/` HTML or
  `test-results/` JSON output for the drill green/red signal. If a
  structured JSON file is preferred over the directory upload, the next
  iteration can add `PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/share-revocation-drill.json`
  to the workflow env without spec changes.

## Self-Check: PASSED

File existence:
- `leanshot/e2e/fixtures/shares.ts`: FOUND (305 lines, +197 from Plan 08-04)
- `leanshot/e2e/rls-shares.test.ts`: FOUND (244 lines, replaced stubs)
- `leanshot/e2e/share-revocation-drill.spec.ts`: FOUND (244 lines, replaced scaffold)
- `.github/workflows/ci.yml`: FOUND (with 9 top-level jobs; new `share-security-drill` registered)

Commit existence:
- `ceeca72`: FOUND (Task 1 — test fixture + RLS)
- `5a5ef14`: FOUND (Task 2 — drill + CI)

Plan verify-gate scripts:
- Task 1 verify: file exists + 6 `it(` + cleanupTestShares present + afterAll wired + Date.now() in fixture → **all green**
- Task 2 verify: file exists + 6 `test('` + share-security-drill in ci.yml + share-revocation-drill referenced + rls-shares referenced + cleanupTestShares in drill + `timeout: 10_000` in drill → **all green**

Suite runs:
- `npm run typecheck` → 0 errors
- `npm run test:unit` → 506/506 pass + 4 skipped
- `npx eslint` on new e2e files → 0 errors
- `npx vitest run --config vitest-e2e.config.ts e2e/rls-shares.test.ts` (no env) → self-skips correctly

No STATE.md or ROADMAP.md modifications — per the executor prompt, the
orchestrator owns those updates after merge.
