---
phase: 33-hourly-ad-spend-etl-meta-google-tiktok
plan: "05"
subsystem: admin-ui
tags: [admin, cac-dashboard, rls, ad-etl, growth]
dependency_graph:
  requires: [33-01, 33-03, 33-04]
  provides: [admin-growth-cac-module, rls-denial-tests-ad-etl]
  affects: [admin-shell, modules-manifest]
tech_stack:
  added: []
  patterns:
    - ADMIN_MODULES manifest extension (modules.ts)
    - Supabase RPC via supabase.rpc() for SECDEF-gated calls
    - admin.generateLink + /auth/v1/verify RLS test pattern (ES256-compat)
    - File-scoped TEST_SLUG_PREFIX for vitest parallelism safety
key_files:
  created:
    - leanshot/src/components/admin/growth/CACDashboardPage.tsx
    - leanshot/src/components/admin/growth/CACDashboardPage.test.tsx
    - leanshot/e2e/rls-ad-etl-tables.test.ts
  modified:
    - leanshot/src/lib/admin/modules.ts
decisions:
  - "RLS test placed at e2e/rls-ad-etl-tables.test.ts (matches vitest-e2e.config.ts e2e/rls-*.test.ts glob) not leanshot/tests/rls/ as written in plan (that path has no runner config)"
  - "Unit tests for CACDashboardPage are skipped (it.skip) — no jsdom vitest config exists; tracked as deferred"
  - "Backfill routes via supabase.rpc('trigger_ad_etl_backfill') SECDEF RPC (T-33-05-02 mitigation — browser cannot directly invoke service-role-gated Edge Fn)"
  - "Build from main node_modules passes tsc --noEmit cleanly; idb dep missing from worktree node_modules is a pre-existing worktree setup issue"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-18T19:22:30Z"
  tasks_completed: 2
  tasks_total: 3
  files_created: 3
  files_modified: 1
---

# Phase 33 Plan 05: CAC Dashboard Admin Module + RLS Denial Tests Summary

**One-liner:** CACDashboardPage wired to get_cac_summary() RPC + ad_etl_health + ad_etl_gaps + trigger_ad_etl_backfill SECDEF; 7-table RLS denial proof via admin.generateLink pattern.

## What Was Built

### Task 1: ADMIN_MODULES entry + CACDashboardPage (commit `cabf7f2`)

**modules.ts:** Added `growth-cac` entry with `TrendingUpIcon`, `route: 'growth/cac'`, `flagKey: 'admin.growth.cac.enabled'`, `minRole: 'admin'`. Lazy-loads `CACDashboardPage` via named export.

**CACDashboardPage.tsx:** Full admin module at `/admin/growth/cac`:

- **Health section:** Three `HealthCard` components (Meta/Google/TikTok) reading from `ad_etl_health`. Each shows: green "Active" / red "Credentials missing" badge, "Last sync: X hours ago" relative time, last_error if present.
- **Gaps section:** Active gaps bar — lists unresolved gaps with network name, missing_rows count, gap_date. Backfill button calls `supabase.rpc('trigger_ad_etl_backfill', { p_network, p_date })` — SECDEF RPC (T-33-05-02 threat mitigation). Handles 403 → "Permission denied" toast; other errors → generic error toast. Refetches gaps on success.
- **CAC cards section:** 7d rolling aggregation grouped by network. Clickable cards (Card variant="clickable") show total spend + attributed conversions + CAC. Loading: Skeleton wrapper divs; Empty: EmptyState component inline.
- **Drill-down Sheet:** Campaign breakdown (grouped by campaign_id) → creative top-5/bottom-5 by CAC. State machine: `drawerState: 'closed' | 'campaign' | 'creative'`. Back button navigates campaign → creative.
- **CSV export:** `buildCsvDataUrl()` serializes cacRows to Blob URL with proper CSV escaping (double-quotes for commas/newlines). Downloads as `cac-export-{date}.csv`.

**Zero new UI primitives:** Card, CardHeader, Badge, Button, Sheet, Skeleton, EmptyState all reused from `src/components/ui/`.

### Task 2: Cross-tenant RLS denial tests (commit `77eaf69`)

**e2e/rls-ad-etl-tables.test.ts:** 8 vitest integration tests:
- Tests 1–7 (one per table): `non-admin cannot read from {table}` — creates plain authenticated user (no admin_role), asserts 0 rows on SELECT.
- Test 8: `service-role admin client can read ad_etl_health` — positive case confirming admin access works.
- Pattern: `admin.generateLink` + `/auth/v1/verify` via plain fetch (ES256-compat, avoids GoTrueClient cross-contamination).
- File-scoped `TEST_SLUG_PREFIX = 'adtest-' + randomUUID().slice(0,8) + '-'` prevents parallel test pollution.
- Self-skipping when `SUPABASE_SERVICE_ROLE_KEY` absent (fork/CI-safe).
- Automatically picked up by `vitest-e2e.config.ts` include glob `e2e/rls-*.test.ts`.

### Task 3: Human verification checkpoint (pending — awaiting user)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Integration] RLS test path moved to e2e/rls-*.test.ts**
- **Found during:** Task 2
- **Issue:** Plan specified `leanshot/tests/rls/ad-etl-tables.test.ts` but this path is not covered by any vitest include config. The vitest-e2e.config.ts `include` array covers `e2e/rls-*.test.ts`.
- **Fix:** Placed file at `leanshot/e2e/rls-ad-etl-tables.test.ts` — matches existing `e2e/rls-*.test.ts` glob, auto-picked up by test runner.
- **Files modified:** `leanshot/e2e/rls-ad-etl-tables.test.ts` (created at correct path)
- **Commit:** `77eaf69`

**2. [Rule 2 - Missing Infrastructure] Unit test file uses it.skip due to missing jsdom config**
- **Found during:** Task 1
- **Issue:** CLAUDE.md confirms "No vitest.config.ts, jest.config.ts, playwright.config.ts, or *.test.* files exist in the repo" (for the leanshot SPA). CACDashboardPage.test.tsx cannot run without jsdom + @testing-library/react setup.
- **Fix:** Wrote test file with `it.skip('... [DEFERRED — see deferred-tests.md]', ...)` per `reference_vitest_skip_fixme.md`.
- **Commit:** `cabf7f2`

## Known Stubs

None — all data reads are wired to live Supabase tables via RPC + direct table reads. The component will render "Credentials missing" badges and "No spend data" EmptyState when data is absent, which is correct behavior (not a stub).

## Threat Flags

No new security-relevant surface beyond what the plan's threat_model covers. All reads are RLS-gated (admin-only). Backfill routes through SECDEF RPC (not direct Edge Fn invoke from browser).

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `leanshot/src/lib/admin/modules.ts` exists | FOUND |
| `leanshot/src/components/admin/growth/CACDashboardPage.tsx` exists | FOUND |
| `leanshot/src/components/admin/growth/CACDashboardPage.test.tsx` exists | FOUND |
| `leanshot/e2e/rls-ad-etl-tables.test.ts` exists | FOUND |
| `33-05-SUMMARY.md` exists | FOUND |
| Commit `cabf7f2` (Task 1) exists | FOUND |
| Commit `77eaf69` (Task 2) exists | FOUND |
| `grep growth/cac modules.ts` → 1 match | PASSED |
| `tsc --noEmit` (via main node_modules) | PASSED — 0 errors |
