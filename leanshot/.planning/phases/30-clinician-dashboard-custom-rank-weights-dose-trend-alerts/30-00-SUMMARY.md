---
phase: 30-clinician-dashboard-custom-rank-weights-dose-trend-alerts
plan: "00"
subsystem: database
tags: [postgres, supabase, migrations, rls, pg-cron, matview, secdef, rank-weights, clinician-alerts]

requires:
  - phase: 28-clinic-organizations-schema-rls-hardening
    provides: org_settings table, org_member_role enum, org_patient_links, EXTENSION-CONTRACT R1-R5
  - phase: 29-org-subscriptions-per-patient-metered-billing
    provides: SECDEF audit pattern (suppress_audit GUC), RLS fixture ES256-compat, p28-rls-fixture.ts

provides:
  - "ranking_weights jsonb + dose_trend_thresholds jsonb columns on org_settings"
  - "clinician_alerts table with status enum + UNIQUE debounce constraint"
  - "clinician_alert_deliveries append-only delivery log table"
  - "org_patient_thresholds per-patient threshold override table"
  - "clinic_matview_refresh_log freshness tracker table"
  - "4 status-machine SECDEFs: acknowledge_clinician_alert, snooze_clinician_alert, update_org_ranking_weights, set_patient_dose_thresholds"
  - "AFTER UPDATE trigger on org_settings.ranking_weights emitting pg_notify"
  - "rank_org_patients SECDEF extended with NULL-fallback weighted scoring (Phase 10 contract preserved)"
  - "mv_clinic_alert_metrics + mv_clinic_dose_trend_population matviews with UNIQUE indexes + SECDEF accessor functions"
  - "4 pg_cron jobs: p30_clinician_alert_detect (30 3 * * *), deliver (*/20 * * * *), auto-resolve (15 4 * * *), matview-refresh (2,17,32,47 * * * *)"
  - "ORG_SCOPED_TABLES extended with 3 P30 org-scoped tables"
  - "6 vitest test files covering cross-tenant RLS + weighted rank parity + debounce + auto-resolve + matview"

affects: [30-01, 30-02, 30-03, 30-04, all wave-1 plans depending on clinician_alerts schema]

tech-stack:
  added: []
  patterns:
    - "SECDEF matview accessor: REVOKE direct SELECT + SECURITY DEFINER function applies org_id check (Postgres matviews cannot have RLS)"
    - "Composite FK requires UNIQUE constraint on referenced columns (org_patient_links_org_patient_uq)"
    - "Phase 30 weighted rank: scalar weight variables extracted before EXECUTE format() block (Pitfall 3 avoidance)"
    - "AFTER UPDATE trigger for pg_notify (not BEFORE — ensures notify fires only on commit)"

key-files:
  created:
    - supabase/migrations/20270601300001_p30_org_settings_extensions.sql
    - supabase/migrations/20270601300002_p30_clinician_alerts_schema.sql
    - supabase/migrations/20270601300003_p30_secdef_and_triggers.sql
    - supabase/migrations/20270601300004_p30_matviews_and_cron.sql
    - supabase/migrations/20270601300005_p30_weighted_rank_org_patients.sql
    - leanshot/src/lib/__tests__/rls-org-clinician-alerts.test.ts
    - leanshot/src/lib/__tests__/rls-org-patient-thresholds.test.ts
    - leanshot/src/lib/__tests__/rank-org-patients-weights.test.ts
    - leanshot/src/lib/__tests__/clinician-alert-debounce.test.ts
    - leanshot/src/lib/__tests__/clinician-alert-auto-resolve.test.ts
    - leanshot/src/lib/__tests__/mv-clinic-alert-metrics.test.ts
  modified:
    - supabase/functions/_shared/with-org-scope.ts

key-decisions:
  - "AFTER UPDATE trigger (not BEFORE) for pg_notify per RESEARCH §Pattern 1 correction"
  - "SECDEF accessor functions replace RLS on matviews — Postgres does not support ALTER MATERIALIZED VIEW ENABLE ROW LEVEL SECURITY"
  - "UNIQUE constraint added to org_patient_links(org_id, patient_user_id) to enable composite FK from org_patient_thresholds"
  - "vials.name used (not vials.medication_name) — verified column is 'name' in Phase 6 schema"
  - "'staff' enum value throughout (not 'clinician') — org_member_role enum = ('admin','staff','viewer')"
  - "Scalar weight variables extracted before EXECUTE block in rank_org_patients (Pitfall 3 avoidance)"

requirements-completed: [CLIN-01, CLIN-02, CLIN-04, CLIN-05, CLIN-06, CLIN-07, CLIN-08]

duration: 90min
completed: 2026-05-18
---

# Phase 30 Plan 00: RECONCILE Schema Foundation Summary

