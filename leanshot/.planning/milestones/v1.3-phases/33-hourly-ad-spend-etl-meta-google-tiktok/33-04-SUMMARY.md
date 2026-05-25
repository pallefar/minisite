---
phase: 33-hourly-ad-spend-etl-meta-google-tiktok
plan: "04"
subsystem: edge-functions
tags: [meta-capi, cac-alerts, posthog, etl, edge-functions, phi-guardrail]

dependency_graph:
  requires:
    - 33-01  # etl_cursors, cac_alerts, growth_targets, ad_revenue_normalized, events_mirror
    - 33-02  # AEM priority annotations + ESLint phi-aem-conflict rule
  provides:
    - meta-capi-relay Edge Function (events_mirror → Meta CAPI v25.0)
    - cac-alert-cron Edge Function (growth_targets → cac_alerts → PostHog + admin_notifications)
  affects:
    - supabase/functions/meta-capi-relay
    - supabase/functions/cac-alert-cron

tech_stack:
  added: []
  patterns:
    - Vendor-gated pattern (S4/S5) for META_ACCESS_TOKEN / META_PIXEL_ID
    - etl_cursors cursor-advance pattern (at-least-once delivery)
    - Web Crypto SHA-256 hashing (crypto.subtle.digest, no library)
    - ON CONFLICT idempotency_key DO NOTHING for cac_alerts
    - Injectable test seams via __internal (setCaptureServerForTest, setShutdownPostHogForTest)
    - TDD RED/GREEN per plan

key_files:
  created:
    - supabase/functions/meta-capi-relay/index.ts
    - supabase/functions/meta-capi-relay/index.test.ts
    - supabase/functions/cac-alert-cron/index.ts
    - supabase/functions/cac-alert-cron/index.test.ts
  modified: []

decisions:
  - "Static AEM_PRIORITY_EVENTS list in meta-capi-relay (5 events) — cannot import events.ts at Edge Fn runtime; list must stay in sync with events.ts annotations (D-07)"
  - "PHI triple-guard: build-time ESLint (shipped 33-02) + static allowlist + runtime defense-in-depth skip — any event_name not in allowlist is skipped even if DB query leaks it"
  - "cac_alerts idempotency_key = source|today (composite unique) — ON CONFLICT DO NOTHING; captureServer + writeAdminNotification only on NEW alert (upsert returned data)"
  - "captureServer userId='system' for cac-alert-cron — system cron events use sentinel; documented in source header per D-13 convention"
  - "shutdownPostHog in finally via handleRunWithFinally wrapper — exposed as __internal for test verification"
  - "Test seams: setCaptureServerForTest, resetCaptureServerForTest, setShutdownPostHogForTest, resetShutdownPostHogForTest all in __internal"

metrics:
  duration: "~25 minutes"
  completed_date: "2026-05-18"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 0
---

# Phase 33 Plan 04: meta-capi-relay + cac-alert-cron Summary

**One-liner:** Meta CAPI relay with SHA-256 PII hashing + PHI triple-guard; daily CAC breach alerter with PostHog + admin notifications via etl_cursors and ON CONFLICT idempotency.

## Tasks Executed

| Task | Name | Commits | Status |
|------|------|---------|--------|
| 1 | meta-capi-relay Edge Function | `74d1f91` (RED), `39cfa22` (GREEN) | Complete |
| 2 | cac-alert-cron Edge Function | `72ee39c` (RED), `ca4ed33` (GREEN) | Complete |

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `74d1f91` | test | Failing tests for meta-capi-relay (7 tests) |
| `39cfa22` | feat | meta-capi-relay implementation |
| `72ee39c` | test | Failing tests for cac-alert-cron (8 tests) |
| `ca4ed33` | feat | cac-alert-cron implementation |

## Implementation Details

### meta-capi-relay (5-min cron)

