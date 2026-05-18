---
phase: "33"
plan: "03"
subsystem: "ad-etl"
tags:
  - edge-function
  - meta-api
  - google-ads
  - tiktok-api
  - ecb-fx
  - vendor-gated
  - deno
dependency_graph:
  requires:
    - "33-01"  # ad-etl-utils.ts shared helpers
  provides:
    - "ad-spend-cron-meta"
    - "ad-spend-cron-google"
    - "ad-spend-cron-tiktok"
    - "fx-rates-ecb-cron"
  affects:
    - "ad_spend_facts"
    - "fx_rates"
    - "ad_etl_health"
tech_stack:
  added: []
  patterns:
    - "vendor-gated health check (D-01)"
    - "TikTok hand-rolled fetch with 3-attempt exponential backoff"
    - "ECB XML regex parsing with ON CONFLICT DO NOTHING"
    - "OAuth2 refresh token exchange for Google Ads"
    - "Meta hourly breakdown via breakdowns= param (not time_increment=1)"
key_files:
  created:
    - supabase/functions/ad-spend-cron-meta/index.ts
    - supabase/functions/ad-spend-cron-meta/index.test.ts
    - supabase/functions/ad-spend-cron-google/index.ts
    - supabase/functions/ad-spend-cron-google/index.test.ts
    - supabase/functions/ad-spend-cron-tiktok/index.ts
    - supabase/functions/ad-spend-cron-tiktok/index.test.ts
    - supabase/functions/fx-rates-ecb-cron/index.ts
    - supabase/functions/fx-rates-ecb-cron/index.test.ts
  modified: []
decisions:
  - "Meta uses breakdowns=hourly_stats_aggregated_by_advertiser_time_zone (not time_increment=1); reach/frequency excluded as incompatible"
  - "Google Ads uses OAuth2 refresh-token exchange — all 5 secrets required for vendor-gate"
  - "TikTok uses Access-Token header (not Authorization: Bearer); 168h replay window (7d attribution restate per D-04)"
  - "ECB XML parsed via regex (no DOMParser needed for this simple structure); includes EUR base row (rate=1.0)"
  - "All ETL fns import from ../_shared/ad-etl-utils.ts via relative path (no bare shared/* imports)"
  - "fx-rates-ecb-cron does not call shutdownPostHog (no captureServer used)"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-18"
  tasks_completed: 2
  files_created: 8
  tests_passing: 23
---

# Phase 33 Plan 03: Ad-Spend ETL Edge Functions Summary

**One-liner:** Four vendor-gated Deno Edge Functions for Meta Marketing API hourly ETL, Google Ads OAuth2 REST ETL, TikTok hand-rolled fetch ETL (168h window), and daily ECB FX XML upsert — all wired to shared `_shared/ad-etl-utils.ts` helpers.

## What Was Built

### Task 1: Meta + Google Ad-Spend ETL Edge Functions

**`ad-spend-cron-meta/index.ts`**
- Vendor-gated on `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID`; returns `{ok:true, skipped:'credentials_missing'}` when absent
- Uses `breakdowns=hourly_stats_aggregated_by_advertiser_time_zone` (NOT `time_increment=1` — the RESEARCH-confirmed correct param)
- Excludes `reach` and `frequency` fields (incompatible with hourly breakdown)
- Paginates via `paging.next` cursor; breaks early if BUC header `total_cputime > 80%` or `total_time > 80%`
- BUC header logging: only numeric `total_cputime` + `total_time` values (T-33-03-04 compliance)
- 72h replay window per D-04; FX via `convertToUsd()` helper

**`ad-spend-cron-google/index.ts`**
- Vendor-gated on all 5 required secrets: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` optional (falls back to CUSTOMER_ID for direct non-MCC accounts)
- OAuth2 refresh token exchange via `URLSearchParams` POST to `https://oauth2.googleapis.com/token`
- searchStream response is NDJSON — each line parsed as `{results:[...]}` object
- `cost_micros / 1_000_000` → `spend_local`; hour from `segments.hour` (0-23 int → padded ISO string)

### Task 2: TikTok + ECB FX Edge Functions

