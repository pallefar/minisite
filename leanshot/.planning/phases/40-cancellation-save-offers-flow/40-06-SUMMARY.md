---
phase: 40
plan: 06
title: "Admin ROI Dashboard + CSV export + PostHog Ship-Winner + phase close-out"
status: complete
disposition: approved — automated-verify-only
uat_deferred_to: .planning/v1.3-uat-deferred.md (Signals A-D — coupons/admin-rule/cancel-flow/copy)
completed: 2026-05-21T18:25:00Z
duration_minutes: 21
tasks_completed: 3
tasks_total: 3
subsystem: cancellation-roi-deploy
tags:
  - cancellation
  - roi-dashboard
  - csv-export
  - edge-functions
  - checkpoint
  - deploy

dependency_graph:
  requires:
    - 40-01 (cancellation_offers_log schema + RLS)
    - 40-02 (stripe-webhook pause mirror + cron jobs)
    - 40-03 (cancellation-decide-offer + cancellation-accept-offer Edge Fns)
    - 40-04 (CancellationModal frontend chunk)
    - 40-05 (admin module + save-offer-rules CRUD + CancellationRoiTab stub)
  provides:
    - v_cancellation_offers_roi VIEW (Phase 40 ROI data surface)
    - CancellationRoiTab, CancellationRoiKpiTiles, CancellationRoiChart, CancellationCohortTable components
    - download-cancellation-roi-csv Edge Fn (admin-gated CSV export)
    - posthog-variants.ts (Ship-Winner scaffold; v1.3 cold-start null)
    - All 6 Phase 40 Edge Fns deployed to live project
    - 8 Phase 40 migrations applied to live project
  affects:
    - admin cancellation module (ROI tab content)
    - v_cancellation_offers_roi VIEW (DB schema)

tech_stack:
  added:
    - v_cancellation_offers_roi (plain SQL VIEW over cancellation_offers_log)
    - download-cancellation-roi-csv Edge Fn (Deno, JWT + admin role gate)
  patterns:
    - BaseChart wrapper (P33 admin-CAC chart pattern)
    - Custom HTML legend below chart (P33 lesson — chart.js inline legend color-token issues)
    - pgTAP aggregation test with session_replication_role = replica seed
    - admin role check via profiles.admin_role (admin-grant-freeze-token pattern)
    - import.meta.main guard for Deno.serve (prevents test import collision)

key_files:
  created:
    - supabase/migrations/20270709000008_p40_roi_view.sql
    - supabase/tests/p40_roi_view_test.sql
    - supabase/functions/download-cancellation-roi-csv/index.ts
    - supabase/functions/download-cancellation-roi-csv/index.test.ts
    - supabase/functions/download-cancellation-roi-csv/deno.json
    - leanshot/src/components/admin/cancellation/CancellationRoiKpiTiles.tsx
    - leanshot/src/components/admin/cancellation/CancellationRoiChart.tsx
    - leanshot/src/components/admin/cancellation/CancellationCohortTable.tsx
    - leanshot/src/lib/cancellation/posthog-variants.ts
    - leanshot/.planning/phases/40-cancellation-save-offers-flow/40-DEPLOY-NOTES.md
    - leanshot/.planning/phases/40-cancellation-save-offers-flow/deferred-items.md
  modified:
    - leanshot/src/components/admin/cancellation/CancellationRoiTab.tsx (overwrote 40-05 stub)

decisions:
  - ROI view uses plain SQL VIEW (NOT matview) per RESEARCH §ROI Analytics Architecture; matview migration threshold documented inline (p95 > 500ms OR row count > 10,000)
  - View excludes org_id IS NOT NULL rows (clinic-org) per RESEARCH Open Q3; clinic CSM cancellations counted separately in v1.3
  - posthog-variants.ts returns null for v1.3 cold-start per F-40-02 and RESEARCH Open Q5; v1.4 MUST resolve variant server-side (T-40-06-06 spoofing mitigation)
  - download-cancellation-roi-csv uses JWT + profiles.admin_role server-side check (NOT service-role bearer) per T-40-06-02; same pattern as admin-grant-freeze-token
  - Signal D (notification copy) pre-assessed as copy-ok — no urgency markers in pause-reminder-t7.ts or pause-resumed-t0.ts
  - Bundle overage (admin-shell 132.69 kB > 130 kB ceiling) confirmed pre-existing from 40-05 or earlier; NOT caused by 40-06 components; documented in deferred-items.md

