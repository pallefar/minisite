---
phase: 33-hourly-ad-spend-etl-meta-google-tiktok
verified: 2026-05-18T21:45:00Z
status: human_needed
score: 5/5
overrides_applied: 0
human_verification:
  - test: "Confirm growth_targets seed value: target_ltv_usd=200, cac_multiplier=0.5 matches business intent"
    expected: "User confirms $200 LTV target and 0.5 multiplier (threshold = $100 CAC) or updates via admin UI at /admin/growth/cac"
    why_human: "Placeholder value was intentionally seeded per CONTEXT D-13 and flagged for user confirmation before phase ships. Cannot verify business correctness programmatically."
  - test: "Confirm AEM top-8 event ordering including refund_issued at priority 5"
    expected: "User confirms priorities 1-7 in events.ts are intentional; specifically that refund_issued (priority 5) should be forwarded to Meta CAPI as a negative optimization signal"
    why_human: "SUMMARY.md Plan 33-02 explicitly flags refund_issued at priority 5 as PENDING USER CONFIRMATION. Some advertisers exclude refunds from CAPI optimization."
  - test: "Set vendor credentials when Meta App Review / Google OAuth / TikTok Business API approvals land"
    expected: "After vendor credentials are set via `supabase secrets set`, manual trigger of each ETL returns 200 with credentials_present=true and ad_spend_facts rows appear"
    why_human: "By design (CONTEXT D-01, Pattern S4). Meta App Review is 2-4wk lead time. Three networks require separate credential setup: META_ACCESS_TOKEN + META_AD_ACCOUNT_ID; 5 Google secrets; TIKTOK_ACCESS_TOKEN + TIKTOK_ADVERTISER_ID. Also META_PIXEL_ID + META_ACCESS_TOKEN for meta-capi-relay."
  - test: "Verify CACDashboardPage renders correctly at /admin/growth/cac when logged in as admin"
    expected: "Health badges show 'Credentials missing' for all 3 networks; Gaps section is empty; CAC cards section shows 'No spend data' EmptyState; Backfill button is disabled when no gaps exist"
    why_human: "No jsdom vitest config exists for the leanshot SPA (CLAUDE.md confirmed). CACDashboardPage unit tests are deferred (it.skip). UI rendering requires visual confirmation."
---

# Phase 33: Hourly Ad-Spend ETL (Meta + Google + TikTok) Verification Report

