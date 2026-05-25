---
phase: 54-push-notifications
plan: "01"
subsystem: push-notifications
tags: [migrations, schema, types, tdd, push-notifications, wave-0]
dependency_graph:
  requires: []
  provides:
    - push_subscriptions.platform (web|ios|android discriminator)
    - push_subscriptions.device_token (APNs/FCM token column)
    - push_subscriptions.failure_count (auto-prune counter)
    - helpdesk-reply category in all 4 CHECK constraints
    - notification_category_config helpdesk-reply seed row
    - Category union (server): full 15 + helpdesk-reply
    - Category union (client): full 15 + helpdesk-reply
    - push-dispatch RED test scaffold (6 tests, PUSH-04/07/08)
    - push.test.ts RED test scaffold (5 tests, PUSH-02/03/05)
  affects:
    - push_subscriptions (ALTER TABLE)
    - notification_settings (CHECK widened)
    - notification_category_config (CHECK widened + seed)
    - user_notifications (CHECK widened)
    - notification_dismissal_state (CHECK widened)
    - supabase/functions/_shared/notification-types.ts (Category union)
    - leanshot/src/lib/notifications/types.ts (Category union)
tech_stack:
  added: []
  patterns:
    - Forward-dated migration with idempotent DO $$ guard blocks
    - P49 widening pattern: single BEGIN/COMMIT transaction across all 4 tables
    - Wave-0 RED scaffold: import from absent module + stub target
    - Deno test: __internal + injectable transport seam
    - Vitest: vi.mock inline for uninstalled Capacitor plugin
key_files:
  created:
    - supabase/migrations/20280201000001_p54_push_subscriptions_platform.sql
    - supabase/migrations/20280201000002_p54_notification_helpdesk_widening.sql
    - supabase/functions/push-dispatch/index.test.ts
    - supabase/functions/push-dispatch/deno.json
    - leanshot/src/lib/notifications/types.ts (extended)
  modified:
    - supabase/functions/_shared/notification-types.ts (extended)
    - leanshot/src/lib/native/push.test.ts (created)
decisions:
  - "platform discriminator reuses push_subscriptions (D-02 decision); no parallel native-token table"
  - "helpdesk-reply slug follows kebab convention matching existing community categories"
  - "quiet-hours enforcement in push-dispatch only (not notification-fire-decision) to avoid email gating"
  - "urgency derived from cfg.urgent_escalation (DB-authoritative) not client payload (Pitfall 3 defense)"
  - "Wave-0 scaffold pattern: 6+5 RED tests document close-out target for 54-02/54-03"
  - "Category union drift resolved inline in this plan (Open Question 3)"
metrics:
  duration: "~7m"
  completed: "2026-05-25"
  task_count: 3
  file_count: 6
---

# Phase 54 Plan 01: Foundation Migrations, Types, and Scaffolds Summary

2 forward-dated migrations extending push_subscriptions for cross-platform native push + widening helpdesk-reply category across all 4 notification CHECK constraints; both Category type unions synced to full 15+1; Wave-0 RED test scaffolds for push-dispatch fan-out (6 tests) and native push registration (5 tests).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | push_subscriptions platform migration | `3d69cc6f` | supabase/migrations/20280201000001_p54_push_subscriptions_platform.sql |
| 2 | helpdesk-reply widening + Category union sync | `2bbe5cbc` | supabase/migrations/20280201000002_p54_notification_helpdesk_widening.sql, _shared/notification-types.ts, leanshot/src/lib/notifications/types.ts |
| 3 | Wave-0 RED scaffolds + deno.json | `8fedecb7` | supabase/functions/push-dispatch/index.test.ts, supabase/functions/push-dispatch/deno.json, leanshot/src/lib/native/push.test.ts |

## Wave-0 RED Scaffold Inventory

### push-dispatch/index.test.ts — 6 tests (all RED, PUSH-04/07/08)

| Test | Covers | Why RED |
|------|--------|---------|
| T1 — quiet-hours blocks non-urgent at 23:00 UTC | PUSH-07 | push-dispatch/index.ts absent until 54-02 |
| T2 — urgent override (clinic-alerts) delivers at 23:00 UTC | PUSH-07 Pitfall 3 | push-dispatch/index.ts absent until 54-02 |
| T3 — fan-out calls web/apns/fcm transport per platform | PUSH-04 | push-dispatch/index.ts absent until 54-02 |
| T4 — fail-soft: absent APNs/FCM secrets skip platform (no throw) | PUSH-04 | push-dispatch/index.ts absent until 54-02 |
| T5 — failure_count increments; row deleted at 3 consecutive failures | PUSH-08 | push-dispatch/index.ts absent until 54-02 |
| T6 — success resets failure_count to 0 | PUSH-08 | push-dispatch/index.ts absent until 54-02 |

**Expected failure mode:** `Module not found: push-dispatch/index.ts` — all 6 tests blocked at import.

**RED verification:** `$HOME/.deno/bin/deno test --no-check supabase/functions/push-dispatch/index.test.ts` → error: Module not found.

### leanshot/src/lib/native/push.test.ts — 5 tests (all RED, PUSH-02/03/05)

