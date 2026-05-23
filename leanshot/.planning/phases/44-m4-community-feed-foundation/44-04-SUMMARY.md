---
phase: 44
plan: "04"
subsystem: community-video-upload
tags: [edge-function, mux, video, tier-gate, webhook, hmac]
dependency_graph:
  requires: [44-01]
  provides: [mux-create-upload-fn, mux-webhook-fn]
  affects: [44-08, 44-10]
tech_stack:
  added: ["npm:@mux/mux-node@14 (Edge Fn only via deno.json npm: specifier)"]
  patterns: ["import.meta.main Deno.serve guard", "tier_effective gate", "passthrough.post_id contract chain", "raw-body-first HMAC verify"]
key_files:
  created:
    - supabase/functions/mux-create-upload/index.ts
    - supabase/functions/mux-create-upload/deno.json
    - supabase/functions/mux-create-upload/index.test.ts
    - supabase/functions/mux-webhook/index.ts
    - supabase/functions/mux-webhook/deno.json
    - supabase/functions/mux-webhook/index.test.ts
  modified: []
decisions:
  - "import.meta.main guard used (not bare denoGlobal?.serve) — denoGlobal?.serve is truthy in deno test env without --allow-net, causing serve to attempt port bind and fail. import.meta.main is false when module is imported by test runner."
  - "mux-webhook uses injectable verifySignature fn (setVerifyForTest) rather than injecting the full Mux client — separates env-var startup logic from signature-verify logic for cleaner unit tests."
  - "trial tier included in mux-create-upload allowlist per Claude's Discretion (D-06 + CONTEXT.md — trial users get full Pro feature access during evaluation period)"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-23T06:40:00Z"
  tasks: 2
  files: 6
---

# Phase 44 Plan 04: mux-create-upload + mux-webhook Edge Functions Summary

Two Mux Edge Functions shipping the community video upload path: tier-gated upload URL minting (mux-create-upload) and HMAC-verified webhook processing (mux-webhook). Both use the project's established helper patterns (verbatim from notification-send) and per-function deno.json for CLI v2.101+ compatibility.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | mux-create-upload Fn + deno.json + tests | a5b4862 | index.ts, deno.json, index.test.ts |
| 2 | mux-webhook Fn + deno.json + tests | 3e8c81d | index.ts, deno.json, index.test.ts |

## What Was Built

### mux-create-upload (a5b4862)

POST /functions/v1/mux-create-upload — user-JWT-authenticated tier-gated Mux direct-upload URL minter.

- User JWT auth: `admin.auth.getUser(bearer)` — not service-role compare (this Fn is called from the browser)
- Tier gate: `tier_effective.tier_label ∈ {pro, lifetime, trial}` → 200; `free` → 403 `VIDEO_TIER_REQUIRED` (T-44-02)
- `max_duration_seconds: 300` (D-05 5-min cap)
- `passthrough: JSON.stringify({ user_id, post_id })` — server-trusted passthrough contract; mux-webhook reads it to scope the UPDATE
- 11 Deno tests covering: 401 no-bearer, 401 invalid-JWT, 403 free, 403 null-tier, 200 pro, 200 lifetime, 200 trial, 500 mux-error, 400 missing-post_id, 405, 204 CORS preflight
- Passthrough assertion test parses recorded call arg and verifies `user_id` + `post_id` keys

### mux-webhook (3e8c81d)

POST /functions/v1/mux-webhook — HMAC-verified Mux webhook processor (T-44-03).

- `await req.text()` BEFORE any processing (raw-body-first pattern from stripe-webhook)
- Injectable `verifySignature` fn (`setVerifyForTest`) for clean unit tests without real Mux credentials
- `video.asset.ready` → UPDATE `community_posts` SET `video_status='ready'`, `mux_playback_id` WHERE `id = passthrough.post_id`
- `video.asset.errored` → UPDATE `community_posts` SET `video_status='rejected'` WHERE `id = passthrough.post_id`
- Missing/malformed passthrough → log + 200 ok (no retry loop per T-44-02b)
- Unknown event types → idempotent 200 ok (forward-compatibility)
- 8 Deno tests: 401 bad-sig, asset.ready+UPDATE assertion, asset.errored+UPDATE assertion, missing-passthrough skip, malformed-passthrough skip, unknown-event skip, 405, raw-body-string assertion

## Security Compliance

| Threat ID | Status |
|-----------|--------|
| T-44-02 (Elevation of Privilege — tier gate) | Mitigated: Deno test proves Free user gets 403 VIDEO_TIER_REQUIRED |
| T-44-03 (Spoofing — webhook HMAC) | Mitigated: Deno test proves invalid signature returns 401 |
| T-44-02b (Tampering — passthrough abuse) | Mitigated: UPDATE scoped by `eq('id', passthrough.post_id)`; missing passthrough skips UPDATE |

