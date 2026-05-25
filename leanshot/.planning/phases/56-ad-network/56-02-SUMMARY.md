---
phase: 56-ad-network
plan: "02"
subsystem: ad-network-backend
tags: [migrations, edge-fn, etl, revenue, rls, cron, secdef]
dependency_graph:
  requires: [phase-33-ad-etl, phase-55-healthkit-firewall]
  provides: [ad_placements, ad_advertiser_blocklist, ad_csp_allowlist, ad_revenue_facts, get_ad_revenue_dashboard, ad-revenue-etl-fn]
  affects: [56-04-csp-generator, 56-05-admin-dashboard]
tech_stack:
  added: [ad-revenue-etl Edge Fn, pg_cron daily 03:00 UTC]
  patterns: [SECDEF RPC with is_admin_at_least guard, vault service_role bearer cron, raw_payload jsonb fallback, graceful-skip on 401/403]
key_files:
  created:
    - supabase/migrations/20280401000001_ad_placements.sql
    - supabase/migrations/20280401000002_ad_advertiser_blocklist.sql
    - supabase/migrations/20280401000003_ad_revenue_facts.sql
    - supabase/migrations/20280401000004_ad_network_config_add_serving.sql
    - supabase/migrations/20280401000005_ad_revenue_etl_cron_rpc.sql
    - supabase/functions/ad-revenue-etl/index.ts
    - supabase/functions/ad-revenue-etl/index.test.ts
    - supabase/functions/ad-revenue-etl/deno.json
  modified: []
decisions:
  - "ad_revenue_facts is a new revenue-inflow table distinct from the spend-side ad_revenue_normalized matview"
  - "normalizeReportRow always stores raw_payload=rawRow to handle unknown API field shapes until Phase 70 publisher approval"
  - "is_admin_at_least('admin') used as RPC guard — single-arg is_admin() helper does NOT exist in this codebase"
  - "named dollar-tag $func$ in RPC to avoid dollar-quote nesting conflict with SECDEF body"
  - "per-function deno.json added (import_map --flag deprecated in CLI v2.101.0)"
metrics:
  duration: "~12 minutes"
  completed: "2026-05-25"
  tasks_completed: 3
  files_created: 8
---

# Phase 56 Plan 02: Revenue ETL Backend Summary

Revenue-side schema (ad_placements, ad_advertiser_blocklist, ad_csp_allowlist, ad_revenue_facts), idempotent ad_network_config CHECK extension for admob/adsense, daily cron + admin-guarded SECDEF RPC, and ad-revenue-etl Edge Fn with raw_payload fallback and graceful unauthorized handling.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Schema migrations: ad_placements + blocklist/allowlist + ad_revenue_facts + network_config ALTER | 09daff45 |
| 2 | Daily cron + get_ad_revenue_dashboard SECDEF RPC | 9689e3cf |
| 3 | ad-revenue-etl Edge Fn (TDD RED→GREEN, 7/7 tests) | f7a794b2 (RED), e0038553 (GREEN) |

## Schema Reference (for sibling plans)

### ad_placements columns (56-01 rowToPlacementConfig + 56-05 dashboard)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| key | text UNIQUE | placement identifier slug |
| surface | text | consumer surface name |
| mode | text | 'embed-code' \| 'ad-platform' \| 'house-ads' |
| network | text NULL | 'admob' \| 'adsense' (null for house-ads) |
| freq_cap_per_session | int | default 3 |
| ab_variant | text NULL | A/B variant identifier |
| enabled | boolean | default false |
| embed_html | text NULL | raw advertiser snippet for embed-code mode |
| house_ad_slug | text NULL | self-promo slug for house-ads mode |
| created_at / updated_at | timestamptz | default now() |

### ad_advertiser_blocklist columns (56-04 CSP generator)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| hostname | text UNIQUE | e.g. competing brand domain |
| reason | text NULL | human description |
| created_at | timestamptz | |

### ad_csp_allowlist columns (56-04 CSP generator)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| hostname | text UNIQUE | e.g. pagead2.googlesyndication.com |
| directive | text | 'script-src' \| 'connect-src' |
| enabled | boolean | default true |
| created_at | timestamptz | |

### get_ad_revenue_dashboard RPC signature (56-05 admin dashboard)
```sql
get_ad_revenue_dashboard(
  p_start_date date default null,
  p_end_date   date default null
) returns table (
  network               text,
  report_date           date,
  impressions           bigint,
  clicks                bigint,
  fill_rate             numeric,
  estimated_revenue_usd numeric,
  ecpm_usd              numeric,
  rpm_usd               numeric
)
```
Guard: `is_admin_at_least('admin'::public.admin_role)` — raises 42501 for non-admins.

### ad_revenue_facts unique constraint
Upsert key: `(network, placement_id, report_date)` — placement_id may be NULL for network-level aggregates.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Comment strings defeated negation grep**
- **Found during:** Task 2 verification
- **Issue:** `! grep -q "is_admin(auth.uid())"` failed because the exact forbidden string appeared in SQL comments as a negative example
- **Fix:** Rewrote comments to avoid reproducing the exact forbidden string (`is_admin(auth.uid())`) — documented the constraint in prose without repeating the identifier verbatim
- **Pattern:** Per `feedback_negation_grep_defeated_by_comment_string` MEMORY entry
- **Files modified:** 20280401000005_ad_revenue_etl_cron_rpc.sql

## TDD Gate Compliance

- RED commit: `f7a794b2` — `test(56-02): add failing tests for normalizeReportRow + computeEcpmRpm helpers` (module-not-found = correct RED failure)
- GREEN commit: `e0038553` — `feat(56-02): ad-revenue-etl Edge Fn` (7/7 tests passing)
- REFACTOR: not needed (helpers are clean single-responsibility functions)

## Migration Push Status

All 5 migrations are forward-dated (20280401000001–20280401000005) past the Phase 55 ceiling (20280301000005). Migration push via `supabase db push --linked` is deferred to phase close-out per project CARRY-OVER pattern. Status: **UNPUSHED — queued for phase close-out push matrix**.

## Known Stubs

- `fetchNetworkReport()` returns empty rows + skipped message in Phase 56. Real AdMob/AdSense Reporting API calls are Phase 70 work (publisher approval pending). The stub is intentional and documented via D-08.

## Threat Surface Scan

All new surfaces are within the plan's threat_model:
- T-56-04: service-role bearer auth implemented in Edge Fn
- T-56-05: RLS + SECDEF RPC guard implemented for ad_revenue_facts
- T-56-06: graceful 401/403/missing-creds handling implemented
- T-56-07: search_path locked on get_ad_revenue_dashboard

No unplanned threat surface additions.

## Self-Check: PASSED

Files present:
- supabase/migrations/20280401000001_ad_placements.sql: FOUND
- supabase/migrations/20280401000002_ad_advertiser_blocklist.sql: FOUND
- supabase/migrations/20280401000003_ad_revenue_facts.sql: FOUND
- supabase/migrations/20280401000004_ad_network_config_add_serving.sql: FOUND
- supabase/migrations/20280401000005_ad_revenue_etl_cron_rpc.sql: FOUND
- supabase/functions/ad-revenue-etl/index.ts: FOUND
- supabase/functions/ad-revenue-etl/index.test.ts: FOUND

Commits verified:
- 09daff45: Task 1 schema migrations
- 9689e3cf: Task 2 cron + RPC
- f7a794b2: Task 3 RED test
- e0038553: Task 3 GREEN implementation
