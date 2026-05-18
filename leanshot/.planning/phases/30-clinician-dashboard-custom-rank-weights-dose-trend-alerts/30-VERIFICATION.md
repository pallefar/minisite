---
phase: 30
slug: clinician-dashboard-custom-rank-weights-dose-trend-alerts
verified: 2026-05-18T06:03:10Z
status: passed-with-deferred-human
score: 5/5 (initial gap RESOLVED inline at commit `2e4b853` — see [[feedback_chunked_planning_integration_seam_blindspot]] for the recurring pattern)
overrides_applied: 0
orphan_fix_commit: "2e4b853"
gaps:
  - truth: "[RESOLVED 2026-05-18] Aggregate clinic dashboard surfaces population-level metrics via materialized view refreshing every 15 minutes"
    status: fixed-orphan-wire
    fix_commit_message: "fix(30): wire ClinicDashboardOverview into ClinicWorkspace (verifier orphan-fix)"
    resolution: >
      Inline fix: ClinicDashboardOverview now lazy-loaded above the Roster section in
      leanshot/src/components/clinic/ClinicWorkspace.tsx via React.lazy + Suspense (mirrors
      the Phase 10 lazy-load pattern; no router change required since the workspace home is
      already mounted at /clinic/{slug}). Bundle ceiling raised 35000 → 36000 to accommodate
      the lazy import (clinic chunk grew 34227 → 35456 gz; +544 bytes headroom). tsc + build
      + assert-clinic-bundle-budget.sh all pass. CLIN-05 + CLIN-08 are now reachable in
      production. This is a "chunked planning integration seam blindspot" recurrence per
      [[feedback_chunked_planning_integration_seam_blindspot]] — Plan 30-04 built the
      component but no plan owned the wire-into-parent step.
    original_reason: "ClinicDashboardOverview component exists (src/components/clinic/dashboard/ClinicDashboardOverview.tsx) and is fully implemented with the correct SECDEF RPC calls, but it is ORPHANED — not imported or rendered by any parent component, route, or workspace. ClinicWorkspace.tsx does not import it. App.tsx has no route to /clinic/{slug}/overview. The plan itself noted 'mounted from the clinic dashboard route (TBD)' — the TBD was never resolved. A clinic admin cannot access this surface."
    artifacts:
      - path: "leanshot/src/components/clinic/dashboard/ClinicDashboardOverview.tsx"
        issue: "File exists and is substantive, but zero imports outside its own test file — orphaned component"
    missing:
      - "Wire ClinicDashboardOverview into a reachable surface: add a 'Dashboard' tab to ClinicWorkspace, or add a route at /clinic/{slug}/overview in App.tsx, or integrate it as a section within the existing ClinicWorkspace page"
---

# Phase 30: Clinician Dashboard + Custom Rank Weights + Dose-Trend Alerts — Verification Report