## Trial-Tier Discretion

Per CONTEXT.md Claude's Discretion and PLAN.md acceptance criteria: `trial` tier is included in the video-upload allowlist (`['pro', 'lifetime', 'trial']`). Trial users get full Pro feature evaluation including video upload. `trial` is NOT a valid `min_tier` value for spaces (admins configure Free/Pro/Lifetime only) — the trial-as-Pro-equivalent applies only to access decisions.

## passthrough.post_id Contract Chain

The passthrough JSON `{ user_id, post_id }` created by mux-create-upload is the authoritative key connecting a Mux upload to a community post. The contract is:

1. `mux-create-upload` sets `passthrough = JSON.stringify({ user_id: auth.uid(), post_id })` — values come from server-trusted sources
2. Mux includes this passthrough verbatim in webhook events (secured by HMAC)
3. `mux-webhook` parses `event.data.passthrough`, extracts `post_id`, and scopes UPDATE to `community_posts.id = postId`

This replaces any `mux_upload_id` keying — the UPDATE filter is `.eq('id', postId)` NOT `.eq('mux_upload_id', ...)`.

## Deno.serve Guard Pattern

Both functions use `if (import.meta.main && denoGlobal?.serve)` rather than bare `if (denoGlobal?.serve)`. The `denoGlobal?.serve` pattern from notification-send is truthy in `deno test` environments (Deno.serve exists, it just needs `--allow-net`), causing a port-bind attempt that fails without the flag. `import.meta.main` is `false` when the module is imported by the test runner, preventing the serve call entirely.

## deno.json per Function

Each function has its own `deno.json` with `imports` for `npm:@mux/mux-node@14` and `npm:@supabase/supabase-js@2`. Per `reference_supabase_functions_deploy_import_map_flag`, CLI v2.101.0+ silently ignores `--import-map`; per-function deno.json is the safe pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] import.meta.main guard instead of bare denoGlobal?.serve**
- **Found during:** Task 1 test execution
- **Issue:** The plan specified `denoGlobal?.serve` guard (from notification-send) but this is truthy in `deno test` context — Deno.serve exists but requires `--allow-net`. The test would fail with `NotCapable: Requires net access to "0.0.0.0:8000"`.
- **Fix:** Added `import.meta.main &&` before `denoGlobal?.serve`. This properly skips the `Deno.serve()` call when the module is imported by the test runner (where `import.meta.main === false`). The `denoGlobal?.serve` check remains as secondary safety net.
- **Files modified:** `supabase/functions/mux-create-upload/index.ts`, `supabase/functions/mux-webhook/index.ts`
- **Commits:** a5b4862, 3e8c81d

**2. [Rule 1 - Bug] Injectable verifySignature fn for mux-webhook tests**
- **Found during:** Task 2 test execution
- **Issue:** The plan specified injecting a full Mux client mock via `setMuxForTest`. However, `getMux()` reads `MUX_WEBHOOK_SECRET` from env (not set in tests), throws `Error: MUX_WEBHOOK_SECRET must be set`, which is caught by the `try/catch` around `verifySignature`, returning 401 for all tests.
- **Fix:** Introduced `setVerifyForTest(fn)` / `resetVerifyForTest()` which injects a `VerifySignatureFn` directly. The handler calls `doVerifySignature(body, headers)` which dispatches to the override (test) or the real Mux client (production). Cleaner separation: env-var validation happens at `getMux()` level for production; tests bypass it entirely.
- **Files modified:** `supabase/functions/mux-webhook/index.ts`, `supabase/functions/mux-webhook/index.test.ts`
- **Commits:** 3e8c81d

## Known Stubs

None. Both functions are complete implementations with no placeholder data. Mux API credentials (`MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`) are required at deploy time — the functions return clear 500/401 errors if missing. Setting these secrets is gated behind plan 44-10's HUMAN checkpoint.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes beyond what was declared in the plan's threat model.

## Self-Check

- [x] `supabase/functions/mux-create-upload/index.ts` exists
- [x] `supabase/functions/mux-create-upload/deno.json` exists
- [x] `supabase/functions/mux-create-upload/index.test.ts` exists (11 tests, all passing)
- [x] `supabase/functions/mux-webhook/index.ts` exists
- [x] `supabase/functions/mux-webhook/deno.json` exists
- [x] `supabase/functions/mux-webhook/index.test.ts` exists (8 tests, all passing)
- [x] Commit a5b4862 exists (Task 1)
- [x] Commit 3e8c81d exists (Task 2)
- [x] 19/19 total Deno tests pass: `$HOME/.deno/bin/deno test --no-check supabase/functions/mux-create-upload/ supabase/functions/mux-webhook/`

## Self-Check: PASSED
