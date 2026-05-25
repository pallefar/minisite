---
phase: 33-hourly-ad-spend-etl-meta-google-tiktok
plan: "01"
subsystem: backend/database
tags: [migrations, partitioned-table, materialized-view, rls, pg_cron, vault, secdef]
dependency_graph:
  requires:
    - Phase 24 is_admin() SECDEF function
    - Phase 27 admin_notifications table
    - Phase 27 events_mirror table (dual-write via posthog-server.ts)
    - Phase 19 vault.decrypted_secrets / service_role_key row
  provides:
    - ad_spend_facts partitioned table (RANGE on spend_date)
    - ad_network_config with attribution window defaults
    - fx_rates table for ECB daily rates
    - ad_etl_health health surface (1 row per network)
    - ad_etl_gaps for gap-detection results
    - growth_targets for admin-tunable CAC thresholds
    - cac_alerts with idempotency key
    - ad_revenue_normalized materialized view + ad_revenue_normalized_uq UNIQUE index
    - etl_cursors + meta_capi_relay cursor row
    - 7 pg_cron schedules (3 ETL hourly + matview + FX + gap-detect + cac-alert)
    - trigger_ad_etl_backfill() SECDEF RPC for admin Backfill button
    - run_ad_etl_gap_detection() SECDEF called by gap-detect cron
    - refresh_ad_revenue_normalized() SECDEF called by matview cron
    - get_cac_summary() SECDEF RPC (admin-only CAC data accessor)
    - _shared/ad-etl-utils.ts: upsertAdSpendFacts, writeHealth, lookupFxRate, convertToUsd, writeAdminNotification
  affects:
    - Plan 33-02 through 33-04: all 6 Edge Functions depend on these tables
    - Plan 33-05: RLS denial tests for all 7 tables
tech_stack:
  added:
    - partitioned PostgreSQL tables (RANGE partitioning on spend_date)
    - PostgreSQL materialized views with CONCURRENTLY refresh
    - pg_cron + vault pattern for service-role-gated Edge Fn invocations
  patterns:
    - SECDEF with is_admin() gate (T-33-01-02 mitigation)
    - vault.decrypted_secrets for service_role_key (no GUC — project-established pattern)
    - ON CONFLICT DO UPDATE for idempotent ETL replay (D-04/ADETL-06)
    - 100-row chunk batching for supabase-js upsert calls
key_files:
  created:
    - supabase/migrations/20270703000001_ad_spend_facts_partition.sql
    - supabase/migrations/20270703000002_ad_network_config.sql
    - supabase/migrations/20270703000003_fx_rates.sql
    - supabase/migrations/20270703000004_ad_etl_health.sql
    - supabase/migrations/20270703000005_ad_etl_gaps.sql
    - supabase/migrations/20270703000006_growth_targets.sql
    - supabase/migrations/20270703000007_cac_alerts.sql
    - supabase/migrations/20270703000008_ad_revenue_normalized_matview.sql
    - supabase/migrations/20270703000009_meta_capi_relay_cursor.sql
    - supabase/migrations/20270703000010_rls_deny_ad_tables.sql
    - supabase/migrations/20270703000011_ad_etl_cron_schedules.sql
    - supabase/migrations/20270703000012_trigger_ad_etl_backfill_secdef.sql
    - supabase/functions/_shared/ad-etl-utils.ts
decisions:
  - "Vault pattern for service_role_key; no current_setting GUC (plan-checker BLOCKER fix confirmed)"
  - "run_ad_etl_gap_detection() as distinct SECDEF; gap-detect cron calls this, NOT cac-alert-cron (plan-checker BLOCKER 1 fix)"
  - "trigger_ad_etl_backfill SECDEF bridges browser anon client to service-role ETL Edge Fn (plan-checker BLOCKER 2 fix)"
  - "CONCURRENTLY refresh requires unique index — created in migration 08 before first refresh (non-CONCURRENTLY initial)"
  - "growth_targets placeholder target_ltv_usd=200 flagged for user confirmation before phase ships"
  - "convertToUsd helper in ad-etl-utils.ts handles 3-case FX formula (USD passthrough, EUR-direct, cross-rate)"