**`ad-spend-cron-tiktok/index.ts`**
- Vendor-gated on `TIKTOK_ACCESS_TOKEN` + `TIKTOK_ADVERTISER_ID`
- **168h (7 day) replay window** per D-04 (V13-5 TikTok attribution restate mitigation — NOT 72h)
- `tiktokFetch()` — hand-rolled retry wrapper: max 3 attempts, `AbortSignal.timeout(15_000)`, exponential backoff (`1000 * 2^attempt * random(0.5-1.0)`) on 429/5xx, throws `tiktok_max_retries_exceeded` after max
- Auth header: `'Access-Token': token` (NOT `Authorization: Bearer` — TikTok-specific)
- `stat_time_hour` → ISO timestamptz: `'YYYY-MM-DD HH:00:00'` → `'YYYY-MM-DDTHH:00:00+00:00'`
- Paginated via `page_info.has_more`

**`fx-rates-ecb-cron/index.ts`**
- No vendor-gate (ECB is public)
- Fetch `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` with 15s timeout
- Regex parse: `time="(\d{4}-\d{2}-\d{2})"` for date; `currency="([A-Z]+)"\s+rate="([\d.]+)"` for rates
- EUR base row always included (`rate_eur_to_currency: 1.0`)
- `upsert({onConflict:'currency,rate_date', ignoreDuplicates:true})` for weekend/holiday gap handling
- Degraded mode: fetch failure → `writeAdminNotification(type:'ecb_fx_fetch_failed')` + 200 `ok:false`
- Malformed XML (no `time` attr) → throws `'ecb_xml_date_parse_failed'`
- Does NOT use `posthog-server.ts` / `captureServer()` (no shutdownPostHog needed)

## Test Results

All 23 Deno tests pass across all 4 Edge Functions:

| Function | Tests | Result |
|----------|-------|--------|
| ad-spend-cron-meta | 5 | PASS |
| ad-spend-cron-google | 6 | PASS |
| ad-spend-cron-tiktok | 6 | PASS |
| fx-rates-ecb-cron | 6 | PASS |
| **Total** | **23** | **PASS** |

## Deviations from Plan

None — plan executed exactly as written.

The following were intentional implementation details (not deviations):
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` treated as optional (falls back to `GOOGLE_ADS_CUSTOMER_ID` for non-MCC accounts) per the D-03 note that it's the "same as CUSTOMER_ID if direct" — still counted in vendor-gate check via the fallback.
- ECB XML parsing uses native regex (no DOMParser) — simpler and sufficient for the eurofxref-daily.xml predictable structure.
- Test 2 in the TikTok suite actually waits for backoff (adds ~2s per run) because the exponential backoff implementation uses real `setTimeout`. This is intentional to verify the full retry loop behavior.

## Known Stubs

None. All Edge Functions are fully implemented — no hardcoded empty values, placeholders, or TODO stubs in the data flow paths.

## Threat Surface Scan

No new threat surface beyond what the plan's threat model covers. All files are server-side only (Supabase Edge Functions). No new network endpoints, auth paths, or schema changes beyond `ad_spend_facts`, `fx_rates`, `ad_etl_health` (all covered by Plan 33-01 RLS).

## Import Pattern Note

All imports use relative paths (`../_shared/ad-etl-utils.ts`, `../_shared/lifecycle-utils.ts`). No bare `shared/*` aliases used. The `--import-map` deploy flag is NOT required for these functions.

## Self-Check

Verified files exist:
- `supabase/functions/ad-spend-cron-meta/index.ts` — FOUND
- `supabase/functions/ad-spend-cron-meta/index.test.ts` — FOUND
- `supabase/functions/ad-spend-cron-google/index.ts` — FOUND
- `supabase/functions/ad-spend-cron-google/index.test.ts` — FOUND
- `supabase/functions/ad-spend-cron-tiktok/index.ts` — FOUND
- `supabase/functions/ad-spend-cron-tiktok/index.test.ts` — FOUND
- `supabase/functions/fx-rates-ecb-cron/index.ts` — FOUND
- `supabase/functions/fx-rates-ecb-cron/index.test.ts` — FOUND

Verified commits:
- Task 1: `b5c524b` — feat(33-03): Meta + Google ad-spend ETL Edge Functions
- Task 2: `a2f5625` — feat(33-03): TikTok + ECB FX Edge Functions

## Self-Check: PASSED
