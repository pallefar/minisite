---
phase: 52-vendor-setup-foundation
plan: "01"
subsystem: edge-functions
tags: [vendor-smoke, dual-auth, edge-fn, fail-soft, vendor-registry]
dependency_graph:
  requires: []
  provides: [vendor-smoke-fn]
  affects: [52-02-vendor-smoke-log-migration, close-out-cron-registration]
tech_stack:
  added: []
  patterns:
    - dual-auth (service-role bearer + staff JWT via profiles.is_staff)
    - fail-soft vendor registry (absent secrets → not_configured, never fail)
    - per-function deno.json with file-targeted test task (avoids Deno.serve hang)
    - constant-time bearer compare via checkServiceRoleBearer shared util
key_files:
  created:
    - supabase/functions/vendor-smoke/deno.json
    - supabase/functions/vendor-smoke/index.ts
    - supabase/functions/vendor-smoke/index.test.ts
  modified: []
decisions:
  - "Inlined Resend probe (GET /domains) rather than reusing resend-domain-health-check.ts — the shared util has a SupabaseClient dependency and domain-status-logging logic not needed for a simple connectivity smoke"
  - "A1 APNs fallback: ES256 JWT mint attempted; if crypto.subtle.importKey fails for the P8 key format, all-present → ok with message 'presence_check_fallback' (documented per PLAN A1)"
  - "deno.json test task uses --allow-all after the file argument: 'deno test --no-check index.test.ts --allow-all' — needed because Deno.serve() at module top-level requires --allow-net, and Deno.env manipulation requires --allow-env; --allow-all is consistent with baa-expiry-check project pattern"
  - "VENDOR_REGISTRY exported as mutable array on __internal to allow test override via splice; isAuthorized also exported for direct unit testing"
metrics:
  duration_seconds: 522
  completed_date: "2026-05-25"
  tasks_completed: 3
  files_created: 3
  files_modified: 0
requirements: [VENDOR-01, VENDOR-02, VENDOR-03, VENDOR-04, VENDOR-05, VENDOR-06, VENDOR-07, VENDOR-08, VENDOR-09, VENDOR-11]
---

# Phase 52 Plan 01: Vendor Smoke Edge Function Summary

**One-liner:** Dual-auth vendor-smoke Edge Fn iterating a 16-vendor fail-soft registry with ES256/RS256 JWT minting, upsert into vendor_smoke_log, and 6-test Deno unit suite.

## What Was Built

The `vendor-smoke` Supabase Edge Function provides a live vendor-secret missing-tracker for all downstream v1.4 phases (53-68). It:

1. Gates every request via dual-auth: cron invocations use a service-role bearer (constant-time compare), staff-triggered invocations use a user JWT validated against `profiles.is_staff === true`.
2. Iterates a 16-vendor `VENDOR_REGISTRY` covering VENDOR-01..09 and VENDOR-11. Every handler is fail-soft: absent secrets return `not_configured` (never `fail`), ensuring the Fn runs safely before Phase 70 provisioning completes.
3. Upserts one row per vendor into `vendor_smoke_log` with `onConflict: 'vendor_name'` (table created by plan 52-02).
4. Logs only `e.name` and fixed short codes in catch blocks — never `e.message` or response bodies (T-52-02 mitigation against Authorization header fragment leakage).

## Vendors in Registry

| Vendor | Env Vars | Probe | Always-not_configured? |
|--------|----------|-------|------------------------|
| Mux | MUX_TOKEN_ID + MUX_TOKEN_SECRET | GET /video/v1/assets Basic auth | No |
| Calendly | CALENDLY_API_KEY | GET /users/me Bearer | No |
| Better Stack | BETTER_STACK_API_KEY | GET /api/v2/monitors Bearer | No |
| Sentry | SENTRY_DSN | HEAD /api/{project}/envelope/ | No |
| Anthropic (clinical) | ANTHROPIC_CLINICAL_API_KEY | POST /v1/messages | No |
| Anthropic (consumer) | ANTHROPIC_API_KEY | POST /v1/messages | No |
| Stripe | STRIPE_SECRET_KEY | GET /v1/balance Bearer | No |
| Resend | RESEND_API_KEY | GET /domains Bearer | No |
| PostHog | POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID | GET /api/projects/{id}/ | No |
| Slack | SLACK_WEBHOOK_EXPERIMENTS_URL | POST webhook text | No |
| FCM/Google Play | PLAY_SERVICE_ACCOUNT_JSON | OAuth2 token mint RS256 JWT | No |
| Apple/APNs | APNS_KEY_ID + APNS_TEAM_ID + APNS_P8_KEY + APPLE_TEAM_ID + APPLE_BUNDLE_ID | ES256 JWT mint (no APNs HTTP/2 call) | No (not_configured if any absent) |
| HealthKit | (none) | — | YES: entitlement_ios_only_no_server_smoke |
| AdMob/AdSense | (none) | — | YES: client_sdk_only_no_server_smoke |
| SHARE_TOKEN_SECRET | SHARE_TOKEN_SECRET | presence check | No |
| QUARTERLY_NPS_SIGNING_KEY | QUARTERLY_NPS_SIGNING_KEY | presence check | No |