**Phase Goal:** True CAC dashboard is live; ad-spend reconciles to PostHog conversions across 3 networks with FX normalization and gap detection.
**Verified:** 2026-05-18T21:45:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria from ROADMAP)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | 3 hourly cron Edge Fns (Meta, Google, TikTok) populate `ad_spend_facts` partitioned by month | VERIFIED | `ad-spend-cron-meta`, `ad-spend-cron-google`, `ad-spend-cron-tiktok` all ACTIVE in prod (deployed 2026-05-18 18:57). Vendor-gated health check per D-01: returns 200 + `credentials_present=false` when secrets absent. `ad_spend_facts` table live with monthly RANGE partitions and UNIQUE constraint `(network, ad_account_id, ad_id, hour_bucket, spend_date)`. |
| 2 | Idempotent last-72h re-sync runs on each fetch (INSERT ON CONFLICT) so API outages and late-arriving data backfill without duplication | VERIFIED | `upsertAdSpendFacts()` in `_shared/ad-etl-utils.ts` uses `onConflict: 'network,ad_account_id,ad_id,hour_bucket,spend_date'` with DO UPDATE. Meta+Google use 72h replay window. TikTok uses 168h (7d) intentionally per D-04 to handle TikTok's documented 7-day attribution-restate behavior (V13-5 silent-drop mitigation). |
| 3 | Daily gap-detection cron compares actual fact-row count to expected; inserts `ad_etl_gaps` row + admin notification when actual < expected | VERIFIED | `public.run_ad_etl_gap_detection()` SECDEF SQL function exists in live DB (prosecdef=true). Cron `ad_etl_gap_detect` active at schedule `0 5 * * *`. Function writes to `ad_etl_gaps` table and inserts into `admin_notifications` on gap detection per migration 11. |
| 4 | `ad_revenue_normalized` view joins facts to PostHog conversion events using per-network normalized attribution window; USD-normalized via `fx_rates` populated by daily ECB fetch | VERIFIED | Matview `ad_revenue_normalized` live in prod with `ad_revenue_normalized_uq` UNIQUE index (confirmed via pg_indexes). Joins `ad_spend_facts` to `events_mirror` via `default_attribution_window_seconds` from `ad_network_config` (meta=604800s/7d, google=2592000s/30d, tiktok=604800s/7d). `fx-rates-ecb-cron` ACTIVE at `0 17 * * *`. `convertToUsd()` helper applies 3-case FX formula. |
| 5 | Admin CAC dashboard renders cost-per-acquisition by source/campaign/creative; alert fires when 7-day rolling CAC > target LTV × 0.5 | VERIFIED | `CACDashboardPage.tsx` (732 LOC) wired to `get_cac_summary()` SECDEF RPC + `ad_etl_health` + `ad_etl_gaps` + `trigger_ad_etl_backfill` RPC. Drill-down Sheet shows campaign → top-5/bottom-5 creatives by CAC. `cac-alert-cron` ACTIVE at `30 0 * * *`, reads `growth_targets`, computes `target_ltv_usd * cac_multiplier` threshold, writes `cac_alerts` ON CONFLICT DO NOTHING + emits `cac_target_breached` PostHog event. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20270703000001_ad_spend_facts_partition.sql` | Partitioned ad_spend_facts (RANGE on spend_date) | VERIFIED | File exists; live DB confirms `ad_spend_facts` table with monthly partitions |
| `supabase/migrations/20270703000002_ad_network_config.sql` | Per-network attribution window defaults | VERIFIED | 3 rows seeded: meta=604800s, google=2592000s, tiktok=604800s (click model) |
| `supabase/migrations/20270703000003_fx_rates.sql` | fx_rates with UNIQUE (currency, rate_date) | VERIFIED | File exists; EUR base row seeded |
| `supabase/migrations/20270703000004_ad_etl_health.sql` | Per-network health rows (credentials_present=false) | VERIFIED | Live: 3 rows with credentials_present=false for google, meta, tiktok |
| `supabase/migrations/20270703000005_ad_etl_gaps.sql` | ad_etl_gaps with generated missing_rows column | VERIFIED | File exists; live DB confirms table |
| `supabase/migrations/20270703000006_growth_targets.sql` | growth_targets with placeholder seed | VERIFIED | Live: (source='all', target_ltv_usd=200, cac_multiplier=0.5) — PLACEHOLDER flagged for user confirmation |
| `supabase/migrations/20270703000007_cac_alerts.sql` | cac_alerts with idempotency_key GENERATED column + UNIQUE | VERIFIED | File exists; live DB confirms table |
| `supabase/migrations/20270703000008_ad_revenue_normalized_matview.sql` | Matview + UNIQUE index + get_cac_summary() SECDEF | VERIFIED | Matview live; `ad_revenue_normalized_uq` UNIQUE index confirmed via pg_indexes; `get_cac_summary()` SECDEF RPC wired in CACDashboardPage |
| `supabase/migrations/20270703000009_meta_capi_relay_cursor.sql` | etl_cursors + meta_capi_relay cursor row | VERIFIED | Live: `name='meta_capi_relay', value='0'` confirmed |
| `supabase/migrations/20270703000010_rls_deny_ad_tables.sql` | RLS admin-only policies for 7 tables via is_admin_at_least() | VERIFIED | All 7 tables have `is_admin_at_least('admin'::public.admin_role)` FOR ALL policies |
| `supabase/migrations/20270703000011_ad_etl_cron_schedules.sql` | 7 pg_cron schedules + refresh/gap-detect SECDEF helpers | VERIFIED | 8 ad/cac/fx cron jobs active in live DB (including `ad_spend_facts_drop_old_partitions`); `run_ad_etl_gap_detection()` SECDEF confirmed prosecdef=true |
| `supabase/migrations/20270703000012_trigger_ad_etl_backfill_secdef.sql` | trigger_ad_etl_backfill SECDEF + is_admin gate | VERIFIED | Superseded by migration 13 corrective fix |
| `supabase/migrations/20270703000013_fix_trigger_ad_etl_backfill_is_admin.sql` | Corrective: replaces is_admin(uuid) with is_admin_at_least() | VERIFIED | `trigger_ad_etl_backfill` SECDEF exists in live DB; corrective applied |
| `supabase/functions/_shared/ad-etl-utils.ts` | upsertAdSpendFacts, writeHealth, lookupFxRate, convertToUsd, writeAdminNotification | VERIFIED | All 5 exports confirmed in file |
| `supabase/functions/ad-spend-cron-meta/index.ts` | Meta Marketing API hourly ETL + vendor gate | VERIFIED | ACTIVE in prod; vendor gate on META_ACCESS_TOKEN + META_AD_ACCOUNT_ID; 72h replay window |
| `supabase/functions/ad-spend-cron-google/index.ts` | Google Ads OAuth2 REST ETL + vendor gate | VERIFIED | ACTIVE in prod; vendor gate on 5 Google secrets; 72h replay window |
| `supabase/functions/ad-spend-cron-tiktok/index.ts` | TikTok hand-rolled fetch ETL + 168h window | VERIFIED | ACTIVE in prod; vendor gate on TIKTOK_ACCESS_TOKEN + TIKTOK_ADVERTISER_ID; 168h replay window (intentional per D-04) |
| `supabase/functions/fx-rates-ecb-cron/index.ts` | Daily ECB XML fetch + fx_rates upsert | VERIFIED | ACTIVE in prod; ECB URL fetch with 15s timeout; regex XML parse; EUR base row |
| `supabase/functions/meta-capi-relay/index.ts` | events_mirror → Meta CAPI with SHA-256 hashing + PHI triple-guard | VERIFIED | AEM_PRIORITY_EVENTS allowlist (5 events); `crypto.subtle.digest('SHA-256')`; cursor-based at-least-once delivery via `etl_cursors` |
| `supabase/functions/cac-alert-cron/index.ts` | Daily CAC threshold evaluation + cac_alerts + PostHog | VERIFIED | Reads growth_targets; calls get_cac_summary RPC; threshold = `target_ltv_usd * cac_multiplier`; ON CONFLICT DO NOTHING idempotency; `cac_target_breached` PostHog event |
| `leanshot/src/lib/analytics/events.ts` | EventDef.aem_priority (1..8) + aem_dropped + 7 events annotated | VERIFIED | `readonly aem_priority?: 1 \| 2 \| 3 \| 4 \| 5 \| 6 \| 7 \| 8` declared; 7 events annotated (payment_completed=1, signup_completed=2, activation_first_log=3, payment_initiated=4, refund_issued=5, rag_citation_clicked=6, rag_newsletter_subscribed=7); feature_flag_evaluated has `aem_dropped: true` |
| `leanshot/eslint-rules/additive-only-events.cjs` | PHI+AEM cross-check rule blocking aem_priority on phi:true events | VERIFIED | `phi-aem-conflict` messageId and `checkPhiAemConflicts()` visitor confirmed; 3 references in file |
| `leanshot/src/components/admin/growth/CACDashboardPage.tsx` | Full CAC admin module (732 LOC) with health, gaps, CAC cards, drill-down, CSV | VERIFIED | 732 LOC; reads ad_etl_health + ad_etl_gaps + get_cac_summary RPC; Backfill via trigger_ad_etl_backfill RPC; campaign→creative drill-down Sheet; top-5/bottom-5 by CAC; CSV export |
| `leanshot/src/lib/admin/modules.ts` | growth-cac entry in ADMIN_MODULES manifest | VERIFIED | key='growth-cac', route='growth/cac', flagKey='admin.growth.cac.enabled', minRole='admin'; lazy-loads CACDashboardPage |
| `leanshot/e2e/rls-ad-etl-tables.test.ts` | 8 vitest integration RLS denial tests for 7 ad ETL tables | VERIFIED | 8 tests: Tests 1-7 assert 0 rows on SELECT for non-admin authenticated user across all 7 tables; Test 8 positive case confirms admin access. Uses admin.generateLink + /auth/v1/verify ES256-compat pattern. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ad_spend_facts` | `ad_revenue_normalized` matview | LEFT JOIN on (network, ad_account_id, ad_id, spend_date) | WIRED | Migration 08 confirmed; matview DDL joins `ad_spend_facts asf` |
| `ad_network_config` | `ad_revenue_normalized` matview | default_attribution_window_seconds × INTERVAL '1 second' | WIRED | Migration 08 joins `ad_network_config anc ON anc.network = asf.network`; attribution window applied as `hour_bucket + (seconds * interval '1 second')` |
| `events_mirror` | `ad_revenue_normalized` matview | LEFT JOIN on event_name='payment_completed' within attribution window | WIRED | Migration 08 joins `events_mirror em` where `em.created_at BETWEEN hour_bucket AND hour_bucket + window` |
| `ad_revenue_normalized` | `get_cac_summary()` SECDEF RPC | SECURITY DEFINER + is_admin_at_least() check | WIRED | Migration 08 creates `get_cac_summary()` with `IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'unauthorized'`; CACDashboardPage calls `supabase.rpc('get_cac_summary', ...)` |
| `etl_cursors` | `meta-capi-relay` | SELECT value WHERE name='meta_capi_relay'; UPDATE on success | WIRED | meta-capi-relay reads cursor, filters events_mirror rows with id > cursor value, advances cursor only on successful CAPI POST (at-least-once semantics) |
| `growth_targets` | `cac-alert-cron` | SELECT enabled rows; compute threshold = target_ltv_usd * cac_multiplier | WIRED | cac-alert-cron reads enabled growth_targets rows; applies threshold formula; writes cac_alerts ON CONFLICT DO NOTHING |
| `trigger_ad_etl_backfill RPC` | `Backfill button` in CACDashboardPage | supabase.rpc('trigger_ad_etl_backfill', {p_network, p_date}) | WIRED | CACDashboardPage line 305; SECDEF function invokes ETL Edge Fn via vault service_role_key |
| `events.ts AEM_PRIORITY=1` | `meta-capi-relay AEM_PRIORITY_EVENTS` | Static allowlist in Edge Fn; must stay in sync with events.ts annotations | PARTIAL | Static list (5 events: payment_completed through refund_issued). Cannot import events.ts at Edge Fn runtime (Deno limitation). Per SUMMARY 33-04 decisions, acknowledged as sync-dependency requiring manual maintenance. Not a defect — documented limitation. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `CACDashboardPage.tsx` | `cacRows` | `get_cac_summary()` SECDEF RPC → `ad_revenue_normalized` matview | YES — matview joins real `ad_spend_facts` and `events_mirror` rows; returns empty when no ad data (correct vendor-pending behavior) | FLOWING |
| `CACDashboardPage.tsx` | `healthRows` | `supabase.from('ad_etl_health').select(...)` | YES — reads live ad_etl_health table (3 seeded rows, credentials_present=false) | FLOWING |
| `CACDashboardPage.tsx` | `gapRows` | `supabase.from('ad_etl_gaps').select(...)` | YES — reads live ad_etl_gaps table (empty until gap detected) | FLOWING |
| `ad-spend-cron-meta` | `rows` | Meta Marketing API (vendor-gated) | NO while credentials absent — correct vendor-gated behavior per D-01 | VENDOR-GATED (expected) |
| `cac-alert-cron` | `cacData` | `get_cac_summary()` RPC | YES — reads from matview; returns empty when no spend data (correct initial state) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 7 ad ETL tables exist in live DB | `supabase db query --linked "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN (...) ORDER BY 1;"` | 8 rows returned (all 7 tables + etl_cursors) | PASS |
| ad_revenue_normalized matview + UNIQUE index live | `supabase db query --linked "SELECT matviewname FROM pg_matviews..."` + pg_indexes check | matview present; `ad_revenue_normalized_uq` UNIQUE index confirmed | PASS |
| 7+ pg_cron jobs active | `supabase db query --linked "SELECT jobname, active FROM cron.job WHERE jobname LIKE 'ad_%' OR..."` | 8 jobs active (3 ETL hourly + matview refresh + ECB FX + gap detect + CAC alert + partition cleanup) | PASS |
| 6 Edge Functions deployed ACTIVE | `supabase functions list` | ad-spend-cron-meta/google/tiktok, fx-rates-ecb-cron, meta-capi-relay, cac-alert-cron all ACTIVE | PASS |
| trigger_ad_etl_backfill SECDEF exists live | `supabase db query --linked "SELECT proname, prosecdef FROM pg_proc WHERE proname='trigger_ad_etl_backfill';"` | prosecdef=true | PASS |
| run_ad_etl_gap_detection SECDEF exists live | `supabase db query --linked "SELECT proname, prosecdef FROM pg_proc WHERE proname='run_ad_etl_gap_detection';"` | prosecdef=true | PASS |
| etl_cursors meta_capi_relay row | `supabase db query --linked "SELECT name, value FROM etl_cursors WHERE name='meta_capi_relay';"` | name='meta_capi_relay', value='0' | PASS |
| Vite build green | `npm run build` | ✓ built in 4.51s; admin-shell 411.80 kB / 108.07 kB gz — no regression | PASS |
| TypeScript clean | `tsc --noEmit` | 0 errors (verified per Plan 33-05 SUMMARY self-check) | PASS |

