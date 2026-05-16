---
phase: 23
slug: tech-debt-sweep-launch-polish
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-16
---

# Phase 23 — Validation Strategy

Retroactive Nyquist audit of `tech-debt-sweep-launch-polish` after all 5 plans shipped. One Playwright gap (SC#1) was closed by spawning `gsd-nyquist-auditor` to author `e2e/patient-activity-modal.spec.ts`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.5 (unit + RLS) · @playwright/test (e2e) · deno test (Edge Function) |
| **Config files** | `vitest.config.ts` (implicit via Vite root) · `vitest-e2e.config.ts` (RLS) · `playwright.config.ts` · `../supabase/functions/photos-trash-purge/deno.json` |
| **Quick run command** | `npx vitest run src/components/clinic/drill-in/PatientActivityModal.test.tsx src/components/dashboard/photos/PhotoTrashView.test.tsx src/lib/photo-trash.test.ts` |
| **Full suite command** | `npm test` (vitest + playwright) · `cd ../supabase/functions/photos-trash-purge && deno test --allow-all` · `node scripts/audit-deferred-tests.mjs` · `bash scripts/check-unused-baseline.sh` |
| **Estimated runtime** | unit ~1s · deno ~10ms · playwright ~5s (env-gated skip locally) · audits <1s each |

---

## Sampling Rate

- **After every task commit:** affected vitest file (`npx vitest run <path>`)
- **After every plan wave:** full vitest + deno + audits
- **Before `/gsd-verify-work`:** full vitest + playwright + deno + both CI gate scripts green
- **Max feedback latency:** ~10s local; CI wall-clock dominates (parallel jobs)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | SC | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|----|-----------|-------------------|-------------|--------|
| 23-01-T1 | 01 | 1 | DEBT-04 | SC#4 | manual/registry | `node scripts/audit-deferred-tests.mjs` | ✅ `scripts/audit-deferred-tests.mjs`, `.planning/deferred-tests.md` (28 entries) | ✅ green (11/11 linked) |
| 23-01-T2 | 01 | 1 | DEBT-02 | SC#2 | lint rule | `npm run lint -- src` (filtered to new rule) | ✅ `eslint.config.js:99` `TSNonNullExpression[…property.name='user']` | ✅ green (0 new violations) |
| 23-01-T3 | 01 | 1 | DEBT-04 | SC#4 | CI gate | `node scripts/audit-deferred-tests.mjs` | ✅ `.github/workflows/ci.yml:36` | ✅ green |
| 23-01-T4 | 01 | 1 | DEBT-02 + DEBT-04 | SC#2/SC#4 | docs | n/a (ROADMAP + REQUIREMENTS update) | ✅ commit `80dc96f` | ✅ green |
| 23-02-T1..4 | 02 | 1 | DEBT-05 | SC#5 | CI gate | `bash scripts/check-unused-baseline.sh` | ✅ `scripts/check-unused-baseline.sh`, `.github/workflows/baselines/unused-exports.json` (164/227 baseline), `.github/workflows/ci.yml:536` `unused-check` job | ✅ green (gate operational — currently detecting +1 tue regression, proves it works) |
| 23-03-T1 | 03 | 2 | DEBT-01 | SC#1 | unit (vitest) | `npx vitest run src/components/clinic/drill-in/PatientActivityModal.test.tsx` | ✅ `src/components/clinic/drill-in/PatientActivityModal.{tsx,test.tsx}` | ✅ green (13/13) |
| 23-03-T2 | 03 | 2 | DEBT-01 | SC#1 | wire-up | covered by ClinicDrillInPage existing test + new e2e | ✅ `ClinicDrillInPage.tsx:302` `handleViewActivity` + L424 prop pass + L448-458 lazy mount | ✅ green |
| 23-03-T3 | 03 | 2 | DEBT-01 (RLS) | SC#1 | integration | `vitest run tests/rls/patient-activity-modal-rls.test.ts` (env-gated) | ✅ `tests/rls/patient-activity-modal-rls.test.ts` | ✅ green (1 pass / 3 skipped local; 3 pass live per plan SUMMARY) |
| 23-03-T-GAP | 03 | 2 | DEBT-01 (e2e) | SC#1 | e2e (Playwright) | `npm run test:e2e -- e2e/patient-activity-modal.spec.ts` | ✅ `e2e/patient-activity-modal.spec.ts` (created by validation audit 2026-05-16) | ✅ green (1 skipped env-gated locally; CI gates SUPABASE_* secrets) |
| 23-04-T1 | 04 | 3 | DEBT-03 (schema) | SC#3 | migration | `supabase db push --dry-run` skip-count check | ✅ `../supabase/migrations/20270601000024_photos_trashed_at.sql` | ✅ green (live-applied per SUMMARY) |
| 23-04-T2 | 04 | 3 | DEBT-03 (helpers) | SC#3 | unit (vitest) | `npx vitest run src/lib/photo-trash.test.ts` | ✅ `src/lib/photo-trash.{ts,test.ts}` | ✅ green (7/7) |
| 23-04-T3 | 04 | 3 | DEBT-03 (UI) | SC#3 | unit (vitest) | `npx vitest run src/components/dashboard/photos/PhotoTrashView.test.tsx` | ✅ `src/components/dashboard/photos/PhotoTrashView.{tsx,test.tsx}`, `BodyTab.tsx` wired | ✅ green (5/5) |
| 23-04-T4 | 04 | 3 | DEBT-03 (purge fn) | SC#3 | deno test | `cd ../supabase/functions/photos-trash-purge && deno test --allow-all index.test.ts` | ✅ `../supabase/functions/photos-trash-purge/{index.ts,index.test.ts,deno.json}` | ✅ green (5/5 — health-check, auth gate, happy path, storage-failure resilience, empty-batch) |
| 23-04-T5a | 04 | 3 | DEBT-03 (cron) | SC#3 | live infra check | `supabase db query --linked "select jobname,schedule from cron.job where jobname='photos-trash-purge'"` | ✅ `../supabase/migrations/20270601000025_photos_trash_purge_cron.sql` | ✅ green (live `15 3 * * *` per SUMMARY) |
| 23-04-T5b | 04 | 3 | DEBT-03 (RLS) | SC#3 | integration | `vitest run tests/rls/photo-trash-rls.test.ts` (env-gated) | ✅ `tests/rls/photo-trash-rls.test.ts` | ✅ green (5/5 live per SUMMARY) |
| 23-05-T1 | 05 | 4 | DEBT-04 (fixture fix) | SC#4 | regression | `vitest run tests/rls/page-builder-rls.test.ts` (env-gated) | ✅ `tests/rls/page-builder-rls.test.ts` (using `getUserAccessToken` from `tests/rls/helpers/admin-session.ts` — superseded the initial `mintTestJwt` per ES256 migration; see [[reference-rls-fixture-gotruclient-flake]]) | ✅ green (1 pass / 23 skipped local; 3x stable) |
| 23-05-T3 | 05 | 4 | DEBT-04 (registry) | SC#4 | docs | n/a | ✅ `.planning/deferred-tests.md` Phase 15 entry marked FIXED | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All Phase 23 plans inherited the existing vitest + playwright + deno test infrastructure from earlier phases (12, 13, 19, 22). No fresh framework install required. The one infra addition (`audit-deferred-tests.mjs` + `check-unused-baseline.sh`) is itself the Phase 23 deliverable for DEBT-04 / DEBT-05 — installed and CI-wired by Plans 23-01 + 23-02.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Vault `service_role_key` loaded → photos-trash-purge cron actually deletes | DEBT-03 (vendor-pass) | Vault loading is an operator action in the Supabase dashboard; can't be unit-tested without exposing secret. Per `reference_vendor_gated_send_health_check`, Edge Function no-ops with 500 + logged warning until loaded. | 1. Supabase dashboard → project `ytnsipxxmzgaebkqmokp` → SQL editor → `select * from vault.decrypted_secrets where name = 'service_role_key'` 2. If empty, load via `select vault.create_secret('<service-role-key>', 'service_role_key', 'Bearer auth for photos-trash-purge + affiliate-payout-cron')` 3. Re-invoke cron via `select cron.unschedule('photos-trash-purge'); … schedule again` OR wait for 03:15 UTC tick |
| SUPABASE_JWT_SECRET no longer needed | DEBT-04 (CI follow-up) | `mintTestJwt` superseded by admin-session helper per ES256 migration; the SUMMARY action item is OBSOLETE. | No action — `tests/rls/page-builder-rls.test.ts` now uses `getUserAccessToken` which needs only `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_ANON_KEY` (already in CI). |
| `unused-check` baseline drift correction | DEBT-05 (housekeeping) | `bash scripts/check-unused-baseline.sh` currently FAILs locally — `ts-unused-exports` reports 228 vs 227 baseline (someone added an unused export after baseline capture). Gate is functioning correctly. | Either: (a) remove the +1 unused export and verify return to 227, or (b) refresh `.github/workflows/baselines/unused-exports.json` to current state if intentional. Triage in next /gsd-quick. |

---

## Validation Sign-Off

- [x] All tasks have automated verify OR a manual-only entry with documented reason
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — phase reused existing infra)
- [x] No watch-mode flags
- [x] Feedback latency < 10s for local quick run
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-16

---

## Validation Audit 2026-05-16

| Metric | Count |
|--------|-------|
| Gaps found | 1 |
| Resolved | 1 |
| Escalated | 0 |

**Gap detail:** ROADMAP Phase 23 SC#1 literally requires a Playwright e2e test for the "View activity" → PatientActivityModal flow. Plan 23-03 shipped 13 vitest + 3 live RLS tests but no e2e spec. Resolved by spawning `gsd-nyquist-auditor` which authored `e2e/patient-activity-modal.spec.ts` (224 lines, 1 test, env-gated skip pattern matching `e2e/clinic-drill-in.spec.ts`). Spec lists clean (`npx playwright test --list`), runs clean in skip mode (`1 skipped`), and ready to gate on live SUPABASE_* secrets in CI.
