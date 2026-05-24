---
phase: 39-a-b-trifecta-mid-trial-paywall-pharma-paywall-page-variant-a
plan: 08
subsystem: admin/growth
tags: [admin, pharma, experiments, secdef-rpc, playwright]
dependency_graph:
  requires:
    - 39-01 (variant_config, pharma_content, pharma_content_versions tables)
    - 39-03 (kill-scan + admin_audit_log precedent)
    - 39-06 (ExperimentDashboardPage shell + Pill tab union)
    - 39-07 (PaywallExperimentTab sibling pattern + admin_audit_log table)
  provides:
    - PharmaExperimentTab (Surface G admin UI)
    - PharmaVersionList (PHARMA-07 audit history widget)
    - PharmaVariantMetricsCard (PHARMA-08 composite metrics card)
    - get_pharma_experiments SECDEF RPC
    - pharma_content_version_write SECDEF RPC
    - disable_pharma_variant SECDEF RPC
  affects:
    - ExperimentDashboardPage.tsx (pharma branch replaced; new loadPharma path)
tech_stack:
  added:
    - none (reuses Card, Sheet, ConfirmModal, Badge, Sparkline primitives)
  patterns:
    - Sibling tab mirror (PaywallExperimentTab → PharmaExperimentTab)
    - SECDEF read RPC with admin gate + composite return type
    - Vault decrypted_secrets + pg_net pattern (verbatim from 20270714000015)
    - SELECT FOR UPDATE idempotency probe on disable
    - data-action="disable-variant" attribute for e2e locator
key_files:
  created:
    - leanshot/src/components/admin/growth/PharmaExperimentTab.tsx
    - leanshot/src/components/admin/growth/PharmaExperimentTab.test.tsx
    - leanshot/src/components/admin/growth/PharmaVersionList.tsx
    - leanshot/src/components/admin/growth/PharmaVersionList.test.tsx
    - leanshot/src/components/admin/growth/PharmaVariantMetricsCard.tsx
    - leanshot/src/components/admin/growth/PharmaVariantMetricsCard.test.tsx
    - leanshot/e2e/admin/pharma-variant-disable.spec.ts
    - leanshot/e2e/admin/pharma-admin-tab.spec.ts
    - supabase/migrations/20270714000018_p39_get_pharma_experiments_rpc.sql
    - supabase/migrations/20270714000019_p39_pharma_content_version_write_rpc.sql
    - supabase/migrations/20270714000020_p39_disable_pharma_variant_rpc.sql
  modified:
    - leanshot/src/components/admin/growth/ExperimentDashboardPage.tsx
    - leanshot/src/components/admin/growth/ExperimentDashboardPage.test.tsx
decisions:
  - "Pharma surface uses a dedicated get_pharma_experiments RPC (NOT shared get_experiment_results) — different return shape (adds nps_delta + one_star_rate_ratio + safety_categories_in_variant) and different policy gate (no Bayesian/Ship-Winner)."
  - "safety_categories_in_variant hardcoded to '{}'::text[] in the SELECT list (T-39-08-01 invariant); RPC pre-checks pharma_content rows linked via config->>'pharma_content_id' and raises + slack-alerts if any safety_category leaks."
  - "disable_pharma_variant is idempotent via SELECT FOR UPDATE + branch on archived_at IS NOT NULL (returns NULL no-op). Prevents double-write of audit row + double-fire of Slack on concurrent clicks."
  - "PharmaExperimentTab uses ConfirmModal primitive (not ShipWinnerConfirmModal) — UI-SPEC Hard Constraint 8: pharma disable is a kill, not a promotion; no typed-confirmation flow needed (the row already gates traffic until accept)."
  - "review_submissions table NOT shipped in this plan despite 39-03's TODO. The RPC defensively probes via to_regclass and returns null one_star_rate_ratio when absent. Documented as deferred — a future phase owns the table + backfill (see Deferred Issues)."
metrics:
  duration: 30m
  completed: 2026-05-24
requirements: [PHARMA-03, PHARMA-04, PHARMA-07, PHARMA-08]
---

# Phase 39 Plan 08: Pharma Sub-Tab of ExperimentDashboardPage Summary

Wave 5 admin slice B — implemented the Pharma sub-tab (Surface G) on the ExperimentDashboardPage shell, shipped the 1-click variant-disable flow (PHARMA-04), shipped the audit-log + version-history widgets (PHARMA-07), shipped the composite NPS+1★ metrics card (PHARMA-08), and shipped the 3 SECDEF RPCs that back the read + version-write + disable surfaces.

## What Was Built

### UI components (4 widgets, 32 vitest assertions)

