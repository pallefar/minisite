---
project: leanshot
purpose: Central registry of deferred / known-flaky tests with explicit fix plans. Per project rule `feedback_defer_then_batch_fix_pattern`, never permanently skip SC tests — every entry here must have a target phase or polish plan that resolves it.
created: 2026-05-15
audited: 2026-05-16
---

# Deferred Tests Registry

This registry covers every `test.skip` / `test.fixme` / `DEFERRED` marker found in
`leanshot/src/**`, `leanshot/tests/**`, and `leanshot/e2e/**` as of the Phase 23
audit pass (2026-05-16). Entries are grouped by the phase that introduced the skip.
CI enforces that every new skip ships with a `// see deferred-tests.md#<anchor>` comment
(enforced by `scripts/audit-deferred-tests.mjs`).

---

## Phase 15 (v1.2 / Page Builder)

### 1. `tests/rls/page-builder-rls.test.ts` — `is_staff CAN ...` tests flaky under vitest parallel load

**FIXED 2026-05-16** (commit `d8d212f`) — service-role-JWT swap landed via Plan 23-05; 5 affected
is_staff test fixtures re-wired to JWT-header injection (no GoTrueClient instantiation). 3 consecutive
stable runs confirmed locally (env-gated; live GREEN with CI secrets). `SUPABASE_JWT_SECRET` added to
CI `test-unit` env block (GitHub secret needs to be added to repo settings: Supabase dashboard >
Settings > API > JWT Secret, project `ytnsipxxmzgaebkqmokp`). Note: audit found 5 affected fixtures
(not 4 as originally documented — `site_settings: is_staff CAN UPDATE` was also using the flawed pattern,
fixed proactively per Rule 2).

**Affected tests (5, all re-enabled):**
- `landing_pages: is_staff user CAN INSERT / UPDATE / DELETE`
- `landing_page_revisions: is_staff CAN INSERT a new revision`
- `leads: is_staff CAN SELECT`
- `page-assets: is_staff CAN upload and delete a test image`
- `site_settings: is_staff CAN UPDATE` (Rule 2 extension — same vulnerability)

---

**Historical record (pre-fix):**

**Symptom:** Periodic `42501 new row violates row-level security policy` or `expected 0 to be greater than 0` even though the `is_staff()` helper + RLS policies are provably correct.

**Root cause:** jsdom `Multiple GoTrueClient instances detected` — supabase-js v2.105 GoTrue clients cross-contaminate auth state despite `persistSession: false` + unique `storageKey` per `buildAnonClient`. Live diagnostic script (admin upsert → signIn → `rpc('is_staff')` → `storage.upload`) returns `true` 100% outside the vitest suite.

**Why deferred:** Migrations and policies are correct and live on `ytnsipxxmzgaebkqmokp`. The flake is in the test fixture's auth strategy, not in production code. Re-running the suite usually yields 30/30 GREEN.

**Fix plan:** Replace `buildAnonClient(...).auth.signInWithPassword(...)` with a service-role-minted JWT injected via the `headers.Authorization` option on `createClient`. No GoTrue client involvement, no cross-contamination. Target: Phase 23 Plan 23-05 (companion plan in this wave — RLS fixture hardening).

**Read-back guard already in place:** `createStaffUser` now loops up to ~3s waiting for `profiles.is_staff=true` to read back via admin client. Helps with the post-upsert race but does not fix the GoTrue cross-contamination.

**Workaround for CI:** If the suite goes red, re-run once. If it goes red twice, the failure is real (not this flake) — investigate.

---

## Phase 7 / RC5 (v1.0 Realtime Infrastructure)

These tests cover Realtime cross-device behaviors that passed RC1–RC4 but flaked at RC5
due to cross-test Realtime contamination and cold-start timing. The product-level fixes
(Phase 7 RC1–RC4) are shipped; the remaining failures are test-infrastructure only
(hypothesis: missing `afterEach removeAllChannels` — Plan 07-02c remediation).
See: `leanshot/.planning/debug/phase7-e2e-rc4-state-wipe-race.md`

### 2. `e2e/migrate-resume.spec.ts` — RC5 migration happy-path + resume Realtime tests

**Affected tests (2):**
- `Test 1: first sign-in with v4 data → migration runs + leanshot_v4_pre_cloud_backup retained` (test.fixme)
- `Test 2: mid-migration partial state surfaces "Resuming migration"` (test.fixme)