## Key Implementation Notes

### A1 APNs Fallback Taken
The APNs handler attempts ES256 JWT mint via `crypto.subtle.importKey('pkcs8', ...)` for P-256 curves. If the mint succeeds (DER→raw R|S conversion), status is `ok`. If `crypto.subtle` throws (e.g., unsupported key format for the specific P8 encoding), the handler falls back to presence-check-only: all five secrets present → `ok` with `message: 'presence_check_fallback'`. This fallback is documented per PLAN A1.

### Resend Handler Not Using Shared Util
`resend-domain-health-check.ts` was NOT reused for the Resend smoke handler. Reasons: the shared util (1) requires a `SupabaseClient` argument (for skip-counter RPC), (2) checks a specific domain status (`app.leanshot.app`), and (3) increments a DB counter on non-verified status. For a smoke probe we only need `GET /domains` → 200/401. The inline handler is 10 lines; importing the shared util would introduce an unnecessary dependency.

### deno.json File-Targeted Test Task
Per RESEARCH Pitfall 2 ([deno test top-level serve trap]): `Deno.serve()` is NOT guarded by `import.meta.main` — `deno test <dir>` would trigger the real HTTP server on import and hang. The `tasks.test` is `deno test --no-check index.test.ts --allow-all` — targeting the single test file prevents importing sibling files; `--allow-all` is required because `Deno.serve()` at module level needs `--allow-net` and test-side `Deno.env` manipulation needs `--allow-env`. This is consistent with the project's baa-expiry-check pattern.

### DEPLOY ORDERING (for close-out)
The `vendor-smoke` Fn MUST be deployed BEFORE plan 52-02's pg_cron migration is `db push`ed. pg_cron fires within 15 minutes of push to a non-existent endpoint. The Fn header comment documents this; it must be surfaced in the Phase 52 close-out task sequence.

### Canonical Env Var Names Used
- `ANTHROPIC_CLINICAL_API_KEY` (per ai-chat/index.ts:45 + A13, NOT REQUIREMENTS.md's `ANTHROPIC_API_KEY_CLINICAL`)
- `CALENDLY_API_KEY` for the user API key; `CALENDLY_OAUTH_CLIENT_ID`/`CALENDLY_OAUTH_CLIENT_SECRET` are NOT smoked (require full OAuth dance; runbook only, per A11)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added --allow-all to deno.json test task**
- **Found during:** Task 3 (test execution)
- **Issue:** `deno test --no-check index.test.ts` fails with `NotCapable: Requires net access to 0.0.0.0:8000` because `Deno.serve()` at module top-level fires on import and needs `--allow-net`; `Deno.env.set/get` in tests also need `--allow-env`.
- **Fix:** Changed `deno.json tasks.test` from `deno test --no-check index.test.ts` to `deno test --no-check index.test.ts --allow-all`. The plan verification grep `'deno test --no-check index.test.ts'` still passes (substring check). Consistent with baa-expiry-check's `--allow-all` pattern.
- **Files modified:** `supabase/functions/vendor-smoke/deno.json`
- **Commit:** 453ab58e

**2. [Rule 1 - Bug] Fixed e.message in comments triggering verify grep**
- **Found during:** Task 2 verification
- **Issue:** The node verify script greps for `e.message` in the source (with comment lines stripped via `replace(/^\s*\/\/.*$/gm, '')`). JSDoc-style block comment text `"NEVER e.message"` was not on its own line, so it survived the line-comment strip and triggered the false positive.
- **Fix:** Rewrote comment phrases to "NEVER the caught error string" (avoids `e.message` literal).
- **Files modified:** `supabase/functions/vendor-smoke/index.ts`
- **Commit:** 53f16d5f

## Known Stubs

None. All vendor handlers are functional — `not_configured` for absent secrets is the intended fail-soft behavior, not a stub.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| supabase/functions/vendor-smoke/deno.json | FOUND |
| supabase/functions/vendor-smoke/index.ts | FOUND (705 lines, min 200) |
| supabase/functions/vendor-smoke/index.test.ts | FOUND (402 lines, min 60) |
| SUMMARY.md | FOUND |
| Commit 53f16d5f (feat tasks 1+2) | FOUND |
| Commit 453ab58e (test task 3) | FOUND |
| VENDOR_REGISTRY keyword in index.ts | OK |
| npm:@supabase/supabase-js@2 in deno.json | OK |
| 6 Deno tests pass | OK |
| deno check passes | OK |

## Threat Flags

None. All new network endpoints are hardcoded probe targets (no SSRF vector per T-52-04). Auth gate and error-logging mitigations were implemented as planned.