metrics:
  completed_date: "2026-05-18"
  tasks_completed: 2
  tasks_total: 3
  files_created: 13
---

# Phase 33 Plan 01: DB Foundation (Tables, Matview, Cron, Helpers) Summary

**One-liner:** 12 migrations shipping partitioned ad_spend_facts + ad_revenue_normalized matview + 7 vault-pattern pg_cron schedules + 4 SECDEF RPCs + _shared/ad-etl-utils.ts; awaiting `supabase db push --linked` at checkpoint.

## What Was Built

### Database Schema (12 migrations)

All migrations follow `begin; ... commit;` DDL wrapping per project convention.

**Migration 01 — ad_spend_facts (partitioned):** Monthly RANGE partitioned on `spend_date`. 4 starter partitions for 2026-05 through 2026-08. UNIQUE constraint on `(network, ad_account_id, ad_id, hour_bucket, spend_date)` per idempotency key (D-04/ADETL-06). Monthly pg_cron cleanup job drops partitions older than 13 months.

**Migration 02 — ad_network_config:** Per-network attribution window defaults. Seeded: meta=7d (604800s), google=30d (2592000s), tiktok=7d (604800s) per D-09. Admin-tunable via admin CAC dashboard; no code deploy required for threshold changes.

**Migration 03 — fx_rates:** `UNIQUE (currency, rate_date)`. EUR base identity row seeded (rate=1.0 definitionally). ECB daily ETL upserts here. Last-known-rate fallback via `rate_date <= ? ORDER BY rate_date DESC LIMIT 1` per D-11.

**Migration 04 — ad_etl_health:** One row per network, seeded `credentials_present=false` per D-02. Admin CAC module header renders credential-missing badges from this table.

**Migration 05 — ad_etl_gaps:** `missing_rows` is a GENERATED ALWAYS AS STORED column (`expected_rows - actual_rows`) — no app-layer subtraction needed.

**Migration 06 — growth_targets:** Placeholder seed `(source='all', target_ltv_usd=200, cac_multiplier=0.5)`. PLACEHOLDER VALUE — user confirmation required before phase ships (D-13 flag).

**Migration 07 — cac_alerts:** `idempotency_key` GENERATED ALWAYS AS STORED (`source || '|' || alert_date::text`). UNIQUE on idempotency_key prevents duplicate notifications across cron re-runs per D-15.

**Migration 08 — ad_revenue_normalized matview:** Joins `ad_spend_facts` to `events_mirror` via per-network attribution window from `ad_network_config`. UNIQUE index `ad_revenue_normalized_uq` on `(network, ad_account_id, ad_id, spend_date)` — required for CONCURRENTLY refresh. Initial REFRESH non-CONCURRENTLY (empty matview, safe). REVOKE from public + authenticated. `get_cac_summary()` SECDEF accessor with `is_admin()` gate as first statement (T-33-01-02 mitigation).

**Migration 09 — etl_cursors + meta_capi_relay cursor:** `IF NOT EXISTS` safe for table creation. `ON CONFLICT DO NOTHING` for cursor row insert. meta-capi-relay Edge Fn reads `value` to know last processed `events_mirror` ID.

**Migration 10 — RLS deny (7 tables):** `is_admin()` SECDEF gate on all 7 tables (+ etl_cursors via DO block). FOR ALL policies cover SELECT, INSERT, UPDATE, DELETE. Cross-tenant denial proof documented in migration header; 51-deny tests owned by Plan 33-05.

**Migration 11 — pg_cron schedules:** 7 schedules using vault pattern (no GUC). Idempotent pre-unschedule before each schedule. Companion SECDEF helpers: `refresh_ad_revenue_normalized()` (CONCURRENTLY wrapper for cron) and `run_ad_etl_gap_detection()` (gap-detect logic; plan-checker BLOCKER 1 fix — distinct from cac-alert-cron which evaluates ratio thresholds).