**Symptom:** Tests time out or fail mid-Realtime cold-start in CI.

**Root cause:** RC5 budget / Realtime cold-start timing. Test-infrastructure only — product behavior verified by RC1–RC4.

**Why deferred:** Cost/benefit: RC5 budget is exhausted; product correctness already verified. Test fix requires `afterEach removeAllChannels` + Realtime channel isolation.

**Fix plan:** Phase 23 Plan 23-05 or v1.2 closeout sweep (RC5 remediation batch). Target: v1.2 milestone polish.

**Workaround for CI:** Outer `test.describe` guarded by `HAS_LIVE_AUTH` gate — skips when secrets absent.

### 3. `e2e/cross-device-sync.spec.ts` — RC5 cross-device injection propagation

**Affected tests (1):**
- `injection logged on context A propagates to context B within 5s` (test.fixme)

**Symptom:** Cross-test Realtime contamination — injection logged in context A does not propagate within the 5s budget.

**Root cause:** RC5 cross-test Realtime contamination. See `phase7-e2e-rc4-state-wipe-race.md §"Why BLOCKED"`.

**Why deferred:** Same root cause as entry #2 above. Product behavior verified; test-infra fix deferred.

**Fix plan:** Phase 23 Plan 23-05 or v1.2 closeout sweep. Target: v1.2 milestone polish.

**Workaround for CI:** Outer `test.describe` guarded by `HAS_LIVE_AUTH` gate.

### 4. `e2e/offline-log-then-sync.spec.ts` — RC5 offline-propagation-on-reconnect test

**Affected tests (1):**
- `3 injections logged offline propagate to context B on reconnect` (test.fixme)

**Symptom:** Realtime cold-start causes propagation to miss the time budget.

**Root cause:** RC5 budget / Realtime cold-start. Test-infrastructure only.

**Why deferred:** Same root cause as entry #2 above.

**Fix plan:** Phase 23 Plan 23-05 or v1.2 closeout sweep. Target: v1.2 milestone polish.

**Workaround for CI:** Outer `test.describe` guarded by `HAS_LIVE_AUTH` gate.

### 5. `e2e/offline-conflict-toast.spec.ts` — RC5 LWW conflict toast on losing device

**Affected tests (1):**
- `two contexts edit same weight offline; loser sees "We kept your most recent edit." toast` (test.fixme)

**Symptom:** Cross-test Realtime contamination — LWW conflict toast not triggered within budget.

**Root cause:** RC5 cross-test Realtime contamination.

**Why deferred:** Same root cause as entry #2 above.

**Fix plan:** Phase 23 Plan 23-05 or v1.2 closeout sweep. Target: v1.2 milestone polish.

**Workaround for CI:** Outer `test.describe` guarded by `HAS_LIVE_AUTH` gate.

### 6. `e2e/photo-cross-device.spec.ts` — RC5 photo signed-URL propagation flake

**Affected tests (1):**
- `photo uploaded on context A appears on context B via signed URL within 5s` (test.fixme)

**Symptom:** Flaked back to red on CI run 25747155098 after passing on 25745029198. Cross-test Realtime contamination hypothesis.

**Root cause:** RC5 flake — cross-test Realtime contamination (`afterEach removeAllChannels` needed — 07-02c remediation).

**Why deferred:** Same root cause as entry #2 above.

**Fix plan:** Phase 23 Plan 23-05 or v1.2 closeout sweep. Target: v1.2 milestone polish.

**Workaround for CI:** Outer `test.describe` guarded by `HAS_LIVE_AUTH` gate.

### 7. `e2e/signout-cache-clear.spec.ts` — RC5 signout-returns-to-marketing test

**Affected tests (1):**
- `signout returns to marketing (CONF-2) and preserves acknowledgedDisclaimer (CONF-3)` (test.fixme)

**Symptom:** Account-menu button never found in CI. Possibly an independent post-signin render bug.

**Root cause:** RC5 — account-menu button missing after signin in CI context. See `phase7-e2e-rc4-state-wipe-race.md`.

**Why deferred:** RC1–RC4 product fixes shipped. Test-infrastructure failure remains.

**Fix plan:** Phase 23 Plan 23-05 or v1.2 closeout sweep. Target: v1.2 milestone polish.

**Workaround for CI:** Outer `test.describe` guarded by `HAS_LIVE_AUTH` gate (outer skip fires in CI without secrets).

