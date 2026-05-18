---
status: partial
phase: 33-hourly-ad-spend-etl-meta-google-tiktok
source: [33-VERIFICATION.md]
started: 2026-05-18
updated: 2026-05-18
---

## Current Test

[awaiting vendor approvals (Meta App Review 2-4wk, Google Ads OAuth setup, TikTok credentials) + user lock on 2 placeholder/proposed values + live admin smoke]

## Tests

### 1. growth_targets seed value (D-13)
expected: `target_ltv_usd=200, cac_multiplier=0.5` — confirm or update via `/admin/growth/cac` Alerts panel
result: [pending]
verify: `npx --prefix leanshot supabase db query --linked "SELECT source, target_ltv_usd, cac_multiplier FROM public.growth_targets;"` returns confirmed values

### 2. AEM top-8 ordering (D-06)
expected: Confirm `refund_issued` at priority 5 (or remove it). Other 7: payment_completed #1, signup_completed #2, activation_first_log #3, payment_initiated #4, rag_question_asked/rag_answer_returned/rag_citation_clicked #6-8 (subject to Plan 33-02 SUMMARY swap)
result: [pending]
verify: edit `leanshot/src/lib/analytics/events.ts` aem_priority assignments + push to live Meta Events Manager dashboard

### 3. Meta Marketing API credentials + App Review
expected: META_AD_ACCOUNT_ID + META_ACCESS_TOKEN set as Supabase Function Secrets after Meta App Review approval (2-4wk lead). Once set, `ad-spend-cron-meta` ad_etl_health row transitions `credentials_present: false → true`.
result: [pending]
verify: `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp` shows META_* keys; `supabase db query --linked "SELECT credentials_present FROM ad_etl_health WHERE network='meta';"` → true

### 4. Google Ads OAuth2 setup (6 secrets)
expected: GOOGLE_ADS_DEVELOPER_TOKEN + GOOGLE_ADS_CUSTOMER_ID + GOOGLE_ADS_LOGIN_CUSTOMER_ID + GOOGLE_ADS_CLIENT_ID + GOOGLE_ADS_CLIENT_SECRET + GOOGLE_ADS_REFRESH_TOKEN
result: [pending]
verify: same SQL pattern as #3 with `network='google'`

### 5. TikTok Business API credentials
expected: TIKTOK_ACCESS_TOKEN + TIKTOK_ADVERTISER_ID set; TikTok dimension-incompatibility smoke (stat_time_hour vs day) verified per RESEARCH OQ3 (accepted as best-effort — runbook hint to switch to stat_time_day on 40002 error)
result: [pending]
verify: same SQL pattern with `network='tiktok'`

### 6. Meta CAPI relay credentials
expected: META_PIXEL_ID + META_ACCESS_TOKEN set; meta-capi-relay starts posting hashed conversion events to Meta CAPI
result: [pending]
verify: `supabase db query --linked "SELECT name, value FROM etl_cursors WHERE name='meta_capi_relay';"` — value advances on each successful tick

### 7. CAC dashboard live smoke
expected: Log in as admin → navigate to `/admin/growth/cac` → CAC page renders without JS console errors. Health badges show "Credentials missing" for un-configured networks. EmptyState renders if no spend data. Drill-down drawer expands on row click. CSV export downloads valid CSV.
result: [pending]
verify: live browser session; report any console errors

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps

None — all 7 items are by-design vendor-action / user-confirmation per phase plan. Phase 33 ships engineering-complete; vendor approvals + 2 user-lock items + 1 visual smoke remain.