| Test | Covers | Why RED |
|------|--------|---------|
| T1 — web path returns {ok:false} | PUSH-02 | ./push throws (Phase 12 stub) |
| T2 — checkPermissions BEFORE requestPermissions (soft-prompt order) | PUSH-05 | ./push throws (Phase 12 stub) |
| T3 — native iOS registration → POST {platform:'ios', device_token} | PUSH-02 | ./push throws; @capacitor/push-notifications uninstalled |
| T4 — native Android registration → POST {platform:'android', device_token} | PUSH-03 | ./push throws; @capacitor/push-notifications uninstalled |
| T5 — permission denied returns {ok:false, error:'permission-denied'} | PUSH-05 | ./push throws (Phase 12 stub) |

**Expected failure mode:** Vitest module resolution error (@capacitor/push-notifications not in package.json) + stub throw.

**Close-out check:** 54-02 close-out should verify 6 push-dispatch tests GREEN. 54-03 close-out should verify 5 push.test.ts tests GREEN.

## Migration Details

### 20280201000001_p54_push_subscriptions_platform.sql

Forward-dated (past latest applied 20280101000002). Idempotent:
- `ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'web'` — backfills all existing web rows
- `ADD COLUMN IF NOT EXISTS device_token text` — nullable APNs/FCM token
- `ADD COLUMN IF NOT EXISTS failure_count int NOT NULL DEFAULT 0`
- `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT push_subscriptions_platform_chk` CHECK (web|ios|android)
- `ALTER COLUMN endpoint/p256dh/auth DROP NOT NULL` — native rows leave these NULL
- `DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_nonempty_chk/_p256dh_nonempty_chk/_auth_nonempty_chk` — nonempty CHECKs reject NULL native rows
- `ADD CONSTRAINT push_subscriptions_web_or_native_chk` — structural integrity: web requires endpoint+p256dh+auth NOT NULL; ios/android requires device_token NOT NULL (T-54-01-01)
- `CREATE UNIQUE INDEX push_subscriptions_user_device_token_uniq WHERE device_token IS NOT NULL` (partial; T-54-01-02)

### 20280201000002_p54_notification_helpdesk_widening.sql

Forward-dated (immediately after 20280201000001). Follows P49 pattern verbatim:
- Single `BEGIN; ... COMMIT;` transaction
- DROP+ADD `_category_chk` on all 4 tables: notification_settings, notification_category_config, user_notifications, notification_dismissal_state
- Full 16-category list: original 15 (P49) + helpdesk-reply
- `INSERT ... ON CONFLICT (category) DO NOTHING` seed row for helpdesk-reply (daily_cap=10, weekly_cap=50, urgent_escalation=false, push/email/in_app=true)
- Non-comment COMMENT ON CONSTRAINT statements so plan-checker greps count helpdesk-reply as live references

## Category Union Drift Resolution

**Pre-existing drift fixed in this plan (Open Question 3):**

| File | Before (categories) | After (categories) |
|------|---------------------|-------------------|
| `_shared/notification-types.ts` | 9 (missing event_*, banned_word_escalate, digests) | 16 (full 15 + helpdesk-reply) |
| `leanshot/src/lib/notifications/types.ts` | 7 (5 core + 2 digests, missing community+event+banned) | 16 (full 15 + helpdesk-reply) |

The `CATEGORIES` const in the client types.ts preserves the original 5-item ordering at the front to protect any existing snapshot tests that depend on index positions.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Worktree Branch Safety Incident (resolved)

During Task 1, the first commit landed on `main` in the primary checkout (cwd was `/Users/karstenhaldan/minisite` not the worktree). Recovery:
1. File was copied to the worktree's path.
2. `git reset --hard 30f50eec` restored main to its correct base.
3. The commit was re-applied cleanly to `worktree-agent-a2f7f92d1cf6dee73` from the worktree root.

All subsequent Task 2 and Task 3 commits were made correctly from the worktree.

## Known Stubs

The following stubs are intentional Wave-0 state documented for close-out tracking:

| Stub | File | Reason |
|------|------|--------|
| `push-dispatch/index.ts` absent | push-dispatch/index.test.ts imports it | Ships in 54-02; 6 tests will turn GREEN |
| `registerForPush()` throws | leanshot/src/lib/native/push.ts | Phase 12 stub replaced in 54-03; 5 tests will turn GREEN |
| `@capacitor/push-notifications` not installed | leanshot/src/lib/native/push.test.ts | Installed in 54-03 with --legacy-peer-deps |

## Threat Surface Scan

No new security-relevant surface introduced in this plan. Migrations run server-side (no new network endpoints). CHECK constraints reduce attack surface. Type unions don't expose APIs. The partial unique index (T-54-01-02) mitigates token-stuffing DoS.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `20280201000001_p54_push_subscriptions_platform.sql` exists | FOUND |
| `20280201000002_p54_notification_helpdesk_widening.sql` exists | FOUND |
| `supabase/functions/push-dispatch/index.test.ts` exists | FOUND |
| `supabase/functions/push-dispatch/deno.json` exists | FOUND |
| `leanshot/src/lib/native/push.test.ts` exists | FOUND |
| Commit `3d69cc6f` (Task 1) exists | FOUND |
| Commit `2bbe5cbc` (Task 2) exists | FOUND |
| Commit `8fedecb7` (Task 3) exists | FOUND |
| No reference to `device_push_tokens` in migration | CONFIRMED |
| `helpdesk-reply` in server Category union | CONFIRMED |
| `helpdesk-reply` in client Category union | CONFIRMED |
| `banned_word_escalate` in server Category union | CONFIRMED |
| `failure_count` in migration | CONFIRMED |
| Deno RED test: 6 tests blocked (Module not found) | CONFIRMED |
| Vitest RED test: 5 tests (stub throws) | CONFIRMED |