metrics:
  duration_minutes: 21
  completed: "2026-05-21T18:25:00Z"
  tasks_completed: 3
  files_created: 12
  files_modified: 1
  migrations_applied: 1
  edge_fns_deployed: 7
  pgtap_assertions: 8
  deno_test_assertions: 5
---

# Phase 40 Plan 06: Admin ROI Dashboard + CSV export + PostHog Ship-Winner + phase close-out — Summary

**One-liner:** ROI VIEW + 4 dashboard components + admin-gated CSV export Fn + PostHog Ship-Winner scaffold + all Phase 40 Edge Fns deployed; phase paused at human-verify checkpoint pending operator Stripe seed + browser walkthrough.

---

## Tasks Completed

### Task 1: ROI view migration + pgTAP aggregation test

**Commit:** d946ad8

`v_cancellation_offers_roi` plain SQL VIEW created over `cancellation_offers_log`:
- Groups by (offered_day, offer_type, cohort_id, tenure_bucket, posthog_variant_id)
- Computes shown_count / accepted_count / declined_count / deferred_mrr_cents_est
- Excludes clinic-org rows (`org_id IS NOT NULL`) per RESEARCH Open Q3
- View inherits base-table RLS (admin-only SELECT) per PATTERNS §11; no SECDEF wrapper needed
- Inline COMMENT documents matview migration threshold

pgTAP test (`p40_roi_view_test.sql`) verifies 8 assertions:
- View exists
- Clinic-org rows excluded
- shown_count correct (status='offered' filter)
- accepted_count correct
- declined_count correct
- deferred_mrr_cents_est = 324.75 for accepted discount at 25% (25 × 12.99)
- Downgrade accepted rows produce 0 deferred_mrr (only pause/discount/extended_trial contribute)
- Total 6 distinct groups (10 seeded rows + 1 clinic-org row)

Migration pushed to linked DB (ytnsipxxmzgaebkqmokp) as migration 20270709000008.

### Task 2: ROI dashboard tab components + CSV export Fn + PostHog variant attribution

**Commit:** db6d0a0

**CancellationRoiTab.tsx** (overwrites 40-05 stub):
- Filter bar: date range PillGroup (7d/30d/90d/all) + offer type PillGroup (multi-select)
- Hero KPI row via CancellationRoiKpiTiles
- Stacked bar chart via CancellationRoiChart
- Cohort breakdown table via CancellationCohortTable
- Export CSV button → fetch download-cancellation-roi-csv Edge Fn with admin JWT
- Empty state per UI-SPEC line 333-335 (BarChart3 icon)

**CancellationRoiKpiTiles.tsx:**
- 4 KPI tiles: Offers shown / Acceptance rate / Revenue recovered / Avg retention extension
- Delta vs prior period via `<Badge tone="success/danger">`
- useRoiData hook queries v_cancellation_offers_roi with date-range + offer-type filters
- Fraunces display font per UI-SPEC line 64 ROI hero exception

**CancellationRoiChart.tsx:**
- Stacked bar chart via BaseChart wrapper (P33 pattern)
- 3 series: accepted (--color-primary) / declined (--color-text-tertiary) / shown_no_response (--color-border)
- Custom HTML legend below chart (P33 lesson — chart.js inline legend color-token issues)
- Theme-aware via key={theme} remount pattern

**CancellationCohortTable.tsx:**
- Rows = cohort_id; columns = Pause / Discount / Extended trial / Downgrade / Best offer
- Acceptance rate bold when ≥ 30% (--color-success)
- "Best offer" column: Badge tone=info with offer icon
- Sticky first column on mobile horizontal scroll

