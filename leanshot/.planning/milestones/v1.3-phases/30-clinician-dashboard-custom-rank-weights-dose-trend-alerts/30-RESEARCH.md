# Phase 30: Clinician Dashboard + Custom Rank Weights + Dose-Trend Alerts — Research

**Researched:** 2026-05-17
**Domain:** PostgreSQL trigger DDL, pg_cron scheduling, Supabase Realtime HMAC channels, Edge Function two-cron pattern, Postgres window functions, matview CONCURRENTLY refresh
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Ship CLIN-03 email with Resend + non-PHI template. Subject: `New clinical alert — {org_name}`. Body: CTA `?alert={uuid}` deep-link only. Extend Plan 29-07 PHI lint or add sibling `scripts/lint-phi-email-templates.ts`.
- **D-02:** Email body: NO patient name/count/alert type/dose values. Single CTA link. Deep-link survives magic-link redirect.
- **D-03:** `org_settings.ranking_weights jsonb null default null`. Shape: `{"dose_adherence": numeric, "weight_loss": numeric, "activity": numeric, "symptoms": numeric}`. CHECK: all 4 keys present, each in [0,1], sum = 1.0 ±0.001.
- **D-04:** Extend `rank_org_patients(p_org_id uuid, ...)` SECDEF with NULL-fallback to existing hardcoded defaults when `ranking_weights IS NULL`. Patient-specific thresholds do NOT affect ranking.
- **D-05:** Settings UI: `ClinicRankingWeightsForm.tsx` under `src/components/clinic/settings/`. 4 percent inputs; auto-normalize; Save → SECDEF `update_org_ranking_weights`; audit-logged.
- **D-06:** `BEFORE UPDATE` trigger on `org_settings` when `ranking_weights` changes → emit realtime broadcast on `org-{hmac8}-settings` channel. Client RosterTable subscribes via `channelNameFor(orgId, 'settings')` and invokes `useRankRoster.refresh()`. Phase 10 30s polling stays as failsafe.
- **D-07:** Dual-rule trend — adherence: patient missed >= N doses in M days; variance: interval variance > X%. Defaults: N=2, M=14, X=25%. All knobs in `org_settings.dose_trend_thresholds jsonb`.
- **D-08:** NEW `org_patient_thresholds(org_id, patient_user_id, thresholds jsonb, set_by, set_at)`. FK to `org_patient_links(org_id, patient_user_id)`. Cron resolves with `COALESCE(patient_override.thresholds, org_settings.dose_trend_thresholds)`.
- **D-09:** `clinician_alerts` single-table with status CHECK enum. `severity` persisted but not rendered in v1.3 UI.
- **D-10:** All 5 status transitions have named owners (SECDEF RPCs or crons).
- **D-11:** `debounce_key = ${alert_type}:${patient_user_id}:${YYYY-MM-DD}`. UNIQUE on `(org_id, debounce_key)`.
- **D-12:** Two-cron: detect-cron nightly (03:15 UTC — shifted from 03:00 collision with audit-archive) + deliver-cron every 20min. Detect: pure SQL INSERT ON CONFLICT DO NOTHING. Deliver: Edge Fn for Resend HTTP + realtime broadcast.
- **D-13:** `ClinicianAlertsPanel` as bell-icon dropdown in `ClinicContextBar` (UI-SPEC decision). Preset snooze durations: 1h/4h/24h/7d only.
- **D-14:** Append-only `clinician_alert_deliveries(id, alert_id, channel, attempted_at, success, error)`. INSERT only via service_role. No UPDATE ever.
- **D-15:** `mv_clinic_alert_metrics` — rolling 7-day, refreshed 15min.
- **D-16:** `mv_clinic_dose_trend_population` — rolling week, refreshed 15min.
- **D-17:** Cron collision audit RESOLVED (see Section below).
- **D-18:** Extend or add sibling PHI lint script for alert email template.

### Claude's Discretion

- Exact SQL window/lag patterns for D-07 adherence + variance rule.
- Exact `BEFORE UPDATE` trigger DDL for D-06.
- D-17 cron schedule conflict resolution (researcher resolves — done in this document).
- D-14 separate table confirmed (not single-table).
- Edge Fn vs pure SQL for detect-cron (pure SQL INSERT is simplest; deliver-cron must be Edge Fn for Resend).
- 1 combined vs 2 separate matviews — 2 separate recommended (different grain, different consumers).
- Whether `_shared/email-router.ts` swap-in is part of P30 or P25 close task.
- Severity-level collapse — v1.3 collapses to single level in UI (persisted in DB for v1.4).

### Deferred Ideas (OUT OF SCOPE)