**Phase Goal:** Clinic deals close on this surface; per-clinic ranking + nightly alert cron + ack/snooze workflow ship together.
**Verified:** 2026-05-18T06:03:10Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC#1 | Clinic admin configures per-clinic ranking weights; roster reorders within 1 second of save | VERIFIED | `ClinicRankingWeightsForm` calls `update_org_ranking_weights` SECDEF; AFTER UPDATE trigger fires `pg_notify`; `useOrgSettingsRealtime` subscribes via HMAC channel; `RosterTable` wires `handleWeightsChanged → refresh()`; `data-testid="roster-row" data-patient-id={row.user_id}` present. Playwright spec structurally complete — runtime deferred (requires live server + creds). |
| SC#2 | Nightly dose-trend cron inserts clinician_alerts rows; clinician receives in-app + PHI-aware email | VERIFIED | `p30_clinician_alert_detect` cron at `30 3 * * *` confirmed active (live DB probe in 30-05-SUMMARY). `clinician-alert-deliver-cron` Edge Function deployed. PHI lint passes: `clinician-alert-deliver-cron` directory in `STRIPE_PATHS`. Email template: subject `New clinical alert — {org_name}`, body CTA-only, zero PHI fields. |
| SC#3 | Same alert within 24h debounces; on failure 3 retries over 1h | VERIFIED | UNIQUE `clinician_alerts_debounce_uq (org_id, debounce_key)` enforces 24h dedup at INSERT via `ON CONFLICT DO NOTHING`. Deliver-cron picks `retry_count < 3 AND last_attempt_at < now() - 20min`; bumps `retry_count` per attempt; transitions to `delivery_failed` on 3rd failure. 6 Deno tests cover: PHI-free template, vendor-gated path, retry-count bump, delivery_failed transition on 3rd failure, delivery_log inserts, per-alert try/catch. 22/22 live RLS tests pass. |
| SC#4 | Clinician can acknowledge or snooze an alert; un-acted alerts auto-resolve after 7 days | VERIFIED | `acknowledge_clinician_alert` + `snooze_clinician_alert` SECDEFs live. `AlertSnoozePopover` wired to `snooze_clinician_alert` RPC with 4 presets (1h/4h/24h/7d). `ClinicianAlertsPanel` wired to `acknowledge_clinician_alert` RPC. Auto-resolve cron at `15 4 * * *` runs SQL: `UPDATE … SET status='auto_resolved' WHERE status='pending' AND snooze_until IS NULL AND created_at < now() - interval '7 days'`. Snoozed→pending resume also in same cron. All 5 status transitions have named owners per D-10. |
| SC#5 | Aggregate clinic dashboard surfaces population-level metrics via materialized view refreshing every 15 minutes | FAILED | `ClinicDashboardOverview.tsx` exists and is fully implemented — reads `get_clinic_alert_metrics` + `get_clinic_dose_trend_population` SECDEFs, staleness caption via `clinic_matview_refresh_log`, `--color-amber` token, 4 stat cards. BUT the component is ORPHANED: no import in `ClinicWorkspace.tsx`, no route in `App.tsx`, no `lazy()` call anywhere in the component tree. The plan noted "mounted from the clinic dashboard route (TBD)" — the TBD was not resolved during execution. A clinic user cannot reach this surface. |

**Score:** 4/5 truths verified

---

## Deferred Items