**posthog-variants.ts:**
- `getActiveCancellationVariant()` → null (v1.3 cold-start)
- Documented v1.4 activation path (server-side flag fetch required per T-40-06-06)
- `getCancellationVariantId()` convenience wrapper

**download-cancellation-roi-csv Edge Fn:**
- GET endpoint; JWT bearer + server-side admin role check (`profiles.admin_role`)
- Queries v_cancellation_offers_roi with range_from/range_to/cohorts/offers query params
- Streams CSV: header + data rows; Content-Type: text/csv; charset=utf-8; Content-Disposition attachment
- `import.meta.main` guard prevents Deno.serve collision in tests
- 5 Deno tests: 401/405/204/OPTIONS/CSV structure all green

TypeScript: 0 errors. ESLint: 0 errors, 1 warning (react-refresh/only-export-components for useRoiData co-located with component — warning only, not error).

**ROI view reference count:** `grep -c "v_cancellation_offers_roi" CancellationRoiKpiTiles.tsx` = 3 ✓

### Task 3: Phase 40 close-out — db push + Edge Fn deploys + bundle audit + DEPLOY-NOTES

**Commit:** 1db3c21

**db push verification:**
- `npx supabase db push --linked` → "Remote database is up to date" (0 migrations pending)
- All 8 Phase 40 migrations applied

**Verification queries passed:**
- `cancellation_offers_log` count = 0 (fresh table)
- `save_offer_rules` count = 0 (admin creates at UAT)
- status CHECK constraint: 6 values (offered/accepted/declined/expired/ineligible_lifetime_cap/ineligible_cooldown)
- 2 cron jobs active: p40-pause-t7-reminder (0 * * * *) + p40-pause-autoresume-reconcile (15 */4 * * *)

**Edge Fns deployed (2026-05-21):**
| Function | Script size | Status |
|----------|-------------|--------|
| cancellation-seed-coupons | 876.9 kB | DEPLOYED |
| pause-reminder-fire | 1.731 MB | DEPLOYED |
| cancellation-decide-offer | 3.582 MB | DEPLOYED |
| cancellation-accept-offer | 3.581 MB | DEPLOYED |
| cancellation-feedback-to-ticket | 692.3 kB | DEPLOYED |
| download-cancellation-roi-csv | 842.4 kB | DEPLOYED |
| stripe-webhook (extended) | 4.455 MB | DEPLOYED |

**Bundle audit:**
- `npm run build`: SUCCESS
- admin-shell: 132.69 kB gz (OVER 130 kB ceiling — pre-existing from 40-05, not caused by 40-06)
- cancellation chunk: MISSING (pre-existing from 40-04 — lazy chunk not generating separate file)
- All other chunks: OK
- Both issues documented in deferred-items.md

**Notification copy review (Signal D — pre-assessed):** copy-ok
- pause-reminder-t7.ts: "Just a heads-up" — no urgency, no FOMO, factual
- pause-resumed-t0.ts: "Great news — billing resumed today" — warm, not coercive
- No "URGENT", "LAST CHANCE", "DON'T LOSE", shame language, or countdown timers found

**40-DEPLOY-NOTES.md:** Operator runbook with verification table, Stripe seed curl, browser walkthrough signals A-D.

---

## Deviations from Plan

### Auto-fixed Issues

**None** — plan executed without deviations in the implementation logic.

### Pre-existing Issues Documented (not caused by Plan 40-06)

**1. [Pre-existing] admin-shell bundle 2.69 kB over grandfathered ceiling**
- **Found during:** Task 3 bundle audit
- **Issue:** admin-shell chunk at 132.69 kB gz before AND after 40-06 changes (verified via git)
- **Action:** Documented in deferred-items.md; NOT fixed (pre-existing, scope boundary applies)
- **Owner:** Phase 24 admin-shell ceiling-track