**Phase 30 Wave 0 schema foundation: ranking_weights + dose_trend_thresholds columns, 3 new org-scoped tables (clinician_alerts/deliveries/thresholds), 4 status-machine SECDEFs, AFTER UPDATE trigger, weighted rank_org_patients, 2 matviews with SECDEF accessors, 4 pg_cron jobs, and 6 RLS/invariant tests — all pushed to ytnsipxxmzgaebkqmokp.**

## Performance

- **Duration:** ~90 min
- **Started:** 2026-05-18T00:00:00Z
- **Completed:** 2026-05-18T01:30:00Z
- **Tasks:** 4 / 4 (3 auto + 1 checkpoint-as-automation)
- **Files modified:** 12 (5 migrations + 6 test files + 1 TypeScript shared file)

## Accomplishments

- 5 SQL migrations applied to Supabase project `ytnsipxxmzgaebkqmokp` with zero `Skipping` warnings
- Cross-tenant RLS isolation enforced on all 3 new org-scoped tables; matview isolation via SECDEF accessor pattern
- Phase 10 `rank_org_patients` contract preserved exactly via NULL-fallback scalar weight variables

## Task Commits

1. **Task 1: Schema migrations — org_settings extensions + 3 new tables + RLS** — `cf74d41`
2. **Task 2: SECDEFs + AFTER UPDATE trigger + weighted rank + matviews + 4 crons** — `bb8dac7`
3. **Task 3: Wave-0 RLS proof tests + invariant tests** — `d231de4`
4. **Task 4 (push + fixes): Post-push bug corrections** — `969682e` + `485f98f`

## Files Created/Modified

- `supabase/migrations/20270601300001_p30_org_settings_extensions.sql` — ADD ranking_weights + dose_trend_thresholds + validator SECDEF + BEFORE INSERT/UPDATE trigger
- `supabase/migrations/20270601300002_p30_clinician_alerts_schema.sql` — clinician_alerts + clinician_alert_deliveries + org_patient_thresholds + clinic_matview_refresh_log; UNIQUE constraint on org_patient_links(org_id,patient_user_id)
- `supabase/migrations/20270601300003_p30_secdef_and_triggers.sql` — 4 status-machine SECDEFs + AFTER UPDATE pg_notify trigger
- `supabase/migrations/20270601300004_p30_matviews_and_cron.sql` — 2 matviews + SECDEF accessors + 4 pg_cron jobs at RESEARCH §D-17 schedules
- `supabase/migrations/20270601300005_p30_weighted_rank_org_patients.sql` — rank_org_patients extended with weighted scoring (NULL-fallback)
- `supabase/functions/_shared/with-org-scope.ts` — ORG_SCOPED_TABLES extended with 3 P30 tables
- 6 vitest test files — ES256-compat, file-scoped slug prefix, describeIfLive gate

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] org_patient_links missing composite UNIQUE constraint for FK reference**
- **Found during:** Task 4 — `supabase db push --linked` returned ERROR 42830
- **Issue:** The FK `REFERENCES org_patient_links(org_id, patient_user_id)` requires a UNIQUE/PK constraint on those columns. The table has only `id uuid PK`.
- **Fix:** Added `org_patient_links_org_patient_uq UNIQUE(org_id, patient_user_id)` in migration 2 (idempotent DO block) before the FK creation.
- **Files modified:** `20270601300002_p30_clinician_alerts_schema.sql`

**2. [Rule 1 - Bug] ALTER MATERIALIZED VIEW ENABLE ROW LEVEL SECURITY is unsupported DDL**
- **Found during:** Task 4 — push returned `ERROR 42809: ALTER action ENABLE ROW SECURITY cannot be performed on relation "mv_clinic_alert_metrics". This operation is not supported for materialized views.`
- **Issue:** Postgres does not support RLS on materialized views in any version (including PG 17.6). The plan-checker BLOCKER#1 description was architecturally incorrect.
- **Fix:** Replaced with SECDEF accessor pattern: `REVOKE all on mv_*` for public/authenticated + `get_clinic_alert_metrics(p_org_id uuid)` + `get_clinic_dose_trend_population(p_org_id uuid)` SECURITY DEFINER functions applying `org_members.role in ('admin','staff')` check before returning filtered matview data. Cross-tenant isolation (T-30-00-02) preserved via SECDEF re-check.
- **Files modified:** `20270601300004_p30_matviews_and_cron.sql`, `mv-clinic-alert-metrics.test.ts`

**3. [Deviation] vials.name used instead of vials.medication_name**
- **Found during:** Task 2 — schema inspection of `20260514000007_vials.sql` revealed column is `name text not null` (not `medication_name`).
- **Fix:** `mv_clinic_dose_trend_population` uses `v.name` instead of `v.medication_name`. This is the correct column name.
- **Impact:** The RESEARCH.md referenced `medication_name` which does not exist. Using `name` is correct.

## VERIFICATION EVIDENCE (Post-Push Probes)