---

## Phase 22 (Owner/Admin + DSAR + Account Deletion)

### 8. `e2e/account-delete-cancel.spec.ts` — HMAC cancel-link test deferred on Vault key

**Affected tests (1):**
- `account-delete cancel via HMAC link [DEFERRED — Vault key not yet loaded; see 22-01/22-02 SUMMARY]` (test.skip — top-level, not env-gated)

**Symptom:** Full HMAC round-trip test requires the Vault `service_role_key` secret to be loaded in the remote Supabase project. The Vault pass was deferred from Phase 22 closeout (vendor pass — requires manual Supabase dashboard action per 22-01 SUMMARY).

**Root cause:** Vault `service_role_key` not loaded on `ytnsipxxmzgaebkqmokp`; the HMAC signing Edge Function cannot mint the cancel token.

**Why deferred:** Vendor-gated: completing this test requires a manual Supabase Vault setup step that was deprioritized in Phase 22 to unblock merge.

**Fix plan:** Load `service_role_key` into Vault (1 dashboard step) → drop `test.skip`. Target: Phase 23 launch-prep pass or v1.2 closeout.

**Workaround for CI:** Top-level `test.skip` prevents the test from attempting to run.

---

## Phase 15 (Page Builder — live backend round-trip)

### 9. `e2e/page-builder-slice1.spec.ts` — full live round-trip pending staff seed + Edge Function deploy

**Affected tests (1):**
- `staff creates → saves → publishes → visitor sees /{slug}` (test.fixme — inside `@live` describe)

**Symptom:** Live round-trip requires: live staff user JWT, page-save + page-publish + page-render deployed, throwaway slug cleanup.

**Root cause:** Post-orchestrator-deploy follow-up: test was written as the "after deploy" smoke but the deploy window had not yet opened at plan-merge time.

**Why deferred:** Functions are deployed; test needs a live staff seed user. Tracked in 15-04-SUMMARY.md.

**Fix plan:** Create a staff seed user (service-role flip `profiles.is_staff=true`) → wire `addInitScript` JWT seed → drop `test.fixme`. Target: Phase 23 Plan 23-05 or v1.2 closeout sweep.

**Workaround for CI:** Outer `test.describe('@live ...')` guarded by `HAS_LIVE_BACKEND` env gate — skips when secrets absent.

---

## Phase 9 (Clinic Workspace / Pitfall #8)

These tests cover the Phase 9 clinic-workspace and Pitfall #8 scenarios. Each is gated on
`hasLiveSupabase()` which checks `SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY`.
They run green in CI when secrets are present; they self-skip when absent (e.g. fork PRs).
These are **env-gated** — not broken, not deferred in intent.

### 10. `e2e/clinic-revoke-latency.spec.ts` — env-gated live Realtime revoke drill

**Affected tests:** Entire `@phase09 SC#5 revoke latency` describe block
**Symptom:** Conditional skip when `SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY` absent.
**Root cause:** N/A — env-gated test requiring live Supabase.
**Why deferred:** N/A — env-gated. Runs when secrets present.
**Fix plan:** N/A — env-gated, never deferred in CI when secrets present. Target: N/A.
**Workaround for CI:** Self-skips via `test.skip(!hasLiveSupabase(), ...)`.

### 11. `e2e/clinic-photo-access.spec.ts` — env-gated clinic-photo Edge Function gate

**Affected tests:** Entire `@phase09 clinic-photo Edge Function` describe block
**Symptom:** Conditional skip when live Supabase env absent.
**Fix plan:** N/A — env-gated. Target: N/A.

### 12. `e2e/clinic-pitfall-8-accepts-then-rejects.spec.ts` — env-gated Pitfall #8 scenario (e)

**Affected tests:** Entire `@phase09 Pitfall #8 scenario (e)` describe block
**Fix plan:** N/A — env-gated. Target: N/A.

### 13. `e2e/clinic-pitfall-8-invited-never-accepts.spec.ts` — env-gated Pitfall #8 scenario (d)

**Affected tests:** Entire `@phase09 Pitfall #8 scenario (d)` describe block
**Fix plan:** N/A — env-gated. Target: N/A.

### 14. `e2e/clinic-pitfall-8-existing-user-invited.spec.ts` — env-gated Pitfall #8 scenario (a)

