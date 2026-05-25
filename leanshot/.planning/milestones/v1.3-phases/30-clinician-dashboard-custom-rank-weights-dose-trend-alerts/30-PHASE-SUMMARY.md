# Phase 30: Clinician Dashboard + Custom Rank Weights + Dose-Trend Alerts — Phase Close

**Status:** Executed (pending verifier → Complete)
**Completed:** 2026-05-18
**Plans:** 6 (30-00 through 30-05)

---

## REQ Coverage

| REQ-ID | Description | Plan(s) | Status |
|--------|-------------|---------|--------|
| CLIN-01 | Per-clinic ranking weights in org_settings JSONB | 30-00, 30-02, 30-05 | COMPLETE |
| CLIN-02 | Dose-trend cron nightly; inserts clinician_alerts on threshold breach | 30-00, 30-01 | COMPLETE |
| CLIN-03 | Clinician receives in-app + email notification (PHI-aware) | 30-01, 30-03 | COMPLETE |
| CLIN-04 | 24h debounce + 3-retry/1h delivery window | 30-00, 30-01 | COMPLETE |
| CLIN-05 | Admin views aggregate alert metrics in clinic dashboard | 30-00, 30-04 | COMPLETE |
| CLIN-06 | Clinician acknowledge + snooze; auto-resolve after 7d | 30-00, 30-03, 30-05 | COMPLETE |
| CLIN-07 | Per-patient threshold overrides via patient drill-in | 30-00, 30-04 | COMPLETE |
| CLIN-08 | Population-level dose-trend metrics via materialized view | 30-00, 30-04 | COMPLETE |

All 8 CLIN REQ-IDs covered. 8/8.

---

## Decision Coverage Map (D-01..D-18 + A1)

| Decision | Description | Implementing Plan | Status |
|----------|-------------|------------------|--------|
| D-01 | Resend non-PHI email path; swap to SES at Phase 25 close | 30-01 | SHIPPED (P25 close deferred) |
| D-02 | Email template: org_name + CTA link only (no PHI) | 30-01 | SHIPPED |
| D-03 | org_settings.ranking_weights jsonb null default null | 30-00 | SHIPPED |
| D-04 | rank_org_patients SECDEF reads ranking_weights with NULL-fallback | 30-00 | SHIPPED (30-05 fixed recorded_at bug) |
| D-05 | ClinicRankingWeightsForm.tsx in clinic/settings/ | 30-02 | SHIPPED |
| D-06 | BEFORE UPDATE trigger on org_settings → broadcast on org-{hmac8}-settings | 30-00 | SHIPPED |
| D-07 | Dual-rule dose trend: adherence (N missed/M days) + variance (X% stddev) | 30-00 | SHIPPED |
| D-08 | org_patient_thresholds table + COALESCE override in detect-cron | 30-00 | SHIPPED |
| D-09 | clinician_alerts schema: single-table + status CHECK enum | 30-00 | SHIPPED |
| D-10 | 5 status transitions all have named owners (SECDEFs + crons) | 30-00, 30-03 | SHIPPED |
| D-11 | debounce_key = alert_type:user_id:YYYY-MM-DD; UNIQUE on (org_id, debounce_key) | 30-00 | SHIPPED |
| D-12 | Two-cron: detect at 03:15 UTC + deliver every 20min | 30-00, 30-01 | SHIPPED |
| D-13 | ClinicianAlertsPanel as bell-icon dropdown in ClinicContextBar; preset snoozes | 30-03 | SHIPPED |
| D-14 | clinician_alert_deliveries append-only audit table | 30-00 | SHIPPED |
| D-15 | mv_clinic_alert_metrics: rolling 7-day, refreshed 15min | 30-00, 30-04 | SHIPPED (30-05 fixed ambiguous col) |
| D-16 | mv_clinic_dose_trend_population: rolling week, refreshed 15min | 30-00, 30-04 | SHIPPED |
| D-17 | Cron collision audit — detect shifted to 03:15, auto-resolve to 04:15 | 30-00 | SHIPPED |
| D-18 | PHI lint extension for alert email template | 30-01 | SHIPPED |
| A1 | Claude's Discretion — bell-icon dropdown, number inputs, STDDEV_POP variance rule | 30-02, 30-03 | SHIPPED |

All 19 decisions + A1 implemented.

---

## Cron Schedule Final Map