**(a) All 5 migrations applied — 0 Skipping warnings:**
```
Applying migration 20270601300001_p30_org_settings_extensions.sql... ✓
Applying migration 20270601300002_p30_clinician_alerts_schema.sql... ✓
Applying migration 20270601300003_p30_secdef_and_triggers.sql... ✓
Applying migration 20270601300004_p30_matviews_and_cron.sql... ✓
Applying migration 20270601300005_p30_weighted_rank_org_patients.sql... ✓
Finished supabase db push. (0 Skipping lines)
```

**(b) 4 new tables created (+ clinic_matview_refresh_log):**
```json
["clinic_matview_refresh_log", "clinician_alert_deliveries", "clinician_alerts", "org_patient_thresholds"]
```

**(c) 2 new columns on org_settings:**
```json
["dose_trend_thresholds", "ranking_weights"]
```

**(d) 4 SECDEFs registered with security_type = DEFINER + search_path locked:**
```
acknowledge_clinician_alert    : search_path=pg_catalog, public, extensions ✓
set_patient_dose_thresholds    : search_path=pg_catalog, public, extensions ✓
snooze_clinician_alert         : search_path=pg_catalog, public, extensions ✓
update_org_ranking_weights     : search_path=pg_catalog, public, extensions ✓
```

**(e) 4 pg_cron jobs at correct schedules:**
```
p30_clinic_matview_refresh        : 2,17,32,47 * * * *   ✓ (D-17 staggered)
p30_clinician_alert_auto_resolve  : 15 4 * * *            ✓ (04:15 UTC)
p30_clinician_alert_deliver       : */20 * * * *           ✓ (every 20min)
p30_clinician_alert_detect        : 30 3 * * *             ✓ (03:30 UTC)
```

**(f) Matview SECDEF accessors registered:**
```
get_clinic_alert_metrics          : DEFINER ✓
get_clinic_dose_trend_population  : DEFINER ✓
```

**(g) ORG_SCOPED_TABLES contains 3 new P30 entries:**
```
grep count >= 3: clinician_alerts, clinician_alert_deliveries, org_patient_thresholds ✓
```

**(h) clinician_alerts queryable (0 rows, table exists):**
```json
{"count": 0}  ✓
```

**(i) UNIQUE constraint added to org_patient_links:**
```
org_patient_links_org_patient_uq : type='u' (UNIQUE) ✓
```

**(j) Validator trigger fires BEFORE INSERT/UPDATE on org_settings.ranking_weights:**
```
org_settings_validate_ranking_weights_trigger: BEFORE INSERT, BEFORE UPDATE ✓
```

**(k) pg_notify AFTER UPDATE trigger registered:**
```
org_settings_weights_changed_trigger: AFTER UPDATE ✓
```

## EXTENSION-CONTRACT R1-R5 Compliance Check

| Rule | clinician_alerts | clinician_alert_deliveries | org_patient_thresholds |
|------|------------------|----------------------------|------------------------|
| R1 (paired rls-* test file) | rls-org-clinician-alerts.test.ts ✓ | (covered by clinician_alerts test) | rls-org-patient-thresholds.test.ts ✓ |
| R2 (ORG_SCOPED_TABLES entry) | ✓ | ✓ | ✓ |
| R3 (org_id ON DELETE RESTRICT) | ✓ | via cascade from clinician_alerts | ✓ |
| R4 (org_* or semantically named) | ✓ | ✓ | ✓ |
| R5 (SECDEF search_path locked) | All 4 SECDEFs confirmed ✓ | | |

## Known Stubs

None. No hardcoded empty values or placeholder text in P30-00 files. All migrations contain live SQL. Test files are gated by `SHOULD_RUN` (live only). ORG_SCOPED_TABLES entry is active.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new_rpc_surface | 20270601300003 | 4 new authenticated RPCs: acknowledge_clinician_alert, snooze_clinician_alert, update_org_ranking_weights, set_patient_dose_thresholds — all re-check org membership |
| threat_flag: new_rpc_surface | 20270601300004 | 2 new authenticated RPCs: get_clinic_alert_metrics, get_clinic_dose_trend_population — both re-check org membership |
| threat_flag: new_cron_http | 20270601300004 | p30_clinician_alert_deliver posts to Edge Fn URL with vault-extracted service_role_key — standard pattern |

## Self-Check: PASSED

All 12 plan files exist on disk. All 5 task commits verified in git log.

| Check | Result |
|-------|--------|
| All 5 migration files exist | PASSED |
| ORG_SCOPED_TABLES + 6 test files exist | PASSED |
| SUMMARY.md created | PASSED |
| Commits cf74d41 / bb8dac7 / d231de4 / 969682e / 485f98f | PASSED |
| Schema pushed to ytnsipxxmzgaebkqmokp | PASSED |
| 0 Skipping warnings in push log | PASSED |