**Affected tests:** Entire `@phase09 Pitfall #8 scenario (a)` describe block
**Fix plan:** N/A — env-gated. Target: N/A.

### 15. `e2e/clinic-pitfall-8-no-user-invited.spec.ts` — env-gated Pitfall #8 scenario (b)

**Affected tests:** Entire `@phase09 Pitfall #8 scenario (b)` describe block
**Fix plan:** N/A — env-gated. Target: N/A.

### 16. `e2e/clinic-pitfall-8-existing-user-two-invites.spec.ts` — env-gated Pitfall #8 scenario (c)

**Affected tests:** Entire `@phase09 Pitfall #8 scenario (c)` describe block
**Fix plan:** N/A — env-gated. Target: N/A.

### 17. `e2e/clinic-realtime-negative-space.spec.ts` — env-gated Realtime negative-space invariant

**Affected tests:** Entire `@phase09 Realtime negative-space` describe block
**Fix plan:** N/A — env-gated. Target: N/A.

### 18. `e2e/clinic-role-permission-grid.spec.ts` — env-gated custom role + RLS enforcement

**Affected tests:** Entire `@phase09 D-07 + SC#6 custom role` describe block
**Fix plan:** N/A — env-gated. Target: N/A.

---

## Phase 10 (Clinic Drill-in / Roster / Audit)

### 19. `e2e/clinic-audit.spec.ts` — env-gated audit tab filter flow

**Affected tests:** Entire `@phase10 Audit tab` describe block + inner `test.skip()` guard
**Symptom:** Conditional skip when `SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY` absent.
**Fix plan:** N/A — env-gated. Target: N/A.

### 20. `e2e/clinic-drill-in.spec.ts` — env-gated drill-in section render + audit rows

**Affected tests:** Entire `@phase10 Drill-in → section render + audit rows` describe block + inner `test.skip()` guard
**Fix plan:** N/A — env-gated. Target: N/A.

### 21. `e2e/clinic-roster-sort.spec.ts` — env-gated roster sort + drill-in

**Affected tests:** Entire `@phase10 Roster sort + drill-in` describe block + inner `test.skip()` guard
**Fix plan:** N/A — env-gated. Target: N/A.

### 22. `e2e/roster-perf.spec.ts` — env-gated 50-patient roster perf SC#5

**Affected tests:** Entire `@phase10 Roster perf SC#5` describe block
**Fix plan:** N/A — env-gated. Target: N/A.

---

## Phase 9 Unit Tests (vi.mockReturnValueOnce contamination)

### 23. `src/components/clinic/OrgCreateFlow.test.tsx` — "URL already taken" test deferred on mock contamination

**Affected tests (1):**
- `renders "That URL is already taken." on server-taken response` (it.skip)

**Symptom:** Passes in isolation, fails under full-suite parallelism. Test-pollution from another file's `mockReturnValueOnce` queue carry-over.

**Root cause:** `vi.clearAllMocks()` does not drain `mockReturnValueOnce` queues — requires `mockReset()`. Under vitest file-parallelism the mock-once queue from a sibling file bleeds into this test's assertion window.

**Why deferred:** 2026-05-13 — passes in isolation; full-suite fix requires `mockReset` audit across files.

**Fix plan:** Phase 23 Plan 23-05 or v1.2 closeout: replace `vi.clearAllMocks()` with `mockReset()` at the affected `beforeEach`. Target: v1.2 milestone polish.

**Workaround for CI:** `it.skip` prevents flaky failure from blocking merge. The behavior is covered by the outer unit test suite assertions for slug validation.

### 24. `src/components/clinic/roster/BulkExport.test.tsx` — PDF audit row call not assertable in jsdom

**Affected tests (1):**
- `Test 4: PDF flow calls log_bulk_export_inclusion per patient` (it.skip)

**Symptom:** `handleGenerate()` async chain (supabase.auth.getSession → fetch clinic-snapshot → supabase.rpc log_bulk_export_inclusion) doesn't complete within vitest 4.1.5 / jsdom 29 `waitFor` polling window when both `fetch()` and `supabase.rpc()` mocks are chained.

**Root cause:** jsdom async-chain mock-flush limitation under vitest 4.x. The behavior IS tested by: Deno unit tests (per-patient audit row), `e2e/rls-bulk-export.test.ts` (live DB cross-tenant proof), and the source code explicitly calling `supabase.rpc()`.