- **AEM_PRIORITY_EVENTS** static list: `payment_completed`, `signup_completed`, `activation_first_log`, `payment_initiated`, `refund_issued` (aem_priority 1-5)
- Vendor gate: returns `{ok:true, skipped:'credentials_missing'}` if `META_PIXEL_ID` or `META_ACCESS_TOKEN` absent
- SHA-256 via `crypto.subtle.digest` — email + phone normalized (lowercase + trim) before hashing; no library
- Cursor tracking via `etl_cursors WHERE name='meta_capi_relay'` — only advances on successful CAPI POST (at-least-once)
- Batch POST to `https://graph.facebook.com/v25.0/{PIXEL_ID}/events` in chunks of 1000
- PHI triple-guard: (1) ESLint build-time rule from 33-02, (2) AEM_PRIORITY_EVENTS static allowlist, (3) runtime defense-in-depth skip for any event_name not in list
- Source header documents fbq event_id dedup dependency (out of Phase 33 scope)

### cac-alert-cron (daily 00:30 UTC)

- Reads enabled `growth_targets` rows
- Calls `get_cac_summary(p_source, p_start_date, p_end_date)` SECDEF RPC per target
- Computes 7d rolling CAC: `sum(spend_usd) / sum(attributed_conversions)` — skips if conversions = 0
- Threshold: `target_ltv_usd * cac_multiplier`
- On breach: upserts `cac_alerts` with `idempotency_key = source|YYYY-MM-DD` ON CONFLICT DO NOTHING
- New-alert-only: `captureServer({userId:'system', event:'cac_target_breached', ...})` + `writeAdminNotification(type='cac_alert')`
- `shutdownPostHog` in finally via `handleRunWithFinally` wrapper

## Verification Results

```
grep -c "AEM_PRIORITY_EVENTS" supabase/functions/meta-capi-relay/index.ts → 7 (declaration + multiple usages)
grep "crypto.subtle.digest" → 1 match
grep "etl_cursors" → 5 matches (getCursor + setCursor)
grep "shutdownPostHog" supabase/functions/cac-alert-cron/index.ts → 6 matches
grep "cac_target_breached" → 1 match (captureServer call)
All 15 Deno tests pass (7 meta-capi-relay + 8 cac-alert-cron)
```

## TDD Gate Compliance

- meta-capi-relay: RED commit `74d1f91` → GREEN commit `39cfa22` (gate compliant)
- cac-alert-cron: RED commit `72ee39c` → GREEN commit `ca4ed33` (gate compliant)

## Deviations from Plan

### Auto-added: Test seam injection pattern for posthog functions

**Rule 2 — Missing critical functionality**

- **Found during:** Task 2 (cac-alert-cron)
- **Issue:** Plan spec required testing that `shutdownPostHog` is called in finally block, but `captureServer` and `shutdownPostHog` were imported directly — no test seam.
- **Fix:** Added `setCaptureServerForTest`, `resetCaptureServerForTest`, `setShutdownPostHogForTest`, `resetShutdownPostHogForTest` to `__internal` export; added `handleRunWithFinally` as testable wrapper.
- **Files modified:** `supabase/functions/cac-alert-cron/index.ts`
- **Commit:** `ca4ed33`

## Known Stubs

None. Both Edge Functions are fully wired:
- meta-capi-relay reads live `events_mirror` + `etl_cursors` and POSTs to Meta CAPI
- cac-alert-cron reads live `growth_targets` + `get_cac_summary` RPC + writes `cac_alerts` + `admin_notifications`

## Threat Surface Scan

No new trust boundaries introduced beyond what the plan's `<threat_model>` already covers:

| Flag | File | Description |
|------|------|-------------|
| (none) | — | All outbound surfaces (Meta CAPI, PostHog) are documented in threat register T-33-04-01..05 |

## Self-Check: PASSED

Files exist:
- supabase/functions/meta-capi-relay/index.ts — FOUND
- supabase/functions/meta-capi-relay/index.test.ts — FOUND
- supabase/functions/cac-alert-cron/index.ts — FOUND
- supabase/functions/cac-alert-cron/index.test.ts — FOUND

Commits verified:
- 74d1f91 — FOUND (test: meta-capi-relay RED)
- 39cfa22 — FOUND (feat: meta-capi-relay GREEN)
- 72ee39c — FOUND (test: cac-alert-cron RED)
- ca4ed33 — FOUND (feat: cac-alert-cron GREEN)