| Component | Path | Tests | Notes |
|-----------|------|-------|-------|
| `PharmaExperimentTab` | `leanshot/src/components/admin/growth/PharmaExperimentTab.tsx` | 7 | Sibling of PaywallExperimentTab; one Card per row; data-action="disable-variant" button gated via ConfirmModal; data-action="open-version-history" opens Sheet drawer with PharmaVersionList; archived rows muted with 'Disabled' badge + no Disable button; clinical-signoff badge (warning/success/none) derived from latest version. |
| `PharmaVersionList` | `leanshot/src/components/admin/growth/PharmaVersionList.tsx` | 6 | UI-SPEC lines 199-203: "Pharma content versions" header, "Author" + "Clinical review" columns; "Pending sign-off" warning badge or "Reviewed by {clinician}" success badge; descending sort by created_at; placeholder when empty. |
| `PharmaVariantMetricsCard` | `leanshot/src/components/admin/growth/PharmaVariantMetricsCard.tsx` | 6 | UI-SPEC line 204 composite copy verbatim ("Conversion uplift: {N}% · NPS Δ: {N} · 1★ rate: {ratio}× baseline"); danger tone when one_star_rate_ratio > 2 (D-03 threshold); optional Sparkline when trend_series.length > 0. |
| `ExperimentDashboardPage` (modified) | `leanshot/src/components/admin/growth/ExperimentDashboardPage.tsx` | 13 (was 13) | New `loadPharma` callback calls `get_pharma_experiments()` RPC; new `handleDisablePharma` calls `disable_pharma_variant` RPC; pharma branch replaced with `<PharmaExperimentTab>`; paywall + page branches unchanged. T9 + T12 updated to reflect dedicated pharma RPC contract. |

### SECDEF RPCs (3 migrations, slots 18/19/20)

| RPC | Migration | Role gate | Purpose |
|-----|-----------|-----------|---------|
| `get_pharma_experiments()` | `20270714000018_p39_get_pharma_experiments_rpc.sql` | `is_admin_at_least('admin')` | Returns `setof` pharma row with nps_delta + one_star_rate_ratio + composite `variant_id…safety_categories_in_variant`. **T-39-08-01 invariant**: hardcoded `'{}'::text[]` for safety_categories_in_variant; pre-check raises + slack-alerts if any active pharma variant links pharma_content with safety_category set. |
| `pharma_content_version_write(p_content_id uuid, p_diff jsonb, p_clinical_signoff_by uuid default null)` | `20270714000019_p39_pharma_content_version_write_rpc.sql` | `is_admin_at_least('admin')` | ONLY write path for pharma_content_versions (table has no INSERT/UPDATE/DELETE RLS). Sets author_id=auth.uid(); auto-sets clinical_signoff_at when p_clinical_signoff_by supplied. Returns new row id. |
| `disable_pharma_variant(p_variant_id uuid, p_reason text)` | `20270714000020_p39_disable_pharma_variant_rpc.sql` | `is_admin_at_least('admin')` | 1-click reversibility (PHARMA-04). SELECT FOR UPDATE idempotency: returns NULL no-op when already archived. Sets `variant_config.archived_at`, appends `admin_audit_log` row with action='pharma_disable', best-effort Slack alert via vault decrypted_secrets pattern (verbatim from 20270714000015). |

All 3 RPCs use `security definer set search_path = extensions, public, pg_temp` per `reference_supabase_migration_gotchas`.

### Playwright e2e (2 specs)

- `leanshot/e2e/admin/pharma-variant-disable.spec.ts` — PHARMA-04 interaction-surface assertions (Pharma tab pill reachable + data-tab attribute flips). Live round-trip fixme'd pending Phase 39 close-out db push.
- `leanshot/e2e/admin/pharma-admin-tab.spec.ts` — PHARMA-08 tab pill reachable. Live 2-variant round-trip (active + archived rows) fixme'd pending close-out.

Both follow the page-variant-create.spec.ts split pattern: built-app assertions run in CI; live assertions gate on `SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY`.

## Safety-Category Invariant Proof (T-39-08-01)

The `safety_categories_in_variant` column is hardcoded in the RPC body:

```sql
'{}'::text[] as safety_categories_in_variant
```

A defense-in-depth pre-check counts `pharma_content` rows where `safety_category IS NOT NULL` AND linked from an active pharma variant via `variant_config.config->>'pharma_content_id'`. If non-zero, the RPC raises `safety_category_in_pharma_variant` + best-effort Slack alert (4th defense layer above the Plan 39-02 ESLint rule + runtime PaywallGate check + CI grep gate).

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| PharmaVariantMetricsCard.test.tsx | 6 | passed |
| PharmaVersionList.test.tsx | 6 | passed |
| PharmaExperimentTab.test.tsx | 7 | passed |
| ExperimentDashboardPage.test.tsx | 13 | passed (T9 + T12 updated for new RPC contract) |
| **Plan 39-08 total** | **32** | **passed** |
| Sibling admin/growth regression sweep | 69 (4 skipped) | passed (no regressions) |

tsc clean against `tsconfig.app.json --noEmit` after all edits.

## Project Test-Runner Note (out-of-scope observation)