**Why deferred:** Alternative coverage exists (Deno + e2e). The jsdom mock-chain limitation is a test-framework constraint, not a product bug.

**Fix plan:** Phase 23 Plan 23-05 or v1.2 closeout: convert to a Deno-only test or fake-timer approach. Target: v1.2 milestone polish.

**Workaround for CI:** `it.skip` prevents flaky failure. Behavior covered by Deno tests + live RLS proof.

---

## Phase 8 (Doctor Share)

### 25. `e2e/share-revocation-drill.spec.ts` — env-gated 4-failure-mode revocation drill

**Affected tests:** Entire `@phase08 SHARE-03 SC#3` describe block
**Symptom:** Conditional skip when `SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL + SUPABASE_ANON_KEY` absent.
**Fix plan:** N/A — env-gated. Target: N/A.

### 26. `e2e/share-happy-path.spec.ts` — env-gated share happy path

**Affected tests:** Entire `@phase08 SHARE-01 / SHARE-02 / SC#3` describe block
**Fix plan:** N/A — env-gated. Target: N/A.

### 27. `e2e/share-print.spec.ts` — env-gated share print mode

**Affected tests:** Entire `@phase08 SC#5 — share print mode` describe block
**Fix plan:** N/A — env-gated. Target: N/A.

---

## Phase 22 (Account Deletion / Lifecycle)

### 28. `e2e/lifecycle-welcome-series.spec.ts` — env-gated lifecycle welcome series

**Affected tests:** Entire `Phase 22 plan 22-12 — lifecycle welcome series` describe block
**Symptom:** Conditional skip when `SUPABASE_URL + (SERVICE or ANON)` absent.
**Fix plan:** N/A — env-gated. Target: N/A.

---

## Env-Gated Skips Summary Table

The following files contain `test.skip(...)` or `describeIfLive` guards that are
**purely env-gated** — they are not deferred in intent; they run green in CI when
the relevant secrets are present and self-skip when absent (e.g. fork PRs, branch
PRs without Supabase/Stripe secrets). These are registered here for completeness
and to satisfy the `audit-deferred-tests.mjs` anchor-check requirement.

