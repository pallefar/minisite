---
phase: 54-push-notifications
plan: "04"
subsystem: notification-send
tags: [push-notifications, web-push, helpdesk-reply, fan-out-filter]
dependency_graph:
  requires: [54-01]
  provides: [web-only-push-filter, helpdesk-reply-category]
  affects: [supabase/functions/notification-send/index.ts]
tech_stack:
  added: []
  patterns: [platform-eq-filter, VALID_CATEGORIES-widening]
key_files:
  modified:
    - supabase/functions/notification-send/index.ts
    - supabase/functions/notification-send/index.test.ts
decisions:
  - "Filter approach chosen for push channel split: .eq('platform','web') scopes notification-send to web rows only; push-dispatch owns native APNs/FCM rows. Avoids circular Fn calls (Pitfall 6 / Open Question 1)."
  - "helpdesk-reply added to VALID_CATEGORIES in same plan that accepts it — category set drift (T-54-04-01) mitigated atomically."
metrics:
  duration: "~15 minutes"
  completed: "2026-05-25"
  tasks_completed: 2
  files_modified: 2
---

# Phase 54 Plan 04: notification-send Web Filter + helpdesk-reply Summary

**One-liner:** Web-only push filter via `.eq('platform','web')` on push_subscriptions + helpdesk-reply added to VALID_CATEGORIES, preventing double-send with push-dispatch and wiring PUSH-06.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Restrict fanOutPush to platform='web' + add helpdesk-reply | e6358fbe | supabase/functions/notification-send/index.ts |
| 2 | Test coverage — web-only filter + helpdesk-reply accepted | c7cddbda | supabase/functions/notification-send/index.test.ts |

## Changes Made

### Task 1: fanOutPush platform filter + VALID_CATEGORIES widening

In `fanOutPush`, the `push_subscriptions` select chain now includes `.eq('platform', 'web')` after `.eq('user_id', userId)`. This ensures notification-send only queries web-push subscriptions. APNs/FCM rows (platform='ios' or 'android') are left exclusively to push-dispatch, eliminating double-send without any Fn-to-Fn calls.

`'helpdesk-reply'` was appended to the `VALID_CATEGORIES` Set. The Category union member was already present from plan 54-01's migration (`20280201000002_p54_notification_helpdesk_widening.sql`), so the Set entry type-checks cleanly.

Email, in-app fan-out paths and the D-13 PHI gate remain untouched.

### Task 2: New test cases T9, T9b, T10

Three new `Deno.test` cases added to `index.test.ts`:

- **T9** — `validateBody` accepts `helpdesk-reply` category (PUSH-06; would have been `category_invalid` before this plan)
- **T9b** — Regression guard: a non-existent category still returns `category_invalid`
- **T10** — Records all `.eq()` calls on the `push_subscriptions` query chain and asserts `.eq('platform', 'web')` was called; also asserts exactly one web delivery occurred

All 17 tests pass (T1-T8b pre-existing + T9, T9b, T10 new).

**Note on test flags:** Running the test file requires `--allow-env --allow-net` in addition to `--no-check`. The `--allow-env` requirement is from a Smithy npm package read of `SMITHY_NEW_RETRIES_2026` at static init; the `--allow-net` requirement is from the pre-existing `Deno.serve` top-level call (guarded by `if (denoGlobal?.serve)` but the guard does not prevent the net permission requirement). Both are pre-existing infrastructure constraints per `reference_deno_test_top_level_serve_trap.md`.

## Deviations from Plan

**1. [Rule 3 - Blocking] Deno test flags extended to --allow-env --allow-net**
- **Found during:** Task 2 verification
- **Issue:** Plan's verify command used `--no-check` only; Smithy npm package triggers `NotCapable: Requires env access to "SMITHY_NEW_RETRIES_2026"` and `Deno.serve` guard triggers `NotCapable: Requires net access to "0.0.0.0:8000"` — both pre-existing constraints per `reference_deno_test_top_level_serve_trap.md`
- **Fix:** Added `--allow-env --allow-net` to the test invocation; all 17 tests pass
- **Files modified:** None (test invocation flags only)
- **Commit:** Not a code change

## Known Stubs

None — all new behavior is wired.

## Threat Flags

None — no new network endpoints or auth paths introduced. The `platform='web'` filter is a narrowing of an existing query (reduces surface, does not expand it).

## Self-Check: PASSED

Files exist:
- [x] supabase/functions/notification-send/index.ts — confirmed `.eq('platform', 'web')` and `helpdesk-reply` present
- [x] supabase/functions/notification-send/index.test.ts — confirmed T9/T9b/T10 present

Commits exist:
- [x] e6358fbe — feat(54-04): web-only push filter + helpdesk-reply category in notification-send
- [x] c7cddbda — test(54-04): add T9/T9b/T10 for helpdesk-reply acceptance + web-only push filter