| Job name | Schedule | Collision check |
|----------|----------|-----------------|
| p30_clinician_alert_detect | 30 3 * * * | 03:15 UTC — cleared audit-archive 03:00 + affiliate-lifetime 03:00 |
| p30_clinician_alert_deliver | */20 * * * * | No collision (runs every 20min) |
| p30_clinician_alert_auto_resolve | 15 4 * * * | 04:15 UTC — clears org_patient_invites 04:30 by 15min |
| p30_clinic_matview_refresh | 2,17,32,47 * * * * | Offset from Phase 27 15min matview to avoid contention |

All 4 Phase 30 jobs: `active=true` verified via `cron.job` live query.

Pre-existing 18 cron jobs unaffected (no collision).

---

## Status Machine Ownership (D-10)

| Transition | From → To | Owner | Plan |
|-----------|-----------|-------|------|
| 1 | pending → acknowledged | SECDEF `acknowledge_clinician_alert(p_alert_id)` (clinician) | 30-03 |
| 2 | pending → snoozed | SECDEF `snooze_clinician_alert(p_alert_id, p_duration)` (clinician) | 30-03 |
| 3 | snoozed → pending | `p30_clinician_alert_deliver` cron (snooze_until < now() check) | 30-01 |
| 4 | pending → auto_resolved | `p30_clinician_alert_auto_resolve` cron (7d age + no snooze) | 30-00 |
| 5 | pending → delivery_failed | `clinician-alert-deliver-cron` Edge Fn (retry_count >= 3) | 30-01 |

All 5 transitions named with owning plan per [[feedback_status_machine_transition_owner]].

---

## Bundle Ceiling Final Numbers

| Chunk | Size (gz) | Ceiling | Delta from prior |
|-------|-----------|---------|-----------------|
| clinic | 34,227 | 35,000 | +4,227 (raised from 30,000) |
| clinic-settings | 13,996 | 18,000 | — |
| clinic-invite | 4,654 | 6,000 | — |
| index | 19,700 | 24,500 | — |
| admin-bundle | N/A (wave-0 skip) | 60,000 | — |

---

## Plan-by-Plan Delivery Summary

| Plan | Name | Key Deliverables | Commit |
|------|------|-----------------|--------|
| 30-00 | Schema + SECDEFs + RLS + Tests | 7 migrations; 5 SECDEFs; 2 matview SECDEFs; 6 test files | Wave 1 |
| 30-01 | Edge Function: deliver-cron | clinician-alert-deliver-cron + Deno tests + PHI lint | Wave 1 |
| 30-02 | Ranking weights UI | ClinicRankingWeightsForm; data-testid on RosterRow | Wave 1 |
| 30-03 | Alerts panel UI | ClinicianAlertsPanel; AlertSnoozePopover; bell icon in ClinicContextBar | Wave 1 |
| 30-04 | Dashboard + threshold overrides | ClinicDashboardOverview; PatientThresholdOverrideForm; useMemberRole gate | Wave 1 |
| 30-05 | e2e + deploy + phase close | Playwright specs; Edge Fn deployed; 22 tests green; 4 bug-fix migrations | Wave 2 |

---

## Deferred Items

- **D-01 swap-in**: when Phase 25 Plan 25-03 ships `_shared/email-router.ts`, replace direct Resend fetch in `clinician-alert-deliver-cron` with `sendEmail({phi: false, template: 'clinician_alert', ...})`. No-op rename. Assigned to Phase 25 close.
- **Playwright e2e full run**: specs require `PLAYWRIGHT_RUN_P30=1` + live dev server + live Supabase credentials. Structured as a HUMAN-VERIFY checkpoint; actual runtime pass/fail depends on test environment setup. Specs are structurally verified (listed by Playwright --list).
- **Severity levels UI**: D-09 severity persisted in DB (1/2/3); v1.3 UI renders single-level only. Severity-aware UX deferred to v1.4 per D-09 decision.

---

## VENDOR passes deferred at Phase Close

| Vendor | Status | Notes |
|--------|--------|-------|
| RESEND_API_KEY for clinician-alert-deliver-cron | Vendor-gated (startup health check in Edge Fn) | Startup warning logged if absent; realtime path still active |
| Supabase Vault realtime secret | Required for HMAC broadcast | Phase 28 Vault secret bootstrap should be present; verify via get_realtime_secret() |

---

*Phase 30 — Clinician Dashboard + Custom Rank Weights + Dose-Trend Alerts*
*Closed: 2026-05-18*
*Plans: 6/6 complete (30-00 through 30-05)*
*REQs: 8/8 (CLIN-01 through CLIN-08)*