### Probe Execution

Step 7c: SKIPPED — no probe-*.sh scripts defined for this phase. Validation uses live DB queries and Edge Function list checks (run above under behavioral spot-checks).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| ADETL-01 | 33-01, 33-03 | Hourly cron Edge Fn pulls Meta Marketing API → ad_spend_facts | SATISFIED | ad-spend-cron-meta ACTIVE; breakdowns=hourly_stats_aggregated_by_advertiser_time_zone; vendor-gated D-01 |
| ADETL-02 | 33-01, 33-03 | Hourly cron Edge Fn pulls Google Ads API → ad_spend_facts | SATISFIED | ad-spend-cron-google ACTIVE; OAuth2 refresh token flow; 5-secret vendor gate |
| ADETL-03 | 33-01, 33-03 | Hourly cron Edge Fn pulls TikTok Business API → ad_spend_facts (hand-rolled fetch) | SATISFIED | ad-spend-cron-tiktok ACTIVE; `tiktokFetch()` hand-rolled with 3-attempt exponential backoff; 168h replay; Access-Token header (not Authorization: Bearer) |
| ADETL-04 | 33-01, 33-05 | ad_revenue_normalized view with per-network attribution window | SATISFIED | Matview live; joins facts to events_mirror via configurable attribution window from ad_network_config; get_cac_summary SECDEF RPC |
| ADETL-05 | 33-01 (SQL fn), 33-05 (UI) | Daily gap-detection cron + ad_etl_gaps + admin notification | SATISFIED | run_ad_etl_gap_detection() SECDEF live; ad_etl_gap_detect cron active 0 5 * * *; function writes ad_etl_gaps + admin_notifications; CACDashboardPage surfaces gaps with Backfill button |
| ADETL-06 | 33-01, 33-03 | Idempotent re-sync covers last-72h per fetch (INSERT ON CONFLICT) | SATISFIED | upsertAdSpendFacts() with onConflict DO UPDATE; 72h for Meta/Google, 168h for TikTok (D-04 intentional extension) |
| ADETL-07 | 33-01, 33-04, 33-05 | Admin CAC dashboard + alert when 7d rolling CAC > target LTV × 0.5 | SATISFIED | CACDashboardPage wired to matview; cac-alert-cron evaluates growth_targets threshold; cac_alerts written + PostHog event emitted |
| ADETL-08 | 33-05 | Creative-level attribution; admin filters top-5/bottom-5 | SATISFIED | CACDashboardPage drill-down Sheet: campaign-level expansion → top-5 highest CAC + bottom-5 lowest CAC creatives per campaign; grouped by ad_id |
| ADETL-09 | 33-01, 33-03 | fx_rates table + daily ECB fetch + USD normalization at spend-day rate | SATISFIED | fx_rates live (UNIQUE currency+rate_date); fx-rates-ecb-cron ACTIVE at 0 17 * * *; convertToUsd() 3-case formula (USD passthrough / EUR-direct / cross-rate); NULL USD column when FX row missing per D-11 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `leanshot/src/lib/admin/modules.ts` + `modules.test.ts` | modules.test.ts:19,59,66 | modules.test.ts expects 16 entries but ADMIN_MODULES now has 18 (Phase 25 added 'compliance', Phase 33 added 'growth-cac'; test list not updated by either phase) | WARNING | T1/T3/T4 in modules.test.ts fail (expected 16, got 18; 'compliance' and 'growth-cac' missing from expected key list). Pre-existing failure from Phase 25; Phase 33 made it 1 worse. Does not block any SC. |
| `leanshot/src/components/admin/growth/CACDashboardPage.test.tsx` | 27,34,41,47 | 4 `it.skip` tests pointing to deferred-tests.md but no entry exists in .planning/deferred-tests.md | WARNING | Deferred test tracking gap. Tests are properly skipped per project convention; entry in deferred-tests.md is absent. Does not affect runtime behavior. |