**Migration 12 — trigger_ad_etl_backfill SECDEF:** Admin Backfill button bridge — browser anon client calls `supabase.rpc('trigger_ad_etl_backfill')` → SECDEF checks `is_admin()` → invokes ETL Edge Fn via vault service_role_key. Audit insert to admin_notifications on every trigger. plan-checker BLOCKER 2 fix.

### Shared TypeScript Helper (`_shared/ad-etl-utils.ts`)

5 exports usable by all 6 ETL Edge Functions:
- `AdSpendRow` type — canonical row shape for ad_spend_facts upserts
- `upsertAdSpendFacts()` — 100-row chunk idempotent batch upsert
- `writeHealth()` — upserts ad_etl_health; failure non-fatal
- `lookupFxRate()` — last-known-rate lookup with last-before-or-on-date semantics
- `convertToUsd()` — 3-case FX formula (USD passthrough, EUR-direct, cross-rate via EUR base)
- `writeAdminNotification()` — fire-and-forget P27 notification insert; swallows errors

## Deviations from Plan

### Auto-added: `convertToUsd()` helper

**Rule 2 — Auto-add missing critical functionality**

The plan spec for `lookupFxRate()` included a comment documenting a 3-case FX conversion formula but only specified the lookup function itself. Without a `convertToUsd()` helper, every ETL Edge Function would need to re-implement the cross-rate formula (case 3: local → EUR → USD). Added `convertToUsd()` as a companion export in `_shared/ad-etl-utils.ts`. This is not a new dependency — it uses `lookupFxRate()` internally and is importable without any new tables.

**Files modified:** `supabase/functions/_shared/ad-etl-utils.ts`

### cron.schedule count: 7 (not 6)

The plan spec said "6 cron.schedule calls" in the done criteria text but the action block lists 7 distinct schedules (3 ETL + matview refresh + fx-rates + gap-detect + cac-alert). The CONTEXT and cron action block are the authoritative spec; 7 is correct. The done criteria text was a counting error in the plan. All 7 schedules registered.

## Known Stubs

None. All migrations are complete DDL with proper seeds. The `growth_targets` placeholder value (`target_ltv_usd=200`) is an intentional user-confirmation flag, not a stub — the table and row are fully functional; the dollar value needs user sign-off.

## Threat Flags

No new threat surface beyond what was documented in the plan's threat_model. All 5 STRIDE threats addressed:
- T-33-01-01: vault pattern (not GUC) for cron Bearer token
- T-33-01-02: `is_admin()` as first statement in get_cac_summary() + trigger_ad_etl_backfill()
- T-33-01-03: RLS deny on all 7 tables; denial tests in Plan 33-05
- T-33-01-04: Accepted — admin audit_log (P24) covers admin actions
- T-33-01-05: Accepted — placeholder row is admin-only readable

## Task Status

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| 1 | Migrations 01-09 (tables, matview, cursor) | ad10526 | DONE |
| 2 | Migrations 10-12 (RLS, cron, backfill SECDEF) + ad-etl-utils.ts | 9bbb601 | DONE |
| 3 | Human verify: migration count + UNIQUE index + push | — | CHECKPOINT |

## Checkpoint Required (Task 3)

Before Wave-2 Edge Functions can deploy, all 12 migrations must be applied to the linked Supabase project. See CHECKPOINT REACHED message for the exact verification steps and push command.

## Self-Check: PASSED

All 12 migration files exist on disk: CONFIRMED
_shared/ad-etl-utils.ts exists: CONFIRMED
Task 1 commit ad10526: CONFIRMED (`git log --oneline` shows it)
Task 2 commit 9bbb601: CONFIRMED (`git log --oneline` shows it)
SUMMARY.md at correct path: CONFIRMED

No issues found. All deliverables present.