**2. [Pre-existing] cancellation chunk MISSING from bundle output**
- **Found during:** Task 3 bundle audit
- **Issue:** Plan 40-04 expected a separate 'cancellation' chunk (13 kB gz ceiling) but it's not generating
- **Action:** Documented in deferred-items.md; NOT fixed (pre-existing from 40-04)
- **Remediation hint:** Add manualChunks rule in vite.config.ts for the cancellation modal path

---

## ROI View Performance

`EXPLAIN ANALYZE` on v_cancellation_offers_roi not run (0 rows in table post-deploy; meaningful p95 measurements require 30 days of real data). Matview migration threshold: p95 > 500ms OR row count > 10,000 — documented inline in view COMMENT and in 40-DEPLOY-NOTES.md §Post-Ship Audit Cadence.

---

## Edge Fn Deploy Timestamps

All 7 Edge Fns deployed on 2026-05-21T18:00-18:25Z. Verify in Supabase Dashboard:
https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp/functions

---

## PostHog Ship-Winner Wiring Status

**v1.3 cold-start:** `getActiveCancellationVariant()` returns null. All `cancellation_offers_log.posthog_variant_id` rows will be null. ROI dashboard grouping by variant_id is a no-op (shows all data as a single cohort).

**Ready for v1.4 activation:**
1. Create PostHog experiment `cancellation_save_flow_variant`.
2. Replace null-return in posthog-variants.ts with server-side PostHog flag fetch.
3. Pass variant_id in DecideOfferRequest → cancellation-decide-offer stores it on the log row.
4. ROI dashboard automatically groups by variant_id once data accumulates.

**Security note (T-40-06-06):** v1.4 MUST resolve variant server-side (NOT from client `posthog.getFeatureFlag()`). Client-provided variant_id would allow users to self-select variants, poisoning the experiment.

---

## Stripe Dashboard Coupon Presence

**Status:** PENDING operator action (Signal A).

Curl command documented in 40-DEPLOY-NOTES.md §3. Expected: 6 coupons (SAVE-{20,25,30}-{2,3}MO). Cannot be invoked autonomously (Stripe write operation).

---

## HUMAN-UAT Signal Received

**Status:** PENDING — 4 signals surfaced to orchestrator (see checkpoint section in this SUMMARY).

---

## Known Stubs

None. The posthog-variants.ts null return is documented as intentional v1.3 cold-start per F-40-02, not a UI stub that would prevent the plan's goal from being achieved.

---

## Threat Flags

No new security-relevant surface beyond what the plan's threat model documented (view RLS + CSV admin gate + service-role coupon seed). No new network endpoints, auth paths, or schema changes at trust boundaries beyond plan scope.

---

## Self-Check: PASSED

| Item | Status |
|------|--------|
| supabase/migrations/20270709000008_p40_roi_view.sql | EXISTS |
| supabase/tests/p40_roi_view_test.sql | EXISTS |
| supabase/functions/download-cancellation-roi-csv/index.ts | EXISTS |
| leanshot/src/components/admin/cancellation/CancellationRoiTab.tsx | EXISTS (overwritten stub) |
| leanshot/src/components/admin/cancellation/CancellationRoiKpiTiles.tsx | EXISTS |
| leanshot/src/components/admin/cancellation/CancellationRoiChart.tsx | EXISTS |
| leanshot/src/components/admin/cancellation/CancellationCohortTable.tsx | EXISTS |
| leanshot/src/lib/cancellation/posthog-variants.ts | EXISTS |
| leanshot/.planning/phases/40-cancellation-save-offers-flow/40-DEPLOY-NOTES.md | EXISTS |
| Commit d946ad8 | EXISTS |
| Commit db6d0a0 | EXISTS |
| Commit 1db3c21 | EXISTS |
| pgTAP test: 8 assertions PASS | VERIFIED |
| Deno test: 5 assertions PASS | VERIFIED |
| TypeScript: 0 errors | VERIFIED |
| DB push: no-op ("Remote database is up to date") | VERIFIED |
| 6 Edge Fns + stripe-webhook deployed | VERIFIED |