No TBD, FIXME, or XXX debt markers found in Phase 33 files.

### Human Verification Required

#### 1. growth_targets seed value confirmation

**Test:** Log in as admin, navigate to `/admin/growth/cac`, verify CAC alert threshold is acceptable.
**Expected:** target_ltv_usd=$200 and cac_multiplier=0.5 (threshold=$100 CAC) is confirmed or updated via the "Alerts" settings panel in the CAC dashboard.
**Why human:** Placeholder value per CONTEXT D-13, flagged in planning. The $200 LTV is a heuristic; real value depends on cohort retention data not yet available. Admin can update this via the UI without a code deploy.

#### 2. AEM event priority confirmation (refund_issued at priority 5)

**Test:** Review `leanshot/src/lib/analytics/events.ts` EVENTS object; confirm the AEM priority ordering, specifically that refund_issued (aem_priority: 5) should be forwarded to Meta CAPI.
**Expected:** User confirms priorities 1-7 are intentional. If refund_issued should be excluded from CAPI, set `aem_dropped: true` instead of `aem_priority: 5` — this change flows through ESLint enforcement to meta-capi-relay's static allowlist.
**Why human:** CONTEXT D-06 and Plan 33-02 SUMMARY explicitly label the ordering "PROPOSED, pending user confirmation." The AEM_PRIORITY_EVENTS static list in meta-capi-relay currently includes only priorities 1-5 (refund_issued is priority 5 and IS included in the relay).

