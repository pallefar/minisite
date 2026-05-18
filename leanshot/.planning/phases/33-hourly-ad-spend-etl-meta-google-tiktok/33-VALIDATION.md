---
phase: 33-hourly-ad-spend-etl-meta-google-tiktok
date: 2026-05-18
status: derived-from-research
source: 33-RESEARCH.md §Validation Architecture
---

# Phase 33 — Validation Strategy

Test architecture for Phase 33 (Hourly Ad-Spend ETL — Meta + Google + TikTok). Mirrors and consolidates the test map embedded in `33-RESEARCH.md` so Nyquist validation can audit coverage independently of RESEARCH.md prose.

## Dimensions

### D1 — Schema Correctness (Wave 1)
- Migration apply order produces no errors on a fresh project (verified by `supabase db push --linked --dry-run` + `--dry-run` log absence of `^Skipping`).
- All 7 tables + 1 matview + cursor table create with the declared RLS policies (verified by 51-deny RLS test from Plan 33-05 + schema-shape integration test from Plan 33-01 SUMMARY task).
- `ad_revenue_normalized` matview has a unique index BEFORE first `REFRESH ... CONCURRENTLY` attempt (verified by migration 08 contents — index DDL precedes matview DDL).
- Partition pruning cron (`ad_spend_facts_drop_old_partitions`) is registered + idempotent (verified by `SELECT jobname FROM cron.job WHERE jobname='ad_spend_facts_drop_old_partitions'`).

### D2 — ETL Idempotency (Wave 2)
- TikTok 168h replay window + Meta+Google 72h replay window honored per D-04 (verified by `upsertAdSpendFacts` unit test — same rows inserted twice → 1 row; same rows with updated spend → row updated, not duplicated).
- ON CONFLICT (network, ad_account_id, ad_id, hour_bucket) DO UPDATE preserves history correctness across re-syncs (verified by integration test asserting `updated_at` advances but `created_at` does not on second upsert).
- ETL never inserts a row with `spend_date` outside the active partition window (verified by `pg_partman`-style boundary test).

### D3 — Vendor-gated Health-Check (Wave 2, Pattern S4)
- Each of `ad-spend-cron-meta/google/tiktok` returns 200 + writes `ad_etl_health` row with `credentials_present=false` when secrets absent (verified by Deno test mocking missing env).
- Same Edge Fn returns 200 + writes `last_success_at` when secrets present + API call mocked successful (Deno test).
- `cron.job` rows for all 3 ETLs are `active=true` regardless of credential state (verified by post-push DB query).

### D4 — FX Normalization (Wave 2)
- ECB cron parses XML correctly on weekday data (Deno test with frozen XML fixture).
- Weekend/holiday: cron writes nothing new but ETLs use last-known rate via `lookupFxRate` (Deno test).
- Missing FX row → `spend_usd_at_spend_date = NULL` + gap-detection flags the gap (integration test).

### D5 — Gap Detection + Backfill (Wave 1 + 2)
- `public.run_ad_etl_gap_detection()` SECDEF function correctly computes expected (active_ad_accounts × 24) vs actual count for `yesterday` (SQL unit test or live-DB smoke).
- `ad_etl_gap_detect` cron writes `ad_etl_gaps` rows + `writeAdminNotification` is invoked (integration test).
- `public.trigger_ad_etl_backfill(p_network, p_date)` SECDEF RPC: gates on `is_admin(auth.uid())`, then calls pg_net.http_post to the ETL Edge Fn with service-role bearer (SQL test + RLS denial test for non-admin caller).
- Admin SPA Backfill button calls `supabase.rpc('trigger_ad_etl_backfill', ...)` and succeeds (Playwright e2e in Plan 33-05).

### D6 — AEM Register + Meta CAPI Relay (Wave 2)
- EventDef extension (events.ts) keeps the additive-only ESLint rule green: removing a field or changing a type still BLOCKS, but adding `aem_priority?` / `aem_dropped?` PASSES (Plan 33-02 ESLint self-test).
- New ESLint rule blocks adding `aem_priority` to any event with `phi: true` (rule unit test).
- `meta-capi-relay` reads `events_mirror` rows where `event_name IN (aem-priority-list)`, posts hashed user_data (Deno test with mocked Meta CAPI endpoint).
- Runtime PHI guard: if a PHI-flagged event somehow reaches the relay → throws + logs + never POSTs (Deno test).
- Cursor advances correctly via `etl_cursors` table; relay is resumable after isolate restart (integration test).

### D7 — CAC Alert + Threshold (Wave 2 + 3)
- `cac-alert-cron` reads 7d rolling CAC from `ad_revenue_normalized` (Deno test with seeded matview).
- Threshold breach condition (7d_cac > target_ltv × cac_multiplier) inserts one `cac_alerts` row + writes admin notification + emits `cac_target_breached` PostHog event (Deno + integration test).
- Idempotency: re-running cron for the same (source, date) does NOT duplicate alerts (DB UNIQUE constraint test).
- Admin UI surfaces the breach within 1 dashboard load (Playwright e2e).

### D8 — Admin Dashboard UI (Wave 3)
- CAC dashboard renders without TS errors (build green).
- Loading / empty / error states render correctly (vitest component test if vitest config present; otherwise documented in `deferred-tests.md`).
- Drill-down drawer expands per-source → per-campaign → per-creative (Playwright e2e).
- CSV export button produces valid CSV from current matview rows (Playwright e2e).
- 51-deny RLS test: non-admin authenticated user cannot SELECT from any of the 7 new tables (vitest RLS integration suite).

## Coverage Matrix

| REQ | Validation dimension(s) |
|-----|-------------------------|
| ADETL-01 (Meta ETL) | D2, D3 |
| ADETL-02 (Google ETL) | D2, D3 |
| ADETL-03 (TikTok ETL) | D2, D3 |
| ADETL-04 (ad_revenue_normalized matview) | D1, D7, D8 |
| ADETL-05 (gap detection + admin notification) | D5, D8 |
| ADETL-06 (idempotent 72h/168h re-sync) | D2 |
| ADETL-07 (CAC dashboard + alerts) | D7, D8 |
| ADETL-08 (creative-level attribution) | D6, D8 |
| ADETL-09 (FX rates + ECB + USD normalization) | D4 |

## Production smoke (post-phase-ship, founder action)

1. `npx --prefix leanshot supabase db query --linked "SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'ad_%' OR jobname LIKE 'cac_%' OR jobname LIKE 'fx_%';"` → 6 active rows.
2. Manual trigger `ad-spend-cron-meta` with no credentials → returns 200 + `ad_etl_health` row updates with `credentials_present=false`.
3. Set Meta secrets via `supabase secrets set` → manual trigger again → returns 200 + `ad_spend_facts` rows appear within 1 minute.
4. Admin loads `/admin/growth/cac` → CAC cards render + Backfill button enabled when a gap exists.

## Deferred test items

Any vitest-required tests that cannot run (no vitest config present per CLAUDE.md analysis) are routed to `.planning/deferred-tests.md` per the project's defer-then-batch-fix pattern.