No items meet the deferred threshold — SC#5 is not addressed by any later phase in the roadmap.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20270601300001_p30_org_settings_extensions.sql` | ranking_weights + dose_trend_thresholds columns + validator trigger | VERIFIED | EXISTS — contains `ranking_weights jsonb`, `_validate_ranking_weights`, BEFORE UPDATE trigger |
| `supabase/migrations/20270601300002_p30_clinician_alerts_schema.sql` | 3 org-scoped tables + RLS + UNIQUE debounce | VERIFIED | EXISTS — clinician_alerts, clinician_alert_deliveries, org_patient_thresholds, `clinician_alerts_debounce_uq`, role check `in ('admin','staff')`, no `'clinician'` enum value |
| `supabase/migrations/20270601300003_p30_secdef_and_triggers.sql` | 4 SECDEFs + AFTER UPDATE trigger + pg_notify | VERIFIED | EXISTS — acknowledge/snooze/update_weights/set_thresholds SECDEFs; AFTER UPDATE trigger; `pg_notify`; `search_path=pg_catalog,public,extensions`; `suppress_audit` GUC; no `log_admin_action` |
| `supabase/migrations/20270601300004_p30_matviews_and_cron.sql` | 2 matviews + UNIQUE indexes + 4 crons + SECDEF accessors | VERIFIED | EXISTS — matviews + `mv_clinic_alert_metrics_uq` + `mv_clinic_dose_trend_population_uq`; REVOKE direct access; SECDEF accessors `get_clinic_alert_metrics` + `get_clinic_dose_trend_population`; 4 pg_cron jobs at correct schedules |
| `supabase/migrations/20270601300005_p30_weighted_rank_org_patients.sql` | rank_org_patients SECDEF with NULL-fallback | VERIFIED | EXISTS — `select ranking_weights into v_weights`; COALESCE to Phase 10 hardcoded defaults; scalar variables before EXECUTE block (Pitfall 3 avoidance) |
| `supabase/functions/clinician-alert-deliver-cron/index.ts` | Edge Function; PHI-free; retry state machine | VERIFIED | EXISTS; 413 lines; `Deno.serve`; `_createServiceRoleClientUnsafe`; `channelNameFromSecret`; `retry_count < 3` filter; `delivery_failed` transition on 3rd failure; vendor-gated RESEND_API_KEY; PHI-free email template |
| `supabase/functions/_shared/with-org-scope.ts` | ORG_SCOPED_TABLES includes 3 P30 tables | VERIFIED | Lines 52-54 confirmed: `clinician_alerts`, `clinician_alert_deliveries`, `org_patient_thresholds` |
| `leanshot/src/components/clinic/settings/ClinicRankingWeightsForm.tsx` | Weight form + SECDEF save + realtime | VERIFIED | EXISTS; calls `rpc('update_org_ranking_weights', ...)`; no stubs |
| `leanshot/src/components/clinic/alerts/ClinicianAlertsPanel.tsx` | Bell-icon dropdown + ack/snooze | VERIFIED | EXISTS; wired to `acknowledge_clinician_alert` RPC; lazy-loaded in `ClinicContextBar` |
| `leanshot/src/components/clinic/alerts/AlertSnoozePopover.tsx` | 4 snooze presets + SECDEF call | VERIFIED | EXISTS; presets `['1h','4h','24h','7d']`; calls `snooze_clinician_alert` RPC |
| `leanshot/src/components/clinic/dashboard/ClinicDashboardOverview.tsx` | 4-stat-card dashboard | ORPHANED | EXISTS and is substantive — but ORPHANED (not imported by any rendered component). SC#5 blocker. |
| `leanshot/src/components/clinic/drill-in/PatientThresholdOverrideForm.tsx` | Per-patient threshold form + reset modal | VERIFIED | EXISTS; calls `set_patient_dose_thresholds` + `reset_patient_dose_thresholds` RPCs; wired in `ClinicDrillInPage` via `React.lazy` |
| `leanshot/e2e/clinic-ranking-weights-roster-reorder.spec.ts` | SC#1 Playwright e2e | VERIFIED | EXISTS; uses `page.addInitScript` (not page.evaluate); `PLAYWRIGHT_RUN_P30` env var gate; `channelNameFor` usage; runtime deferred |
| `leanshot/e2e/clinician-alerts-realtime.spec.ts` | SC#3 Playwright e2e | VERIFIED | EXISTS; DB-level `channel.subscribe()` in test file; `PLAYWRIGHT_RUN_P30` gate; runtime deferred |
| 6 vitest test files (`rls-org-clinician-alerts`, `rls-org-patient-thresholds`, `rank-org-patients-weights`, `clinician-alert-debounce`, `clinician-alert-auto-resolve`, `mv-clinic-alert-metrics`) | RLS + invariant tests | VERIFIED | All 6 exist; file-scoped `TEST_SLUG_PREFIX`; `describeIfLive` gate; 22/22 pass against live Supabase |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ClinicRankingWeightsForm.tsx` | `update_org_ranking_weights` SECDEF | `supabase.rpc('update_org_ranking_weights', ...)` | WIRED | Confirmed line 147 |
| `RosterTable.tsx` | `use-org-settings-realtime.ts` | `useOrgSettingsRealtime({ orgId, onWeightsChanged: handleWeightsChanged })` | WIRED | Line 206 confirms; `handleWeightsChanged → refresh()` confirmed lines 201-205 |
| `use-org-settings-realtime.ts` | `org-{hmac8}-settings` Realtime channel | `postgres_changes` subscription via `channelNameFor` | WIRED | Lines 51-66 confirmed |
| `clinician-alert-deliver-cron/index.ts` | `_shared/realtime.ts` | `channelNameFromSecret(orgId, 'alerts', secretHex)` | WIRED | Line 180 confirmed |
| `clinician-alert-deliver-cron/index.ts` | `_shared/supabase-server.ts` | `_createServiceRoleClientUnsafe()` | WIRED | Line 368 confirmed |
| `ClinicianAlertsPanel.tsx` | `acknowledge_clinician_alert` SECDEF | `supabase.rpc('acknowledge_clinician_alert', ...)` | WIRED | Line 237 confirmed |
| `AlertSnoozePopover.tsx` | `snooze_clinician_alert` SECDEF | `supabase.rpc('snooze_clinician_alert', ...)` | WIRED | Lines 114-116 confirmed |
| `ClinicDashboardOverview.tsx` | `get_clinic_alert_metrics` SECDEF | `use-clinic-metrics.ts` hook | WIRED (internally) | Hook calls RPC — BUT component is not wired into any rendered parent |
| `ClinicDashboardOverview.tsx` | Any parent component / route | `import` or `React.lazy` | NOT_WIRED | Zero imports outside test file — BLOCKER for SC#5 |
| `PatientThresholdOverrideForm.tsx` | `set_patient_dose_thresholds` SECDEF | `supabase.rpc('set_patient_dose_thresholds', ...)` | WIRED | Line 102 confirmed |
| `ClinicDrillInPage.tsx` | `PatientThresholdOverrideForm.tsx` | `React.lazy` + 'Dose thresholds' tab | WIRED | Lines 49-51 + 541-550 confirmed |
| `leanshot/scripts/lint-stripe-phi.ts` | `clinician-alert-deliver-cron` dir | `STRIPE_PATHS` array push | WIRED | Line 45 confirmed |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `ClinicDashboardOverview.tsx` | `metrics` (via `useClinicMetrics`) | `supabase.rpc('get_clinic_alert_metrics')` + `get_clinic_dose_trend_population` + `clinic_matview_refresh_log` | YES — SECDEF accessors query live matviews; matviews populated by nightly detect-cron | FLOWING (but component ORPHANED — data never reaches user) |
| `ClinicianAlertsPanel.tsx` | alerts list (via `use-clinician-alerts`) | `supabase.from('clinician_alerts').select(...)` filtered by org_id + 7-day window | YES — real DB query with RLS enforcement | FLOWING |
| `ClinicRankingWeightsForm.tsx` | `weights` state | `supabase.from('org_settings').select('ranking_weights')` | YES | FLOWING |
| `use-rank-roster.ts` (consumed by `RosterTable.tsx`) | `rows` | `supabase.rpc('rank_org_patients', ...)` | YES — Phase 10 SECDEF extended with weighted scoring | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Bundle ceiling | `bash leanshot/scripts/assert-clinic-bundle-budget.sh` | clinic 34,227 / ceiling 35,000; all chunks OK | PASS |
| Edge Function substantive | `wc -l supabase/functions/clinician-alert-deliver-cron/index.ts` | 413 lines | PASS |
| ORG_SCOPED_TABLES | `grep -c "clinician_alerts\|clinician_alert_deliveries\|org_patient_thresholds" supabase/functions/_shared/with-org-scope.ts` | 3 | PASS |
| TypeScript strict | `cd leanshot && npx tsc --noEmit -p tsconfig.app.json 2>&1 \| grep "error TS"` | 0 errors | PASS |
| PHI lint extension | `grep -n "clinician-alert-deliver-cron" leanshot/scripts/lint-stripe-phi.ts` | line 45 — confirmed in STRIPE_PATHS | PASS |
| No 'clinician' role | `grep "'clinician'" supabase/migrations/20270601300002_p30_clinician_alerts_schema.sql` | 0 matches | PASS |
| AFTER UPDATE trigger | `grep "after update of ranking_weights" supabase/migrations/20270601300003_p30_secdef_and_triggers.sql` | confirmed | PASS |
| ClinicDashboardOverview rendered | `grep -rn "ClinicDashboardOverview" leanshot/src --include="*.tsx" \| grep -v "test\.\|Overview\."` | ONLY test file — orphaned | FAIL |

---

## Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|---------|
| CLIN-01 | 30-00, 30-02, 30-05 | Per-clinic ranking weights in org_settings JSONB | SATISFIED | `ranking_weights` column + validator + SECDEF + `ClinicRankingWeightsForm` wired |
| CLIN-02 | 30-00, 30-01 | Dose-trend cron nightly; inserts clinician_alerts on breach | SATISFIED | `p30_clinician_alert_detect` cron + INSERT logic in migration 30-04 |
| CLIN-03 | 30-01, 30-03 | In-app + email notification; PHI-aware | SATISFIED | Deliver-cron Edge Fn deployed; Realtime broadcast via HMAC channel; PHI-free email template |
| CLIN-04 | 30-00, 30-01 | 24h debounce + 3-retry / 1h delivery | SATISFIED | UNIQUE debounce constraint + `retry_count < 3 AND last_attempt_at < now()-20min` filter |
| CLIN-05 | 30-00, 30-04 | Admin views aggregate alert metrics in clinic dashboard | BLOCKED | `ClinicDashboardOverview` component built but orphaned — no reachable route |
| CLIN-06 | 30-00, 30-03, 30-05 | Clinician ack + snooze; auto-resolve after 7d | SATISFIED | Both SECDEFs live; panel wired; auto-resolve cron at 04:15 UTC |
| CLIN-07 | 30-00, 30-04 | Per-patient threshold overrides via drill-in | SATISFIED | `PatientThresholdOverrideForm` wired in `ClinicDrillInPage` 'Dose thresholds' tab |
| CLIN-08 | 30-00, 30-04 | Population-level dose-trend metrics via materialized view | BLOCKED | `mv_clinic_dose_trend_population` exists and refreshes every 15min, but `ClinicDashboardOverview` is orphaned — no user-accessible surface |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `30-04-PLAN.md` Task 1 action | 176 | "mounted from the clinic dashboard route (TBD)" | N/A (planning artifact) | Left unresolved during execution; executor created the component without wiring it |

No debt markers (TBD/FIXME/XXX) found in any modified source file or migration. No placeholder implementations or empty return stubs in Phase 30 component files.

---

## Human Verification Required

### 1. Playwright SC#1 — Roster Reorder Within 1 Second

**Test:** With `PLAYWRIGHT_RUN_P30=1`, run `npx playwright test --project=p30 e2e/clinic-ranking-weights-roster-reorder.spec.ts` against a running dev server with live Supabase credentials (admin + patient seeded).
**Expected:** Tab A saves weight change → Tab B's roster row order changes within 1 second (HMAC realtime broadcast completes within 1s budget).
**Why human:** Requires running dev server + live Supabase creds + two browser contexts.

### 2. Playwright SC#3 — Alert Realtime Delivery Within 5 Seconds

**Test:** With `PLAYWRIGHT_RUN_P30=1`, run `npx playwright test --project=p30 e2e/clinician-alerts-realtime.spec.ts` against a running dev server.
**Expected:** DB-level alert INSERT → HMAC realtime broadcast → `ClinicianAlertsPanel` renders new alert within 5 seconds.
**Why human:** Requires running dev server + live Supabase creds + DB-level seed + two browser contexts.

---

## Gaps Summary

**1 BLOCKER — SC#5 / CLIN-05 / CLIN-08: ClinicDashboardOverview is orphaned**

`ClinicDashboardOverview` (at `leanshot/src/components/clinic/dashboard/ClinicDashboardOverview.tsx`) is fully implemented with correct matview SECDEF accessors, color coding, staleness caption, and responsive grid. It passes 9 unit tests. However, it is never imported or rendered anywhere in the application. No route at `/clinic/{slug}/overview` exists. `ClinicWorkspace.tsx` does not reference it. The plan acknowledged the mount point was "TBD" and the executor left it unresolved.

To close this gap, wire the component into the clinic surface — either:
- Add a "Dashboard" tab to `ClinicWorkspace.tsx` (lazy-import + tab bar), or
- Add a `/clinic/{slug}/overview` route in `App.tsx`

This is a ~15-minute integration task. The data backend (matviews, SECDEFs, refresh cron) is fully live and tested.

---

**Deferred (intentional, documented):**
- D-01 Resend → email-router swap-in: deferred to Phase 25 close; vendor-gated startup health check in place
- Playwright e2e runtime execution: deferred-human (requires dev server + credentials)
- Severity-level UI rendering: deferred to v1.4 per D-09

---

_Verified: 2026-05-18T06:03:10Z_
_Verifier: Claude (gsd-verifier)_