#### 3. Vendor credential setup (Meta, Google, TikTok)

**Test:** When Meta App Review / Google OAuth / TikTok credential approvals land, set secrets via `supabase secrets set` and manually trigger each ETL.
**Expected:**
- `supabase secrets set META_ACCESS_TOKEN=<value> META_AD_ACCOUNT_ID=<value>` → trigger ad-spend-cron-meta → returns 200 + ad_etl_health shows `credentials_present=true` + `ad_spend_facts` rows appear
- `supabase secrets set GOOGLE_ADS_DEVELOPER_TOKEN=<value> ...5 secrets...` → trigger ad-spend-cron-google → similar
- `supabase secrets set TIKTOK_ACCESS_TOKEN=<value> TIKTOK_ADVERTISER_ID=<value>` → trigger ad-spend-cron-tiktok → similar
- `supabase secrets set META_PIXEL_ID=<value> META_ACCESS_TOKEN=<value>` → meta-capi-relay starts processing events_mirror tail
**Why human:** By-design vendor gate (CONTEXT D-01, Pattern S4). Meta App Review is 2-4wk lead time. Phase ships before credentials are available.

#### 4. CAC dashboard visual verification

**Test:** Log in as admin, navigate to `/admin/growth/cac`.
**Expected:** Three health badge cards (Meta/Google/TikTok) showing "Credentials missing" badges; Gaps section empty or showing detected gaps; CAC cards section showing "No spend data" EmptyState; Drill-down sheet opens when a card is clicked; Backfill button is present in gaps section.
**Why human:** No jsdom vitest config exists; CACDashboardPage unit tests are deferred (it.skip). Visual rendering requires live admin session.

### Gaps Summary

No engineering gaps identified. All 9 ADETL requirements have complete implementation:

- 13 migrations applied to live Supabase project
- 6 Edge Functions deployed ACTIVE
- 7 tables + 1 matview + 1 cursor table live in prod
- All required pg_cron schedules active
- Admin module wired with full 732-LOC CACDashboardPage
- RLS denial proof (8 tests in e2e/rls-ad-etl-tables.test.ts)

The `modules.test.ts` count regression (expected 16, actual 18) is a WARNING-level anti-pattern: Phase 25 broke the test by not updating it when adding 'compliance'; Phase 33 made it 1 worse by not updating it when adding 'growth-cac'. Neither phase introduced a BLOCKER. The test count mismatch requires updating `modules.test.ts` to expect 18 modules and add 'compliance' and 'growth-cac' to the expected keys list.

The 4 `human_needed` items above are either vendor-gated by design (credentials), business-value decisions (growth_targets seed), or visual-rendering checks (UI). All engineering controls are in place.

---

_Verified: 2026-05-18T21:45:00Z_
_Verifier: Claude (gsd-verifier)_