The project's `leanshot/vitest.config.ts` declares only the `phase38-eval` project; src/ unit tests (including pre-existing PaywallExperimentTab.test.tsx + CACDashboardPage.test.tsx + this plan's 4 new suites) are NOT picked up by `npx vitest run path/...`. A shim config (`.vitest-39-08.config.mts` with default `{ plugins: [react()], aliases, setupFiles }`) was used for local TDD verification but NOT committed — this is a pre-existing project-wide issue that affects every src/ test file in the repo, not a Plan 39-08 regression. Recommendation for a future infrastructure phase: convert vitest.config.ts to a root `test:` block + add `phase38-eval` as a sibling project entry so default + project suites coexist.

## Deviations from Plan

### None to PLAN.md task structure

The 12 declared `files_modified` plus the 5 supporting test suites + verified migration slots all shipped per spec. The 2 tasks completed in the declared order (widgets + RPCs first; tab wiring + e2e second).

### [Rule 2 — Forward-defense] `safety_category_in_pharma_variant` pre-check

The plan's interface block specified only that `safety_categories_in_variant` MUST be empty in the SELECT. The RPC adds a defense-in-depth pre-COUNT + raise + Slack alert (4th layer above the existing 3 documented in 39-02). This is forward-defense per Rule 2 — the invariant is a regulator-visible safety guarantee per CONTEXT D-05 and an additional cheap server-side gate is correctness-required, not feature-creep.

### [Rule 3 — Project shim] vitest config workaround

Discovered the pre-existing vitest config does not pick up `src/**/*.test.tsx` from CLI invocations. Used a non-committed local shim (`.vitest-39-08.config.mts`) for TDD verification. Removed before each commit. Documented as a deferred deferred-items entry above. No source changes ship to mitigate this — it's a project-wide pre-existing issue.

## Deferred Issues

1. **`public.review_submissions` table** — 39-03 SUMMARY noted that Plan 39-08 "will ship `public.review_submissions` to activate the gated 1-rating kill branch". The plan's `files_modified` does NOT list a `review_submissions` migration, and the RPC + kill-scan both defensively probe via `to_regclass` (returning null one_star_rate_ratio when absent). The pre-existing kill-scan continues to skip the 1★ branch until the table lands. **Recommended owner:** a downstream review-system phase (likely M5+) or a phase-close-out plan. The pgTAP coverage suggested in 39-03 SUMMARY (refresh `p39_pharma_nps_kill.sql` to exercise the 1★ branch) should ship in the same plan.

2. **Playwright live round-trip activation** — Both e2e specs have `test.fixme()` guards on the live round-trip assertions. Activation requires Phase 39 close-out:
   - `supabase db push --linked` of the 3 new SECDEF migrations
   - Live admin role seeded (`profiles.admin_role='admin'` on a Playwright fixture user)
   - For pharma-admin-tab.spec.ts: 2 seeded `variant_config` rows (1 active, 1 archived)

3. **vitest projects config drift** — Pre-existing project-wide issue: `vitest.config.ts` declares only `phase38-eval` as a project; src/ unit tests are skipped from default `vitest run`. Affects ALL src/ tests in repo, not Plan 39-08 only. Logged for a future infra phase.

## Threat Model Mitigations Applied

| Threat ID | Mitigation site |
|-----------|----------------|
| T-39-08-01 (safety_category leaks to variant) | `get_pharma_experiments` pre-COUNT + raise + Slack alert; hardcoded `'{}'::text[]` SELECT literal |
| T-39-08-02 (pharma_content_versions edited retroactively) | `pharma_content_version_write` SECDEF is INSERT-only; table RLS has no UPDATE/DELETE (Plan 39-05 pgTAP proves) |
| T-39-08-03 (admin disables wrong variant from race) | ConfirmModal primitive + busyKey guard + SELECT FOR UPDATE in RPC |
| T-39-08-04 (variant disabled without audit) | `disable_pharma_variant` inserts admin_audit_log row + posts Slack BEFORE returning |
| T-39-08-05 (non-admin calls write RPC) | `is_admin_at_least('admin')` at top of all 3 RPC bodies |
| T-39-08-06 (PharmaVersionList exposes clinical_signoff_by user_id) | Resolved to `clinical_signoff_name` display string only (RPC join future-owned by version-fetch phase; UI props pin the display-string-only shape) |
| T-39-08-07 (Slack flap blocks disable) | net.http_post wrapped in EXCEPTION block; raise notice on failure; variant still archived |

## Self-Check: PASSED

- `git log --oneline -3` confirms commits `67db3dbb` (Task 1) + `f2f6f355` (Task 2) on `worktree-agent-a13d898abe3f2506d`
- All 12 declared files_modified entries exist (verified via `ls`)
- 32 vitest assertions across 4 plan suites pass
- tsc `--noEmit` against `tsconfig.app.json` is clean
- 3 SECDEF migrations include `security definer set search_path = extensions, public, pg_temp` per migration_gotchas
- vault `decrypted_secrets` pattern present in disable_pharma_variant body
- safety_categories_in_variant invariant present in get_pharma_experiments body (both pre-COUNT guard and SELECT literal)