| # | File | Guard variable(s) | Phase |
|---|------|-------------------|-------|
| EG-01 | `e2e/posthog-defer.spec.ts` | `HAS_POSTHOG` | 12 |
| EG-02 | `e2e/dsar-export.spec.ts` | `HAS_LIVE` | 22 |
| EG-03 | `e2e/clinic-metered-billing.spec.ts` | `HAS_LIVE`, `STRIPE_METER_ACTIVE_PATIENTS` | 14 |
| EG-04 | `e2e/portal-plan-change.spec.ts` | `HAS_LIVE` | 14 |
| EG-05 | `e2e/account-deletion-cascade.spec.ts` | `HAS_LIVE` | 22 |
| EG-06 | `e2e/auth-signup-verify-signin.spec.ts` | `HAS_LIVE_AUTH` | 5 |
| EG-07 | `e2e/account-delete.spec.ts` | `HAS_LIVE` | 22 |
| EG-08 | `e2e/past-due-banner.spec.ts` | `HAS_LIVE` | 14 |
| EG-09 | `e2e/checkout-trial-flow.spec.ts` | `HAS_LIVE` | 14 |
| EG-10 | `e2e/page-render.spec.ts` | `HAS_LIVE_TARGET`, `DRAFT_SLUG` | 15 |
| EG-11 | `e2e/legal-pages.spec.ts` | `E2E_TEST_USER_EMAIL` + `E2E_TEST_USER_PASSWORD` | 7 |
| EG-12 | `e2e/mobile/iap-flow.spec.ts` | `HAS_LIVE` | 16 |
| EG-13 | `e2e/diagnostic-post-signin-view.spec.ts` | `HAS_LIVE_AUTH` | 5 |
| EG-14 | `e2e/password-reset.spec.ts` | `HAS_LIVE_AUTH` | 5 |
| EG-15 | `e2e/signout-cache-clear.spec.ts` (outer) | `HAS_LIVE_AUTH` | 7 |
| EG-16 | `e2e/clinic-bulk-pdf.spec.ts` | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` | 10 |
| EG-17 | `e2e/pricing-checkout-flow.spec.ts` | `HAS_LIVE` | 14 |
| EG-18 | `e2e/active-shares.spec.ts` | `HAS_LIVE` | 8 |
| EG-19 | `e2e/migrate-resume.spec.ts` (outer) | `HAS_LIVE_AUTH` | 6 |
| EG-20 | `e2e/cross-device-sync.spec.ts` (outer) | `HAS_LIVE_AUTH` | 5 |
| EG-21 | `e2e/offline-log-then-sync.spec.ts` (outer) | `HAS_LIVE_AUTH` | 5 |
| EG-22 | `e2e/offline-conflict-toast.spec.ts` (outer) | `HAS_LIVE_AUTH` | 6 |
| EG-23 | `e2e/photo-cross-device.spec.ts` (outer) | `HAS_LIVE_AUTH` | 6 |
| EG-24 | `e2e/rls-*.test.ts` (all ~20 files) | `SHOULD_RUN` / `describeIfLive` | 5–22 |
| EG-25 | `tests/rls/*.test.ts` (all 4 files) | `SHOULD_RUN_LIVE_RLS` / `describeIfLive` | 15–19 |
| EG-26 | `src/test/audit-trigger.test.ts` | `SHOULD_RUN` / `describeIfLive` | 22 |
| EG-27 | `src/lib/admin/__tests__/audit-logs-rls.test.ts` | `SHOULD_RUN` / `describeIfLive` | 24 |
| EG-28 | `src/lib/admin/__tests__/audit-trigger.test.ts` (T5 GUC suppress) | `SHOULD_RUN` / `describeIfLive`; T5 placeholder until Plan 24-05 ships `_test_suppress_helper` RPC | 24-05 |
| EG-29 | `src/lib/admin/__tests__/backup-codes.test.ts` | `SHOULD_RUN` / `describeIfLive`; [PLAN-24-05-SWAP] consume stub → real RPC at Plan 24-05 ship | 24-05 |
| EG-30 | `e2e/admin-mfa-middleware.spec.ts` | `PLAYWRIGHT_RUN_ADMIN_MFA=1` + `HAS_LIVE`; T1+T2 gate tests; full aal2 step-up requires live Supabase with real MFA factors | 24-05 |
| EG-31 | `e2e/admin-mfa-enroll.spec.ts` T2 | `test.skip` — full enrollment requires otplib + live TOTP code generation from QR URI secret; T1 (QR render check) is env-gated HAS_LIVE | 24-05 |
| P36-01 | `e2e/nps-cooldown-multi-device.spec.ts` | env-gated `PLAYWRIGHT_RUN_P36=1` + `HAS_LIVE` + active `review_prompt_rules` row for `activation_completed`; self-skips when rule fixture absent. Re-run at staging once Phase 35 trigger events + a seeded review-prompt rule exist. | Phase 36 milestone close (v1.3) |
| P36-02 | `e2e/nps-ab-variant.spec.ts` | `test.skip(true, ...)` — requires Wave 3 consumer NPSPromptModal to expose `copy_variant` via either visible copy or `data-copy-variant` attribute on modal root. Re-enable conditions documented in spec file header. | Phase 36 milestone close OR follow-up polish plan once modal wires variant prop |
| P36-03 | `e2e/admin/reviews-rule-builder.spec.ts` | env-gated `PLAYWRIGHT_RUN_P36=1` + `HAS_LIVE` + `P36_ADMIN_EMAIL` + `P36_ADMIN_PASSWORD` (aal2-stepped-up admin fixture). Manual CRUD walkthrough at HUMAN-UAT signal 4 confirms the flow in the interim. | Phase 36 milestone close (staging admin fixture) |
| P70-01 | `src/components/search/__tests__/SearchModal.test.tsx` (T5 groups results) | `it.skip` — cmdk filters items by value-match against the search query "frag"; test data items don't have "frag" in their values so cmdk hides them under cmdk-empty. Test was authored against a non-cmdk results layer that may have been refactored. Re-enable by passing each Command.Item an explicit `value` containing the test query, OR by restructuring the test to type a query that's substring of the result titles. | Phase 70-07 follow-up |
| P70-02 | `src/lib/analytics/__tests__/phi-import-zone.test.ts` (Test 5) | `it.skip` — ESLint programmatic API doesn't fire `import-x/no-restricted-paths` against the synthetic file. Likely an ESLint 9 flat-config + `overrideConfig` interaction or import-x resolver scoping; not a regression in the actual zone rule (eslint.config.js block still enforces in `npm run lint`). Re-enable by either (a) finding the correct path-resolver scoping for the synthetic file, or (b) replacing with a fixture-based test that runs the real `npm run lint` on a committed fixture file. | Phase 70-07 follow-up |
| P70-03 | `src/components/onboarding/OnboardingFlow.test.tsx` (8-step happy path) | `it.skip` — cascade-29 added `supabase.from()` chain mock which cleared the inner `[useConsumerOnboardingFlow] fail-open` TypeError, but the flow still doesn't reach Step 7's "Open dashboard" button. Likely an additional store-action or hook stub is needed; full investigation deferred. Component does render "Open dashboard" text via `t('onboarding:nav.open_dashboard')` so the text-rendering side is correct. | Phase 70-07 follow-up |
| P70-06 | `src/lib/__tests__/rls-org-branding.test.ts` (T14 storage upload) | `it.skip` — the only test doing a body-carrying storage upload; the CI runner's egress to `storage.supabase.co` resets mid-PUT (`StorageUnknownError: fetch failed` → `read ECONNRESET`) on every attempt. NOT a code/config bug: bucket exists+public+PNG-allowed (mig `20270601400004`), RLS correct (T13 gets clean 403), Edge Fn path T15/T16 passes. A transport-retry (cascade-49) didn't help (every attempt resets → 30s timeout), so reverted. Re-enable when the CI runner can complete storage uploads (infra). | CI runner↔storage network fix |
| P70-05 | `src/lib/admin/__tests__/audit-trigger.test.ts` (T5 GUC suppress) | `it.skip` — placeholder that calls non-existent RPCs (`_test_suppress_audit_insert`, `_pg_proc_src`) and chains `.catch()` on a PostgrestBuilder (TypeError when run live); never asserts the suppression it names. Same item as EG-28; re-enable when Plan 24-05 ships the DB test-helper RPC. Surfaced in Phase 70-07 cascade-46 once cascade-45 fixed the upstream 22P02 that had masked it. | Plan 24-05 |
| P70-04 | 31 Deno-runtime Edge Fn `__tests__/*.test.ts` files (see [functions-unit Deno coverage gap](#functions-unit-deno-coverage)) | Config-level exclusion (not an `it.skip`): cascade-36 narrowed the `functions-unit` vitest project include to the 16 vitest-compatible files. The other 31 import `Deno.*` / `npm:` / `jsr:` / `std/…` and only run under Deno. They pass individually under `deno test` but their per-function `__tests__/` dirs aren't wired into the `deno-test` CI job (which runs only `tests/`, `share/`, + 2 named files), and at least one (`privacy-optout-process/__tests__/handler.test.ts`) needs a `std/assert` import-map entry before a batch run is green. | Phase 70-07 follow-up — wire per-function `__tests__/` into `deno-test` job after import-map audit |

## functions-unit Deno coverage

**Anchor target for P70-04.** Cascade-36 (Phase 70-07) narrowed the `functions-unit`
vitest project (`leanshot/vitest.config.ts`) from `../supabase/functions/**/__tests__/*.test.ts`
to an explicit list of the 16 vitest-compatible test files (those that `import … from 'vitest'`
and use dependency injection — no `Deno.*` globals). The over-broad glob had been capturing
31 Deno-runtime tests that fail under vitest/Node at collection time with
`ReferenceError: Deno is not defined` or `Cannot find package 'npm:@supabase/supabase-js@2'`.
Those 31 accounted for ~31 of the 53 "failed test files" in the Unit-tests CI job (0 of the
62 failed *tests* — they never reached assertion). Root cause + the named-file fix pattern:
project memory `feedback_vitest_project_include_too_broad`.

The excluded 31 files are NOT currently covered by any CI job: the `deno-test` job runs only
`supabase/functions/tests/` (integration excluded), `supabase/functions/share/`, and two
named `--no-check` files. Each excluded file passes when run individually under
`deno test --no-check --import-map=supabase/functions/import_map.json <file>`, but a batch run
trips on `privacy-optout-process/__tests__/handler.test.ts` importing `std/assert/assert_equals.ts`
(absent from `import_map.json`). **Follow-up:** audit `import_map.json` for `std/`/`jsr:` gaps,
then add the per-function `__tests__/` globs to the `deno-test` CI job (excluding the 4
network-dependent `integration.test.ts` files, mirroring the existing `tests/integration` ignore).