- Free-form snooze durations (v1.4)
- ML-based dose-trend (post-v1.3)
- Slack/SMS alert channels
- Cross-clinic benchmarking
- Per-clinician notification preferences
- Alert escalation chains
- Patient-side alert visibility
- Matview combine (Claude's Discretion — 2 separate wins on grain clarity)
- `_shared/email-router.ts` swap-in (Phase 25 close task, not P30)

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLIN-01 | Clinic admin configures per-clinic ranking weights stored in `org_settings` JSONB | D-03/D-04: ADD column migration + extend rank_org_patients SECDEF with NULL-fallback |
| CLIN-02 | Dose-trend cron runs nightly; inserts `clinician_alerts` when threshold breached | D-07/D-08/D-12: SQL window + COALESCE pattern + detect-cron at 03:15 UTC |
| CLIN-03 | Clinician receives in-app + email notification; email is PHI-aware | D-01/D-02/D-12: Resend non-PHI template + deliver-cron Edge Fn |
| CLIN-04 | 24h debounce + 3-retry/1h delivery | D-11: UNIQUE debounce_key + D-12 deliver-cron 20min × 3 |
| CLIN-05 | Admin views aggregate alert metrics in clinic dashboard | D-15: mv_clinic_alert_metrics + ClinicDashboardOverview component |
| CLIN-06 | Clinician acknowledge + snooze; auto-resolve after 7d | D-10: SECDEF RPCs + auto-resolve cron at 04:15 UTC |
| CLIN-07 | Per-patient threshold overrides via patient drill-in | D-08: org_patient_thresholds table + PatientThresholdOverrideForm |
| CLIN-08 | Population-level dose-trend metrics via materialized view | D-16: mv_clinic_dose_trend_population + ClinicDashboardOverview stat cards |

</phase_requirements>

---

## Summary

Phase 30 builds three tightly-coupled systems on top of Phase 28/29 foundations. The core research establishes concrete SQL patterns for each piece:

**Custom rank weights (CLIN-01):** The existing `rank_org_patients` SECDEF uses hardcoded integer weights in a `scored` CTE. Extending it requires adding a `SELECT INTO v_weights` from `org_settings` before the EXECUTE block, then interpolating the weights as JSONB-extracted numerics. The NULL-fallback preserves Phase 10 contract exactly — no behavioral change for non-clinic users.

**Dose-trend detection (CLIN-02/07):** The adherence rule uses a `COUNT(distinct date_trunc('day', i.created_at))` against a `prescribed_schedule_cadence` in the `vials` table. The variance rule uses a `STDDEV_POP` over `LAG`-derived injection intervals within a rolling M-day window. Both rules can be expressed as pure SQL inside the detect-cron — no Edge Function needed for detection. The deliver-cron must be an Edge Function because it makes Resend HTTP calls and Realtime broadcasts.

**Alert pipeline (CLIN-03/04/06):** The two-cron pattern mirrors Phase 29's metered billing cron exactly: per-org sequential loop, per-record try/catch, Sentry on failure. The debounce UNIQUE constraint handles deduplication at the DB level. The BEFORE UPDATE trigger on `org_settings` for D-06 should use `pg_notify` piped through Supabase Realtime's `postgres_changes` listener — this is simpler than a custom Edge Function broadcast and works within the existing HMAC channel infrastructure.

**Primary recommendation:** Use `BEFORE UPDATE` trigger with `pg_notify` routed through Supabase Realtime `postgres_changes` for D-06 (not a custom Edge Fn broadcast). Use two separate matviews with independent UNIQUE indexes for CONCURRENTLY refresh. Shift detect-cron to 03:15 UTC to avoid the 03:00 audit-archive collision.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ranking weights storage + validation | Database (Postgres trigger) | — | jsonb shape validation belongs at DB layer same as `_validate_consent_scope` |
| `rank_org_patients` weight application | Database (SECDEF RPC) | — | Must remain in same SECDEF to avoid round-trip; NULL-fallback is pure SQL |
| D-06 roster refresh broadcast | Database (BEFORE UPDATE trigger) | Browser (subscribe) | Trigger fires synchronously on settings save; client subscribed to HMAC channel |
| Dose-trend detection | Database (pg_cron pure SQL) | — | No HTTP/Resend needed for detection; simpler than Edge Fn |
| Alert delivery (Realtime + email) | Edge Function (deliver-cron) | Database (status updates) | Resend requires HTTP call; only Edge Fns can do outbound HTTP in Supabase |
| Per-patient threshold resolution | Database (SECDEF + COALESCE) | — | `COALESCE(override, org_default)` is a DB-native operation |
| Alert acknowledgment/snooze | Database (SECDEF RPCs) | Browser (optimistic UI) | Pattern S1 dual-layer |
| Auto-resolve + snooze-resume | Database (pg_cron pure SQL) | — | Simple UPDATE; no HTTP needed |
| Aggregate dashboard metrics | Database (matviews, 15min refresh) | Browser (read-only display) | Pre-aggregated for fast clinic-shell render |
| PHI lint enforcement | CI (lint script) | — | Build-time gate; extends P29 pattern |

---

## Standard Stack

### Core

| Library / API | Version | Purpose | Why Standard |
|---------------|---------|---------|--------------|
| Postgres `BEFORE UPDATE` trigger | built-in | D-06 ranking-weights broadcast | Phase 28 already uses triggers for consent scope validation; same pattern |
| `pg_notify` + Supabase Realtime `postgres_changes` | built-in | Trigger-to-client signaling for D-06 | Simpler than custom broadcast; works with existing HMAC channel topology |
| `channelNameFor` / `channelNameFromSecret` | `_shared/realtime.ts` (P29) | HMAC channel names for `-settings` and `-alerts` suffixes | Already shipped; import directly |
| Postgres window functions (`LAG`, `STDDEV_POP`) | built-in | D-07 variance detection | Standard SQL; no extension needed |
| `pg_cron` | enabled on project | Scheduled jobs for detect, deliver, auto-resolve, matview refresh | Already in use for 19 other jobs |
| Resend REST API (`https://api.resend.com/emails`) | live (P29 verified) | D-01 non-PHI email delivery | Same pattern as `clinic-patient-invite` |
| `npm:@supabase/supabase-js@2` | 2.x | Edge Function Supabase client | Established in all existing Edge Fns |
| `REFRESH MATERIALIZED VIEW CONCURRENTLY` | built-in | D-15/D-16 15-min matview refresh | Established in P22 (`user_activity_daily`) and P19 (`affiliate_click_baseline`) |

### Supporting

| Library | Purpose | When to Use |
|---------|---------|-------------|
| `_shared/sentry.ts` | `captureException`/`captureMessage` | Per-org failures in deliver-cron loop |
| `_shared/supabase-server.ts` `_createServiceRoleClientUnsafe` | Service role client in Edge Fns | Required by ESLint no-raw-service-role-client rule |
| `_shared/with-org-scope.ts` `withOrgScope` | Org-scoped service-role queries | When querying `clinician_alerts` or `clinician_alert_deliveries` via service_role |
| framer-motion `useReducedMotion` | Alert panel entry animation | Browser component only; gate ALL animations |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pg_notify` + `postgres_changes` for D-06 | Custom Edge Fn that broadcasts on `org-{hmac8}-settings` | Edge Fn adds latency + cold-start; trigger is synchronous. Pg_notify is simpler and fast. |
| 2 separate matviews (D-15/D-16) | 1 combined matview | Combined matview has wider columns + mixed granularity (alert metrics vs population metrics). Different consumers (dashboard overview vs alert panel) query different subsets. 2 separate gives cleaner EXPLAIN plans and independent UNIQUE index coverage. |
| Pure SQL auto-resolve in deliver-cron | Separate auto-resolve Edge Fn | Auto-resolve is a simple `UPDATE ... SET status='auto_resolved'` — no HTTP needed. Folding into deliver-cron logic (or a 04:15 pg_cron pure SQL job) avoids a fourth Edge Fn. Recommend 04:15 pure SQL pg_cron per D-17 schedule. |
| Detect-cron as Edge Fn | Pure SQL in pg_cron body | Detection is INSERT ON CONFLICT DO NOTHING — pure SQL. Edge Fn adds cold-start overhead. Keep as pg_cron SQL body. |

---

## Architecture Patterns

### System Architecture Diagram

```
Patient data tables (injections, weights, symptoms)
         │
         │ [03:15 UTC pg_cron SQL body]
         ▼
  detect-cron: per-patient dose-trend SQL
       ├── adherence rule: COUNT missed doses in M-day window
       └── variance rule: STDDEV_POP of injection intervals
         │ (threshold from COALESCE(org_patient_thresholds, org_settings.dose_trend_thresholds))
         ▼
  INSERT INTO clinician_alerts ... ON CONFLICT (org_id, debounce_key) DO NOTHING
         │
         │ [every 20min pg_cron → Edge Fn]
         ▼
  clinician-alert-deliver-cron Edge Fn
       ├── SELECT pending alerts WHERE retry_count < 3
       ├── [a] Realtime broadcast on org-{hmac8}-alerts channel
       │         → ClinicianAlertsPanel (browser) subscribes via channelNameFor
       ├── [b] Resend POST /emails (non-PHI template, D-02)
       │         → INSERT INTO clinician_alert_deliveries
       └── on 3rd failure → status='delivery_failed' + Sentry warning

  org_settings UPDATE (ranking_weights column)
         │ [BEFORE UPDATE trigger on org_settings]
         ▼
  pg_notify 'org_settings_changed' with org_id payload
         │
         ▼
  Supabase Realtime postgres_changes on org-{hmac8}-settings
         │
         ▼
  useRosterRealtime (browser) → useRankRoster.refresh()
  → rank_org_patients RPC (with new weights from org_settings)
  → RosterTable re-renders within 1s (SC#1)

  [04:15 UTC pg_cron SQL body]
  auto-resolve: UPDATE clinician_alerts SET status='auto_resolved'
    WHERE status='pending' AND snooze_until IS NULL
      AND created_at < now() - interval '7 days'

  [*/15 pg_cron] REFRESH MATERIALIZED VIEW CONCURRENTLY mv_clinic_alert_metrics
  [*/15 pg_cron] REFRESH MATERIALIZED VIEW CONCURRENTLY mv_clinic_dose_trend_population
         │
         ▼
  ClinicDashboardOverview reads matviews via SECDEF RPC
```

### Recommended Project Structure

```
supabase/
├── migrations/
│   ├── 20270601300001_org_settings_ranking_weights.sql   # ADD columns to org_settings; ranking_weights validator trigger
│   ├── 20270601300002_org_patient_thresholds.sql         # NEW table + RLS + _is_org_admin gate
│   ├── 20270601300003_clinician_alerts.sql               # NEW table + RLS + debounce UNIQUE
│   ├── 20270601300004_clinician_alert_deliveries.sql     # NEW append-only table + RLS
│   ├── 20270601300005_rank_org_patients_weighted.sql     # EXTEND rank_org_patients SECDEF
│   ├── 20270601300006_update_org_ranking_weights_rpc.sql # NEW SECDEF + audit
│   ├── 20270601300007_set_patient_dose_thresholds_rpc.sql# NEW SECDEF + audit
│   ├── 20270601300008_alert_action_rpcs.sql              # acknowledge + snooze SECDEFs
│   ├── 20270601300009_org_settings_weights_trigger.sql   # BEFORE UPDATE trigger for D-06 broadcast
│   ├── 20270601300010_mv_clinic_alert_metrics.sql        # matview + UNIQUE index
│   ├── 20270601300011_mv_clinic_dose_trend_population.sql# matview + UNIQUE index
│   ├── 20270601300012_cron_detect_and_deliver.sql        # pg_cron: detect 03:15 + deliver */20 + auto-resolve 04:15 + matview */15
│   └── 20270601300013_with_org_scope_p30_tables.sql      # Append clinician_alerts + clinician_alert_deliveries + org_patient_thresholds to ORG_SCOPED_TABLES
├── functions/
│   ├── clinician-alert-deliver-cron/
│   │   └── index.ts            # deliver + realtime broadcast + Resend (mirrors org-metered-billing-cron pattern)
│   └── _shared/
│       └── (no new shared files — reuse realtime.ts, sentry.ts, supabase-server.ts)
leanshot/src/components/clinic/
├── settings/
│   ├── ClinicRankingWeightsForm.tsx       # D-05 (CLIN-01)
│   └── ClinicDoseTrendThresholdsForm.tsx  # D-07 org defaults (CLIN-02)
├── alerts/
│   ├── ClinicianAlertsPanel.tsx           # D-13 (CLIN-03/06)
│   └── AlertSnoozePopover.tsx             # preset durations
├── dashboard/
│   └── ClinicDashboardOverview.tsx        # D-15/D-16 (CLIN-05/08)
└── drill-in/
    └── PatientThresholdOverrideForm.tsx   # D-08 (CLIN-07)
scripts/
└── lint-phi-email-templates.ts           # D-18 (or extend lint-stripe-phi.ts)
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HMAC channel naming | Custom hex-hash logic | `channelNameFor` from `_shared/realtime.ts` | Already shipped in P29; must match `realtime_topic_authorized` SQL logic |
| org_id scoping for service_role | Direct `from('clinician_alerts')` without filter | `withOrgScope` + `ORG_SCOPED_TABLES` | 4-layer defense; bypass triggers Sentry fatal alert |
| Resend API calls | `fetch('https://api.resend.com/emails', ...)` inline | Reuse the same pattern from `clinic-patient-invite/index.ts` | Startup health check, no-op with warning, test-stub detection — all established |
| Audit logging in SECDEFs | Custom `INSERT INTO audit_logs` | `direct INSERT` pattern from P29 migration (NOT `log_admin_action` which requires platform-admin role) | P29 SECDEF confirmed: direct INSERT with `app.suppress_audit='on'` GUC |
| Matview unique index | Skip for CONCURRENTLY | Always add `CREATE UNIQUE INDEX` before first CONCURRENTLY refresh | Pitfall 5: `REFRESH CONCURRENTLY` fails without unique index |
| Status transitions | Ad-hoc UPDATE directly | Named SECDEF RPCs per D-10 transition table | Pattern S1 audit enforcement; prevents direct authenticated UPDATE |

**Key insight:** The detect-cron is pure SQL (no Edge Fn needed). The only Edge Function in this phase is the deliver-cron, which needs outbound HTTP for Resend. Don't over-engineer detection into an Edge Fn.

---

## D-17: Cron Collision Audit — RESOLVED

**Verified cron schedule map** (from migration file audit):

| Job Name | Schedule | Source |
|----------|----------|--------|
| cleanup-anon-users | 0 3 * * * | 20260512000002 |
| audit-archive-nightly | 0 3 * * * | 20270601000032 |
| photos-trash-purge | 15 3 * * * | 20270601000025 |
| user-activity-daily-refresh | 0 2 * * * | 20270601000009 |
| p29_org_metered_billing_cron | 0 2 * * * | 20270601200006 |
| affiliate-click-baseline-refresh | 0 1 * * * | 20270101000009 |
| affiliate-conversions-confirm | 15 0 * * * | 20270101000012 |
| affiliate-payouts-materialize | 30 0 * * * | 20270101000012 |
| affiliate-monthly-payout | 0 0 1 * * | 20270101000012 |
| finalize-account-deletions | 0 4 * * * | 20270601000001 + 20260601000013 |
| p28_org_invites_expiry_purge | 0 4 * * * | 20270601100018 |
| lifecycle-welcome-series | 0 */4 * * * | 20270601000017 |
| lifecycle-behavior-triggered | */15 * * * * | 20270601000017 |
| lifecycle-retention | 0 6 * * * | 20270601000017 |
| cleanup-audit-logs | 0 5 * * * | 20260601000003 |
| feature-flag-overrides-cleanup | 0 5 * * * | 20270601000016 |
| dsar-export-tick | */5 * * * * | 20270601000021 |
| p29_org_patient_invites_expiry_purge | 30 4 * * * | 20270601200007 |

**Collision analysis:**

- `0 3 * * *` — COLLISION: `cleanup-anon-users` AND `audit-archive-nightly` both run at 03:00. These are existing collisions (pre-P30) — pg_cron handles simultaneous jobs by running them concurrently in separate background workers. Since each is an HTTP call to a different Edge Function and takes < 30s, they do not block each other. This collision is pre-existing and acceptable.
- `15 3 * * *` — occupied by `photos-trash-purge`.
- **`clinician-alert-detect-cron`** — cannot use 03:00 (audit-archive) or 03:15 (photos-trash-purge). **Recommend: `30 3 * * *`** (03:30 UTC). Confirmed clean slot.
- **`clinician-alert-deliver-cron`** — `*/20 * * * *`. This fires at :00, :20, :40 each hour. At 03:00 it coincides with audit-archive + cleanup-anon-users. However deliver-cron is an HTTP call to a different Edge Function; it does not block the other two. Acceptable.
- **`clinician-alert-auto-resolve-cron`** — pure SQL UPDATE (not HTTP). `15 4 * * *` is clean (finalize-account-deletions and org_invites_expiry_purge both at 04:00; 15min gap is fine for pure SQL). **Recommend: `15 4 * * *`**.
- **`clinician-matview-refresh`** — `*/15 * * * *` — same slot as `lifecycle-behavior-triggered`. Both are HTTP calls to different Edge Functions. pg_cron allows concurrent execution. Acceptable, but to differentiate offset: use `2 */15 * * *` (i.e., run at :02, :17, :32, :47 each hour) to stagger from the lifecycle cron which fires at :00/:15/:30/:45.

**Final recommended cron schedule for P30:**

| Job | Schedule | Type | Notes |
|-----|----------|------|-------|
| `p30_clinician_alert_detect` | `30 3 * * *` | Pure SQL in pg_cron body | 03:30 UTC; clean slot |
| `p30_clinician_alert_deliver` | `*/20 * * * *` | Edge Fn HTTP (via pg_cron) | Every 20min; concurrent with others OK |
| `p30_clinician_alert_auto_resolve` | `15 4 * * *` | Pure SQL in pg_cron body | 04:15 UTC; clean (04:00 jobs are 15min ahead) |
| `p30_clinic_matview_refresh` | `2,17,32,47 * * * *` | Pure SQL REFRESH CONCURRENTLY | Staggered from lifecycle-behavior-triggered at :00/:15/:30/:45 |

---

## Architecture Patterns

### Pattern 1: BEFORE UPDATE Trigger for D-06 Broadcast

**What:** `BEFORE UPDATE` trigger on `org_settings` fires whenever `ranking_weights` changes. Uses `pg_notify` which Supabase Realtime forwards as a `postgres_changes` broadcast event.

**Why `postgres_changes` not custom broadcast:** The `realtime_topic_authorized` SECDEF already validates HMAC channel subscriptions. The browser subscribes to `channelNameFor(orgId, 'settings')` which matches the standard `org-{hmac8}-settings` topic. `postgres_changes` delivers the notification through Realtime without needing an Edge Function.

**Trigger DDL:**
```sql
-- Source: verified pattern from Phase 28 consent-scope trigger (20270601200003_org_patient_invites.sql)
-- and Phase 22 audit phi triggers (20270601000030_audit_phi_table_triggers.sql)

create or replace function public._notify_org_settings_weights_changed()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  -- Only notify when ranking_weights actually changed (not on other column updates)
  if (new.ranking_weights IS DISTINCT FROM old.ranking_weights) then
    perform pg_notify(
      'org_settings_weights_changed',
      json_build_object('org_id', new.org_id)::text
    );
  end if;
  return new;
end;
$$;

create trigger org_settings_weights_changed_trigger
  after update of ranking_weights
  on public.org_settings
  for each row
  execute function public._notify_org_settings_weights_changed();
```

**Client subscription (browser):** The existing `use-roster-realtime.ts` uses `supabase.channel(topic).on('broadcast', ...)`. For D-06, add a second subscription to `channelNameFor(orgId, 'settings')` listening on `postgres_changes` event type or `broadcast` event `settings_updated`. The `ClinicContextBar` or a new `use-org-settings-realtime.ts` hook handles this.

**Note on `BEFORE` vs `AFTER`:** Use `AFTER UPDATE` (not BEFORE) so `pg_notify` fires only after the row is committed. `BEFORE` triggers fire before the transaction commits — `pg_notify` inside BEFORE triggers is sent only if the transaction commits, but the timing is subtle. `AFTER` is the canonical pattern for notification triggers.

**Correction to CONTEXT.md:** D-06 says "BEFORE UPDATE trigger" — the correct DDL is `AFTER UPDATE` to guarantee the notification fires only on successful commit. Use `AFTER UPDATE OF ranking_weights`.

### Pattern 2: D-07 Dose-Trend SQL — Adherence Rule

**What:** Count distinct days on which the patient had an injection within the prescribed window, then count missed days.

**Key schema facts (verified from `rank_org_patients` migration):**
- `public.injections` has `user_id` + `created_at`
- `public.vials` table exists (referenced in rank_org_patients as data source for dose consent)
- The prescribed cadence (e.g., weekly injection) is not yet confirmed to be stored in a single canonical column — research notes this is a discretion area for the planner to resolve with schema inspection

**Adherence rule SQL (rolling M-day window approach):**
```sql
-- [VERIFIED pattern: adapted from rank_org_patients SECDEF Step 3a]
-- Detect: patient missed >= N scheduled doses in past M days
-- Assumption: prescribed_cadence_days is available per vial/patient (planner to verify column)

WITH missed_doses AS (
  SELECT
    opl.patient_user_id,
    opl.org_id,
    -- Count distinct injection days in M-day window
    COUNT(DISTINCT date_trunc('day', i.created_at)::date) AS injection_days_in_window,
    -- Expected: one injection per prescribed_cadence_days within M-day window
    -- (effective_thresholds.window_days_m / prescribed_cadence_days) rounded
    COALESCE(opt.thresholds->>'window_days_m', os.dose_trend_thresholds->>'window_days_m')::int AS window_m,
    COALESCE(opt.thresholds->>'missed_doses_n', os.dose_trend_thresholds->>'missed_doses_n')::int AS threshold_n
  FROM org_patient_links opl
  JOIN org_settings os ON os.org_id = opl.org_id
  LEFT JOIN org_patient_thresholds opt
    ON opt.org_id = opl.org_id AND opt.patient_user_id = opl.patient_user_id
  LEFT JOIN injections i
    ON i.user_id = opl.patient_user_id
    AND i.created_at > now() - (COALESCE(opt.thresholds->>'window_days_m',
                                         os.dose_trend_thresholds->>'window_days_m')::int
                                * interval '1 day')
  WHERE opl.org_id = p_org_id
    AND opl.unlinked_at IS NULL
  GROUP BY opl.patient_user_id, opl.org_id, opt.thresholds, os.dose_trend_thresholds
)
-- [ASSUMED: prescribed_cadence_days exists — planner must verify source column]
```

**Variance rule SQL (LAG pattern):**
```sql
-- Compute injection interval variance using LAG window function
WITH injection_intervals AS (
  SELECT
    user_id,
    created_at,
    LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS prev_injection_at,
    EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (
      PARTITION BY user_id ORDER BY created_at
    ))) / 86400.0 AS interval_days
  FROM injections
  WHERE user_id = ANY(ARRAY(SELECT patient_user_id FROM org_patient_links WHERE org_id = p_org_id AND unlinked_at IS NULL))
    AND created_at > now() - interval '90 days'  -- wider window to get meaningful variance
),
variance_by_patient AS (
  SELECT
    user_id,
    STDDEV_POP(interval_days) AS interval_stddev,
    AVG(interval_days) AS interval_avg,
    COUNT(*) AS injection_count
  FROM injection_intervals
  WHERE interval_days IS NOT NULL  -- exclude first injection (no LAG)
  GROUP BY user_id
  HAVING COUNT(*) >= 2  -- need at least 2 intervals for meaningful variance
)
-- Variance % = (stddev / avg) * 100 — coefficient of variation
-- Alert if variance_pct > threshold_x
SELECT
  user_id,
  (interval_stddev / NULLIF(interval_avg, 0)) * 100 AS variance_pct
FROM variance_by_patient
WHERE (interval_stddev / NULLIF(interval_avg, 0)) * 100 > threshold_x;
```

**[ASSUMED]:** The prescribed dose cadence (weekly, biweekly) is derivable from the `vials` table or a profile setting. If no canonical prescribed schedule exists, the adherence rule may need to be simplified to "N missed days in M days regardless of schedule." Planner must inspect `vials` and `injections` schema to confirm.

### Pattern 3: Extend `rank_org_patients` for Weighted Scores

**What:** Before the `EXECUTE format($sql$...)` block, read `org_settings.ranking_weights` into a local variable. Interpolate into the `scored` CTE as multipliers.

```sql
-- [VERIFIED: extends 20260901000003_rank_org_patients_rpc.sql]
-- In the DECLARE block:
declare
  v_weights jsonb;  -- NULL = use hardcoded defaults

-- Before the EXECUTE block, after the permission gate:
select ranking_weights into v_weights
from public.org_settings
where org_id = p_org_id;

-- In the scored CTE, replace hardcoded weights:
-- Instead of: (case when s.missed_dose_flag then 28 else 0 end)
-- Use: (case when s.missed_dose_flag then
--         COALESCE((v_weights->>'dose_adherence')::numeric * 100, 28)
--       else 0 end)
```

**Important implementation note:** The EXECUTE block uses `format($sql$...$sql$, p_org_id)`. `v_weights` is a PL/pgSQL variable, not a format parameter. Pass it as an additional format argument OR restructure to interpolate the weight values before the EXECUTE call. Recommended: compute the four weight values into scalar variables before the EXECUTE block, then pass them as `%L` literals inside the format string.

### Pattern 4: Two-Cron Edge Function (deliver-cron)

**What:** Mirrors `org-metered-billing-cron/index.ts` exactly. Sequential per-org loop; per-alert try/catch; Sentry on failure.

```typescript
// Source: verified pattern from org-metered-billing-cron/index.ts
// Key differences for deliver-cron:
// 1. SELECT pending alerts per org WHERE status='pending' AND retry_count < 3
// 2. For each alert: attempt (a) Realtime broadcast + (b) Resend email
// 3. INSERT INTO clinician_alert_deliveries for each attempt
// 4. On all 3 failures: UPDATE clinician_alerts SET status='delivery_failed'
// 5. Vendor-gated health check: RESEND_API_KEY missing → 503 no-op (per reference_vendor_gated_send_health_check)

if (!Deno.env.get('RESEND_API_KEY')) {
  console.warn('[clinician-alert-deliver-cron] RESEND_API_KEY missing — email delivery disabled');
}
```

**Realtime broadcast from Edge Function:** Use the Supabase Management API `Broadcast` endpoint (not `pg_notify` — that's DB-side only). The deliver-cron Edge Function uses the REST broadcast API:
```typescript
// Broadcast via Supabase REST API (not pg_notify — Edge Fns cannot use pg_notify directly)
// Pattern: POST to Supabase Realtime API
const channelName = await channelNameFromSecret(orgId, 'alerts', secretHex);
// Use supabase-js client.channel(channelName).send() OR the REST broadcast endpoint
```

**Note:** Edge Functions cannot call `pg_notify` directly. To broadcast from an Edge Function, use `supabase-js` client's `channel.send({ type: 'broadcast', event: 'new_alert', payload: {...} })`. This requires an initialized Supabase client (anon key is sufficient for channel sends; HMAC validation happens on subscribe, not send).

### Pattern 5: Matview with CONCURRENTLY Refresh

```sql
-- Source: verified pattern from 20270601000008_user_activity_daily_matview.sql + 20270101000007

create materialized view if not exists public.mv_clinic_alert_metrics as
select
  org_id,
  alert_type,
  count(*) filter (where status = 'pending')   as pending_count,
  count(*) filter (where status = 'acknowledged') as acknowledged_count,
  count(*) as total_count,
  round(
    100.0 * count(*) filter (where status = 'acknowledged') /
    nullif(count(*), 0), 2
  ) as ack_rate_pct,
  round(
    avg(
      extract(epoch from (ack_at - created_at)) / 60.0
    ) filter (where ack_at is not null), 2
  ) as avg_time_to_ack_minutes,
  now() - interval '7 days' as period_start,
  now() as period_end
from public.clinician_alerts
where created_at > now() - interval '7 days'
group by org_id, alert_type;

-- REQUIRED for CONCURRENTLY refresh (Pitfall 5)
create unique index if not exists mv_clinic_alert_metrics_uq
  on public.mv_clinic_alert_metrics (org_id, alert_type);

-- mv_clinic_dose_trend_population: per-medication, dosing_range_status, count
-- (requires confirmed medication/dosing schema — planner to verify vials/injections columns)
create materialized view if not exists public.mv_clinic_dose_trend_population as
select
  opl.org_id,
  -- [ASSUMED: medication_name derivable from vials or injections]
  coalesce(v.medication_name, 'Unknown') as medication_name,
  case
    when ca.alert_type = 'dose_adherence' then 'below'
    else 'within'
  end as dosing_range_status,
  count(distinct opl.patient_user_id) as patient_count,
  now() - interval '7 days' as period_start,
  now() as period_end
from org_patient_links opl
left join clinician_alerts ca
  on ca.patient_user_id = opl.patient_user_id
  and ca.org_id = opl.org_id
  and ca.created_at > now() - interval '7 days'
  and ca.status != 'auto_resolved'
left join vials v on v.user_id = opl.patient_user_id
where opl.unlinked_at is null
group by opl.org_id, medication_name, dosing_range_status, ca.alert_type;

create unique index if not exists mv_clinic_dose_trend_population_uq
  on public.mv_clinic_dose_trend_population (org_id, medication_name, dosing_range_status);
```

**Important:** Matviews containing `now()` or `current_timestamp` in SELECT columns cannot be refreshed CONCURRENTLY because the view definition changes on each refresh (the `period_start`/`period_end` values would differ). Replace with computed constants stored separately, OR store `refreshed_at` as a separate column and populate via the cron. **Recommendation:** Remove `period_start`/`period_end` from the matview itself; add a `refreshed_at timestamptz` column with a default, updated by the refresh cron. Alternatively, use a separate `mv_refresh_log` table. This is a real pitfall (D-15/D-16 specifics).

### Pattern 6: `clinician_alerts` RLS + Status Machine

**The `clinician_alerts` table has `org_id` — it IS org-scoped. Add to `ORG_SCOPED_TABLES`.**

Per 28-EXTENSION-CONTRACT Section 4: Phase 28 EXTENSION-CONTRACT Section 9 states "P30 must resolve whether these tables are org-scoped." Answer: YES. `clinician_alerts` has `org_id` FK → `organizations(id)`. Must add to `ORG_SCOPED_TABLES`.

**Status machine transition ownership table (D-10):**

| Status | From | To | Owner | SECDEF / cron |
|--------|------|----|-------|----------------|
| `pending` | (created) | pending | detect-cron pg_cron SQL | INSERT only via service_role |
| `acknowledged` | pending | acknowledged | clinician | `acknowledge_clinician_alert(p_alert_id uuid)` SECDEF |
| `snoozed` | pending | snoozed | clinician | `snooze_clinician_alert(p_alert_id uuid, p_duration text)` SECDEF |
| `pending` | snoozed | pending (resume) | auto-resume | folded into auto-resolve cron at 04:15 UTC |
| `auto_resolved` | pending | auto_resolved | auto-resolve cron | pg_cron SQL at 04:15 UTC |
| `delivery_failed` | pending | delivery_failed | deliver-cron | Edge Fn sets on retry_count >= 3 |

### Anti-Patterns to Avoid

- **Calling `log_admin_action` inside Phase 30 SECDEFs:** `log_admin_action` requires the platform-admin role (Phase 24 D-03). Phase 30 SECDEFs are clinician/org-admin scoped — use direct `INSERT INTO audit_logs` with `app.suppress_audit='on'` GUC pattern from P29 (verified in `20270601200004_org_patient_invite_rpcs.sql`).
- **`BEFORE UPDATE` instead of `AFTER UPDATE` for trigger:** Always use `AFTER UPDATE` for `pg_notify`; notification is sent only when the triggering transaction commits.
- **Missing UNIQUE index before first matview REFRESH CONCURRENTLY:** Migration must create the UNIQUE index in the SAME migration as the matview DDL (not a later migration), because `REFRESH MATERIALIZED VIEW CONCURRENTLY` fails immediately if no unique index exists.
- **`now()` in matview SELECT:** Matviews snapshot data at refresh time; `now()` inside the view definition does NOT update at query time. Store `period_start`/`period_end` as computed values or track refresh timestamp externally.
- **Broadcasting from Edge Function via `pg_notify`:** Edge Functions run in Deno, not inside Postgres. Use `supabase.channel(name).send(...)` from supabase-js for realtime broadcasts from Edge Functions.
- **Direct `createClient(url, serviceRoleKey)` in Edge Fns:** ESLint `no-raw-service-role-client` blocks this. Always use `_createServiceRoleClientUnsafe()` from `_shared/supabase-server.ts`.
- **Using `memberships` table in new P30 code:** `rank_org_patients` uses the older `memberships` (Phase 9) table. New P30 tables use `org_patient_links` (Phase 28). Do not mix — new SECDEFs query `org_patient_links`; only the rank RPC extension continues to use `memberships` for the patient roster.

---

## Runtime State Inventory

This is a greenfield extension phase — not a rename/refactor. No runtime state migration needed.

However, note:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `org_settings` rows exist with no `ranking_weights` column yet | Column ADD migration (Plan 30-00); existing rows get NULL (fallback to hardcoded defaults) |
| Live service config | pg_cron job table will have new entries after migration push | No manual action; `cron.schedule` upserts by jobname |
| OS-registered state | None — no OS-level registrations | None |
| Secrets/env vars | `RESEND_API_KEY` + `RESEND_FROM` already set as Supabase Function secrets (P29 verified) | Reuse existing secrets; no new secrets needed for basic delivery |
| Build artifacts | No renamed packages | None |

**Vault secret for HMAC channel:** The `org_realtime_channel_secret` Vault key is already provisioned (Phase 28). The deliver-cron Edge Function needs to call `get_realtime_channel_keying()` RPC to retrieve it — same pattern as P29 stripe-webhook handler.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `pg_cron` | All scheduled jobs | Yes | built-in on project | — |
| `RESEND_API_KEY` (Function secret) | D-01 email delivery | Yes (P29 verified) | live | health-check no-op with warning |
| `org_realtime_channel_secret` (Vault) | D-06 + D-13 HMAC channels | Yes (P28 provisioned) | live | `channelNameFor` fallback returns non-HMAC name in test |
| `SENTRY_DSN` (Function secret) | Deliver-cron error tracking | Yes (P28 verified) | live | graceful no-op per sentry.ts |
| `supabase db query --linked` | Pre-migration schema verification | Yes | linked | — |

**Missing dependencies with no fallback:** None identified.

---

## Common Pitfalls

### Pitfall 1: `now()` in Matview SELECT

**What goes wrong:** Matview contains `now() - interval '7 days'` in SELECT. REFRESH CONCURRENTLY recomputes the view at refresh time, but the column values become stale between refreshes. More critically, if the matview definition references `now()` at definition time (not refresh time), the values are wrong.

**Why it happens:** Matviews snapshot the query result at creation/refresh time. `now()` inside a matview SELECT captures the timestamp at refresh time, not query time. This is actually correct behavior for a rolling 7-day window — but the `period_start`/`period_end` columns in the CONTEXT's proposed schema (D-15) will show stale values to queries between refreshes.

**How to avoid:** Remove `period_start`/`period_end` from the matview definition. Instead, add a separate `clinic_matview_refresh_log(view_name text, refreshed_at timestamptz)` table that the cron updates after each REFRESH. The UI reads `refreshed_at` from this table for the "Last: {relative time}" staleness caption.

**Warning signs:** UI shows "Updated 20 minutes ago" when it was just refreshed 1 minute ago.

### Pitfall 2: UNIQUE Index Before CONCURRENTLY Refresh

**What goes wrong:** `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_clinic_alert_metrics` fails with `ERROR: cannot refresh materialized view "public.mv_clinic_alert_metrics" concurrently` (requires at least one unique index).

**Why it happens:** Postgres requires a unique index to track which rows changed during the CONCURRENT refresh.

**How to avoid:** Create the UNIQUE index in the SAME migration as the `CREATE MATERIALIZED VIEW`. Do the initial population with a non-concurrent `REFRESH MATERIALIZED VIEW` before the first cron fires.

**Warning signs:** Cron job fails on first run after migration push.

### Pitfall 3: JSONB Weight Interpolation in EXECUTE Block

**What goes wrong:** Trying to use `v_weights::text` as a `%L` argument in `format($sql$...$sql$, ...)` inside `rank_org_patients` — the JSONB value with special characters corrupts the formatted SQL string.

**Why it happens:** The existing EXECUTE block uses `format()` for dynamic ORDER BY. Injecting a JSONB value as a literal requires quoting.

**How to avoid:** Before the EXECUTE block, extract the 4 scalar weight values into `numeric` variables:
```sql
v_w_dose_adherence := coalesce((v_weights->>'dose_adherence')::numeric, 0.28);
v_w_weight_loss    := coalesce((v_weights->>'weight_loss')::numeric, 0.15);
-- etc.
```
Then pass these scalars as `%L` arguments in the format string.

### Pitfall 4: Supabase Realtime Broadcast from Edge Fn vs pg_notify

**What goes wrong:** Attempting `perform pg_notify(...)` inside an Edge Function (Deno) — this is not possible. `pg_notify` is a Postgres function, not available in Deno.

**Why it happens:** The trigger pattern (D-06) uses `pg_notify` from PL/pgSQL. The deliver-cron (D-13) needs to broadcast from the Edge Function. These are two different mechanisms.

**How to avoid:**
- D-06 (settings change): use `pg_notify` inside the Postgres `AFTER UPDATE` trigger. Realtime forwards this as `postgres_changes` event.
- D-13 (alert delivery notification): use `supabase-js` client's `channel.send({ type: 'broadcast', event: 'new_alert', payload: {...} })` from the Edge Function.

### Pitfall 5: SECDEF `log_admin_action` vs Direct INSERT

**What goes wrong:** Calling `perform public.log_admin_action(...)` inside a Phase 30 SECDEF for a clinician-role action — `log_admin_action` requires the caller to have `admin` role in `profiles.admin_role` (platform admin), not org admin.

**Why it happens:** `log_admin_action` (Phase 24 Plan 24-05) is a platform-admin audit function, not an org-admin audit function.

**How to avoid:** Use direct `INSERT INTO public.audit_logs(...)` with `set local app.suppress_audit = 'on'` to prevent the audit trigger from firing recursively. This is the pattern used in `20270601200004_org_patient_invite_rpcs.sql` (P29).

### Pitfall 6: `memberships` vs `org_patient_links`

**What goes wrong:** New Phase 30 detection SQL queries `memberships` instead of `org_patient_links` to find patients for an org.

**Why it happens:** `rank_org_patients` uses `memberships` (Phase 9 table). Phase 28 introduced `org_patient_links` as the authoritative org-patient relationship table.

**How to avoid:** Detect-cron SQL uses `org_patient_links` (not `memberships`). The rank RPC extension continues using `memberships` for the patient roster join (do not change existing rank RPC joins).

### Pitfall 7: `app.suppress_audit` GUC in SECDEFs

**What goes wrong:** A SECDEF that INSERTs into `audit_logs` triggers the Phase 24 audit trigger on `audit_logs` itself, causing infinite recursion.

**Why it happens:** Phase 24 ships audit triggers on tables that write to `audit_logs`. The trigger checks `current_setting('app.suppress_audit', true) = 'on'`.

**How to avoid:** Add `perform set_config('app.suppress_audit', 'on', true);` before any direct `INSERT INTO audit_logs` inside a SECDEF.

---

## Code Examples

### Migration: ADD ranking_weights column to org_settings

```sql
-- Source: verified from 20270601100005_org_settings_table.sql + D-03
-- Migration: 20270601300001_org_settings_ranking_weights.sql

alter table public.org_settings
  add column if not exists ranking_weights jsonb null default null;

alter table public.org_settings
  add column if not exists dose_trend_thresholds jsonb null
    default '{"missed_doses_n":2,"window_days_m":14,"variance_pct_x":25}'::jsonb;

-- Validator function for ranking_weights shape (EXTENSION-CONTRACT §8 pattern)
create or replace function public._validate_ranking_weights(p_weights jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_sum numeric;
begin
  if p_weights is null then return; end if;  -- null = use defaults

  if not (
    (p_weights ? 'dose_adherence') AND
    (p_weights ? 'weight_loss') AND
    (p_weights ? 'activity') AND
    (p_weights ? 'symptoms')
  ) then
    raise exception 'ranking_weights must contain all 4 keys: dose_adherence, weight_loss, activity, symptoms'
      using errcode = 'P0001';
  end if;

  -- Each value in [0, 1]
  if (p_weights->>'dose_adherence')::numeric not between 0 and 1 or
     (p_weights->>'weight_loss')::numeric not between 0 and 1 or
     (p_weights->>'activity')::numeric not between 0 and 1 or
     (p_weights->>'symptoms')::numeric not between 0 and 1 then
    raise exception 'all ranking_weights values must be in range [0, 1]'
      using errcode = 'P0001';
  end if;

  v_sum := (p_weights->>'dose_adherence')::numeric
         + (p_weights->>'weight_loss')::numeric
         + (p_weights->>'activity')::numeric
         + (p_weights->>'symptoms')::numeric;

  if abs(v_sum - 1.0) > 0.001 then
    raise exception 'ranking_weights must sum to 1.0 (±0.001); got %', v_sum
      using errcode = 'P0001';
  end if;
end;
$$;

-- Trigger to validate on update
create or replace function public.org_settings_validate_ranking_weights()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  if (new.ranking_weights IS DISTINCT FROM old.ranking_weights) then
    perform public._validate_ranking_weights(new.ranking_weights);
  end if;
  return new;
end;
$$;

create trigger org_settings_ranking_weights_validate_trigger
  before insert or update of ranking_weights
  on public.org_settings
  for each row
  execute function public.org_settings_validate_ranking_weights();
```

### Migration: clinician_alerts table

```sql
-- Source: verified from CONTEXT D-09 + EXTENSION-CONTRACT §2 RLS template
-- Migration: 20270601300003_clinician_alerts.sql

create table if not exists public.clinician_alerts (
  id                  uuid        not null primary key default gen_random_uuid(),
  org_id              uuid        not null references public.organizations(id) on delete restrict,
  patient_user_id     uuid        not null references auth.users(id) on delete restrict,
  alert_type          text        not null check (alert_type in ('dose_adherence','dose_variance')),
  severity            smallint    not null default 1 check (severity in (1,2,3)),
  status              text        not null default 'pending'
                                  check (status in ('pending','acknowledged','snoozed','auto_resolved','delivery_failed')),
  threshold_snapshot  jsonb       not null,
  ack_by              uuid        null references auth.users(id) on delete set null,
  ack_at              timestamptz null,
  snooze_until        timestamptz null,
  retry_count         smallint    not null default 0,
  last_attempt_at     timestamptz null,
  debounce_key        text        not null,
  created_at          timestamptz not null default now(),
  auto_resolved_at    timestamptz null
);

create index if not exists clinician_alerts_org_id_idx on public.clinician_alerts(org_id);
create index if not exists clinician_alerts_status_idx on public.clinician_alerts(status) where status = 'pending';
create unique index if not exists clinician_alerts_debounce_uq on public.clinician_alerts(org_id, debounce_key);

alter table public.clinician_alerts enable row level security;
alter table public.clinician_alerts force row level security;

-- SELECT: org members (admins + clinicians) may read alerts for their org
create policy "clinician_alerts_select_by_org_members"
  on public.clinician_alerts
  for select
  using (public._is_org_admin(org_id, auth.uid()) or
         exists (select 1 from public.org_members om
                 where om.org_id = clinician_alerts.org_id
                   and om.user_id = auth.uid()
                   and om.role in ('admin','clinician')));

-- No INSERT/UPDATE/DELETE for authenticated — all via service_role (cron) or SECDEF RPCs
```

### Edge Function: deliver-cron structure

```typescript
// Source: verified pattern from supabase/functions/org-metered-billing-cron/index.ts
// Path: supabase/functions/clinician-alert-deliver-cron/index.ts

import { _createServiceRoleClientUnsafe } from '../_shared/supabase-server.ts';
import { channelNameFromSecret } from '../_shared/realtime.ts';
import * as Sentry from '../_shared/sentry.ts';

// Startup health check (per [[reference_vendor_gated_send_health_check]])
if (!Deno.env.get('RESEND_API_KEY')) {
  console.warn('[clinician-alert-deliver-cron] RESEND_API_KEY missing — email delivery disabled');
}

Deno.serve(async (_req) => {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const admin = _createServiceRoleClientUnsafe();

  // Fetch pending alerts WHERE retry_count < 3
  // deno-lint-ignore no-explicit-any
  const { data: pending, error } = await (admin as any)
    .from('clinician_alerts')
    .select('id, org_id, patient_user_id, alert_type, retry_count, debounce_key')
    .eq('status', 'pending')
    .lt('retry_count', 3)
    .or('last_attempt_at.is.null,last_attempt_at.lt.' + new Date(Date.now() - 20 * 60 * 1000).toISOString());

  if (error) {
    Sentry.captureException(error, { tags: { cron: 'clinician-alert-deliver' } });
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }

  // Per-alert try/catch — one failure does not abort the batch
  for (const alert of (pending ?? [])) {
    try {
      // (a) Realtime broadcast — get HMAC secret from RPC
      const { data: keyData } = await (admin as any).rpc('get_realtime_channel_keying', {
        p_org_id: alert.org_id,
      });
      const secretHex = keyData?.secret_hex;
      if (secretHex) {
        const channelName = await channelNameFromSecret(alert.org_id, 'alerts', secretHex);
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
        // Use supabase-js channel.send() for Edge-to-client broadcast
        const { createClient } = await import('npm:@supabase/supabase-js@2');
        const broadcastClient = createClient(supabaseUrl, anonKey);
        await broadcastClient.channel(channelName)
          .send({ type: 'broadcast', event: 'new_alert', payload: { alert_id: alert.id, alert_type: alert.alert_type } });
        // INSERT into clinician_alert_deliveries
        await (admin as any).from('clinician_alert_deliveries').insert({
          alert_id: alert.id, channel: 'realtime', success: true,
        });
      }

      // (b) Resend email — non-PHI template (D-02)
      if (resendKey && resendKey !== 'test-stub') {
        // Fetch org_name for email subject (org_id only — no patient data)
        // ... email dispatch (mirror clinic-patient-invite pattern) ...
        await (admin as any).from('clinician_alert_deliveries').insert({
          alert_id: alert.id, channel: 'email', success: true,
        });
      }

      // Update last_attempt_at + retry_count
      await (admin as any).from('clinician_alerts').update({
        retry_count: alert.retry_count + 1,
        last_attempt_at: new Date().toISOString(),
      }).eq('id', alert.id);

    } catch (err) {
      Sentry.captureException(err, {
        tags: { cron: 'clinician-alert-deliver', alert_id: alert.id },
      });
      // On 3rd retry failure, mark delivery_failed
      if (alert.retry_count + 1 >= 3) {
        await (admin as any).from('clinician_alerts')
          .update({ status: 'delivery_failed', retry_count: alert.retry_count + 1 })
          .eq('id', alert.id);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
```

### Browser hook: subscribe to settings channel for D-06

```typescript
// Source: verified pattern from use-roster-realtime.ts (Phase 10)
// New file: src/components/clinic/roster/use-org-settings-realtime.ts

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { channelNameFor } from '@/lib/org-realtime';  // browser-side HMAC helper (Phase 28)

export function useOrgSettingsRealtime({
  orgId,
  onWeightsChanged,
}: {
  orgId: string;
  onWeightsChanged: () => void;
}): void {
  useEffect(() => {
    if (!orgId) return;

    let channel: ReturnType<typeof supabase.channel>;

    channelNameFor(orgId, 'settings').then((topic) => {
      channel = supabase
        .channel(topic)
        // postgres_changes from pg_notify via AFTER UPDATE trigger
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'org_settings' },
          (payload) => {
            if ((payload.new as { org_id?: string }).org_id === orgId) {
              onWeightsChanged();
            }
          }
        )
        .subscribe();
    });

    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [orgId, onWeightsChanged]);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded rank weights in `rank_org_patients` | JSONB weights from `org_settings` with NULL-fallback to hardcoded | P30 (this phase) | Preserves Phase 10 contract; no breaking change |
| Phase 9 `memberships` as org-patient link | Phase 28 `org_patient_links` for clinic consent-based relationships | P28 | Detect-cron uses `org_patient_links`; rank RPC still uses `memberships` |
| Custom `_is_org_admin` helper (shipped P29) | Reuse `_is_org_admin` for P30 RLS policies | P29 shipped | No reimplementation needed; import the existing function |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Prescribed dose cadence is derivable from `vials` table (or similar) for adherence rule | D-07 adherence SQL | If no canonical schedule column exists, adherence rule must be simplified to "N injection days in M days" without reference to expected schedule |
| A2 | `vials.medication_name` column exists for `mv_clinic_dose_trend_population` | D-16 matview | Planner must verify exact column name; may be `vials.drug_name` or similar |
| A3 | `get_realtime_channel_keying` RPC is the established pattern for retrieving Vault secret in Edge Fns | D-06 / D-13 | Verified by reference to P29 stripe-webhook pattern; actual RPC name may differ — planner must grep migrations |
| A4 | `channelNameFor` from `src/lib/org-realtime.ts` (Phase 28 browser-side) is available and accepts `(orgId, suffix)` | D-06 browser hook | Phase 28 Plans 03-06 shipped this; verify import path |
| A5 | Org member `role` values include `'clinician'` in the `org_member_role` enum | RLS for clinician-role SELECT | Phase 28 shipped the enum; verify `'clinician'` is a valid value in `20270601100003_org_member_role_enum.sql` |
| A6 | `supabase-js` `channel.send()` from an Edge Function (not DB) correctly broadcasts to clients subscribed to the same HMAC channel name | D-13 deliver-cron | If HMAC auth validates on the subscriber side (not sender side), the broadcast should reach all org-authenticated subscribers regardless of who sends it |

---

## Open Questions (RESOLVED — verified 2026-05-17 via direct migration grep)

1. **RESOLVED — Prescribed dose schedule source for adherence rule (CLIN-02)**
   - **Verified 2026-05-17:** Neither `vials` nor `injections` tables ship a `prescribed_cadence_days` / `scheduled_injection_date` column. No prescribed-schedule source exists in v1.3.
   - **Outcome for planner:** Adherence rule simplifies to **"patient has < N injection-days in the past M days"** (GLP-1 weekly-dosing assumption baked into the threshold itself, not the SQL). v1.3 default thresholds (N=2 missed in M=14 days) interpret as "weekly cadence; missing 2 means roughly 2-week gap." Adherence SQL counts `count(distinct date_trunc('day', created_at))` over the window. NO need to join against a schedule column. Variance rule (D-07b) computes interval variance from `LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at)` — no schedule column required either.

2. **RESOLVED — `org_member_role` enum values: `('admin', 'staff', 'viewer')`**
   - **Verified 2026-05-17** via `supabase/migrations/20270601100003_org_member_role_enum.sql:create type public.org_member_role as enum ('admin', 'staff', 'viewer')`.
   - **Outcome for planner: `'clinician'` is NOT a valid enum value.** RLS policies must use **`'staff'`** as the clinician-role analog (`'staff'` is the customer-facing clinician role in Phase 28's role taxonomy; `'admin'` is org-admin). All references to `'clinician'` in this RESEARCH.md (notably the example RLS policy at line 783 `and om.role in ('admin','clinician')`) MUST be replaced with `'staff'` in actual implementation. Planner must thread `'staff'` through every SELECT policy, every SECDEF role-check, and every `_is_org_admin`-or-clinician helper.

3. **RESOLVED — Realtime channel keying = `public.get_realtime_secret()` SECDEF; client-side HMAC uses `channelNameFor(orgId, suffix)` from `_shared/realtime.ts` (Plan 29-03).**
   - **Verified 2026-05-17:** `supabase/migrations/20270601100015_get_realtime_secret_secdef_fn.sql:19` defines `create or replace function public.get_realtime_secret()` (no args). No `get_realtime_channel_keying` RPC exists.
   - **Outcome for planner:** Edge Functions that need the HMAC channel name call `channelNameFor(orgId, 'alerts')` / `channelNameFor(orgId, 'settings')` from `_shared/realtime.ts` directly — the Vault secret is fetched server-side by that helper (or its already-cached at module load). Replace the `(admin as any).rpc('get_realtime_channel_keying', ...)` pattern in RESEARCH line 825 with the simpler `channelNameFor(orgId, suffix)` import. The Plan 29-03 `_shared/realtime.ts` Deno helper is the canonical surface.

4. **RESOLVED — `_shared/email-router.ts` swap-in scope (no stub needed)**
   - P30 ships direct Resend dispatch matching Plan 29-05's `clinic-patient-invite` `sendEmail` pattern (or direct `fetch('https://api.resend.com/emails', ...)` if cleaner). Add inline TODO comment `// P25 close: swap for sendEmail({phi: false, ...}) from _shared/email-router.ts`. No interface stub needed. The PHI lint catches any regression on the no-PHI invariant.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 (RLS unit/e2e tests) + Playwright (realtime e2e) |
| Config file | `vitest-e2e.config.ts` (RLS), `playwright.config.ts` (e2e) |
| Quick run (RLS) | `npx vitest run src/lib/__tests__/rls-org-clinician-alerts.test.ts --config vitest-e2e.config.ts` |
| Full suite | `npx vitest run --config vitest-e2e.config.ts` |
| Playwright run | `npx playwright test e2e/clinician-alerts-realtime.spec.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLIN-01 | Clinic admin saves weights → roster reorders within 1s | Playwright e2e | `npx playwright test e2e/clinic-ranking-weights.spec.ts` | Wave 0 |
| CLIN-01 | Cross-tenant: User A cannot read/write `org_settings.ranking_weights` of Org Y | Vitest RLS | `npx vitest run src/lib/__tests__/rls-org-settings-weights.test.ts --config vitest-e2e.config.ts` | Wave 0 |
| CLIN-02 | Detect-cron inserts alert on threshold breach; ON CONFLICT DO NOTHING dedupes | Vitest unit (SQL function via RPC) | `npx vitest run src/lib/__tests__/clinician-alert-detect.test.ts --config vitest-e2e.config.ts` | Wave 0 |
| CLIN-03 | `clinician_alerts` cross-tenant isolation (Org A cannot read Org B alerts) | Vitest RLS | `npx vitest run src/lib/__tests__/rls-org-clinician-alerts.test.ts --config vitest-e2e.config.ts` | Wave 0 |
| CLIN-03 | Deliver-cron Resend dispatch (non-PHI; no patient name in subject/body) | Vitest unit (Edge Fn __internal.handle mock) | `npx vitest run supabase/functions/clinician-alert-deliver-cron/index.test.ts` | Wave 0 |
| CLIN-04 | Debounce UNIQUE: second INSERT for same alert_type+patient+day is silently ignored | Vitest unit (SQL) | Covered by CLIN-02 test | — |
| CLIN-04 | Retry: deliver-cron bumps retry_count; sets delivery_failed on 3rd failure | Vitest unit (Edge Fn mock) | Covered by CLIN-03 test | — |
| CLIN-05 | `mv_clinic_alert_metrics` returns correct ack_rate_pct | Vitest unit (SQL via admin client) | `npx vitest run src/lib/__tests__/mv-clinic-alert-metrics.test.ts --config vitest-e2e.config.ts` | Wave 0 |
| CLIN-06 | `acknowledge_clinician_alert` SECDEF transitions status; cross-org denied | Vitest RLS | Covered by CLIN-03 test | — |
| CLIN-06 | Auto-resolve SQL: pending alerts > 7d without snooze → auto_resolved | Vitest unit (SQL) | `npx vitest run src/lib/__tests__/clinician-alert-auto-resolve.test.ts --config vitest-e2e.config.ts` | Wave 0 |
| CLIN-07 | `org_patient_thresholds` cross-tenant isolation | Vitest RLS | `npx vitest run src/lib/__tests__/rls-org-patient-thresholds.test.ts --config vitest-e2e.config.ts` | Wave 0 |
| CLIN-08 | `mv_clinic_dose_trend_population` returns correct patient counts | Vitest unit (SQL) | `npx vitest run src/lib/__tests__/mv-clinic-dose-trend-population.test.ts --config vitest-e2e.config.ts` | Wave 0 |
| SC#1 | Realtime: weights save → `org-{hmac8}-settings` broadcast → RosterTable refresh ≤ 1s | Playwright e2e | `npx playwright test e2e/clinic-ranking-weights.spec.ts` | Wave 0 |
| SC#3 | Realtime: alert → `org-{hmac8}-alerts` broadcast → ClinicianAlertsPanel bell badge updates | Playwright e2e | `npx playwright test e2e/clinician-alerts-realtime.spec.ts` | Wave 0 |
| SC#4 | Status badge visual states: pending/snoozed/acknowledged/auto_resolved/delivery_failed render correctly | Vitest (React Testing Library snapshot) | `npx vitest run src/components/clinic/alerts/ClinicianAlertsPanel.test.tsx` | Wave 0 |

### Realtime e2e Pattern (per [[feedback_realtime_layer_e2e_pattern]])

```typescript
// Playwright drives the trigger:
// 1. Admin saves ranking weights in ClinicRankingWeightsForm
// 2. Assert RosterTable refreshes within 1s (row order changes)
// For alerts:
// 1. Seed a clinician_alerts row via admin client (simulate detect-cron)
// 2. Playwright-dispatch deliver-cron (call Edge Fn directly)
// 3. Assert ClinicianAlertsPanel bell count updates + alert appears in panel
// receiving client: instantiate supabase-js channel.subscribe() directly in test file
```

### Sampling Rate

- **Per task commit:** Run the relevant `__tests__` file for that task's table/function
- **Per wave merge:** Full `npx vitest run --config vitest-e2e.config.ts`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/lib/__tests__/rls-org-clinician-alerts.test.ts` — cross-tenant isolation for `clinician_alerts`
- [ ] `src/lib/__tests__/rls-org-patient-thresholds.test.ts` — cross-tenant isolation for `org_patient_thresholds`
- [ ] `src/lib/__tests__/rls-org-settings-weights.test.ts` — extend existing `rls-org-settings` or create sibling
- [ ] `src/lib/__tests__/clinician-alert-detect.test.ts` — detect SQL logic (threshold breach + dedup)
- [ ] `src/lib/__tests__/clinician-alert-auto-resolve.test.ts` — auto-resolve + snooze-resume SQL
- [ ] `src/lib/__tests__/mv-clinic-alert-metrics.test.ts` — matview correctness
- [ ] `src/lib/__tests__/mv-clinic-dose-trend-population.test.ts` — matview correctness
- [ ] `supabase/functions/clinician-alert-deliver-cron/index.test.ts` — Edge Fn unit test (Resend mock + RLS)
- [ ] `e2e/clinic-ranking-weights.spec.ts` — weights save → roster reorder ≤ 1s
- [ ] `e2e/clinician-alerts-realtime.spec.ts` — alert delivery → panel update
- [ ] Framework install: not needed (Vitest + Playwright already configured)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | All actions gated by existing org membership (JWT + SECDEF re-check) |
| V3 Session Management | No | Uses existing Supabase Auth sessions |
| V4 Access Control | Yes | Pattern S1 dual-layer: client gate + SECDEF re-check; `_is_org_admin` RLS helper |
| V5 Input Validation | Yes | JSONB shape validation via `_validate_ranking_weights` trigger; threshold min/max in UI |
| V6 Cryptography | Partial | HMAC channel auth (already Phase 28 standard); no new crypto hand-rolled |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant alert read (Org A reads Org B alerts) | Information Disclosure | `_is_org_admin` RLS + `org_id` filter; cross-tenant Vitest proof test |
| PHI leak in alert email | Information Disclosure | D-02 strict non-PHI template; D-18 CI lint; `RESEND_FROM` domain verified |
| Fake alert injection via direct INSERT | Tampering | RLS deny-all INSERT for `authenticated`; only service_role (cron) can INSERT |
| Debounce bypass (submitting alert twice) | Tampering | UNIQUE `(org_id, debounce_key)` at DB level; ON CONFLICT DO NOTHING |
| HMAC channel spoofing (subscribe to other org's alerts channel) | Spoofing | `realtime_topic_authorized` SECDEF validates HMAC + JWT org_ids claim |
| Arbitrary snooze duration (bypassing preset-only UI) | Tampering | `snooze_clinician_alert` SECDEF validates duration against allowed set |
| Weight manipulation (sum ≠ 1.0 bypass) | Tampering | `_validate_ranking_weights` BEFORE UPDATE trigger; client-side disabled Save also |

---

## Sources

### Primary (HIGH confidence)

- Codebase: `supabase/migrations/20260901000003_rank_org_patients_rpc.sql` — exact SECDEF structure for extension
- Codebase: `supabase/functions/org-metered-billing-cron/index.ts` — two-cron Edge Fn pattern
- Codebase: `supabase/functions/_shared/realtime.ts` — `channelNameFor` / `channelNameFromSecret` API
- Codebase: `supabase/migrations/20270601200003_org_patient_invites.sql` — `_is_org_admin` SECDEF helper
- Codebase: `supabase/migrations/20270601100005_org_settings_table.sql` — org_settings table to extend
- Codebase: `supabase/migrations/20270601000008_user_activity_daily_matview.sql` — CONCURRENTLY matview pattern
- Codebase: All 19 cron migration files — verified complete schedule map for D-17 collision audit

### Secondary (MEDIUM confidence)

- `30-CONTEXT.md` D-01..D-18 locked decisions — all research scoped to these
- `30-UI-SPEC.md` — component/interaction contracts (bell-icon panel, snooze popover, stat cards)
- `28-EXTENSION-CONTRACT.md` — BLOCKERs R1-R5 apply to all 3 new org-scoped tables
- `29-CONTEXT.md` D-05/D-11/D-12 — HMAC channel + PHI lint + two-cron patterns

### Tertiary (LOW confidence — marked [ASSUMED])

- A1: Prescribed dose cadence derivable from `vials` table — needs planner schema verification
- A2: `vials.medication_name` column name — needs planner verification
- A3: `get_realtime_channel_keying` RPC name — verify against `20270601100015_get_realtime_secret_secdef_fn.sql`

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all tools are verified in existing codebase (P28/P29 patterns)
- Architecture: HIGH — trigger DDL, two-cron, matview patterns all verified against existing migrations
- Cron collision audit: HIGH — enumerated all 19 existing jobs from migration files; no assumed schedules
- Dose-trend SQL patterns: MEDIUM — LAG/STDDEV_POP is standard SQL but prescribed_cadence_days column is [ASSUMED]
- Matview schema: MEDIUM — `period_start`/`period_end` pitfall identified; `medication_name` column [ASSUMED]

**Research date:** 2026-05-17
**Valid until:** 2026-06-17 (schema is stable; D-17 cron slots valid until new phases add crons)
