---
phase: 42-v1-3-polish-closeout
plan: "05"
status: complete
completed: 2026-05-19
---

# Plan 42-05 Summary — Notifications backend

Backend half of POLISH-05 + POLISH-06 (smart notifications + self-serve opt-out). UI ships in Wave 3 plan 42-08 — POLISH-05/06 close when that lands.

## Tasks

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | Migrations — 5 tables + RLS + admin seed | ✅ Complete | `28980f3` |
| 2 | Shared types + fire-decision pure function + 5 integration tests | ✅ Complete | `dad95f7` |
| 3 | 4 Edge Fns + Deno test + fresh-user dismissal test | ✅ Complete | `357910e` |
| 4 | HUMAN deploy bundle | ✅ Complete (operator auto-run) | `<this commit>` |

## Artifacts

**Migrations applied** (Wave 2 batch push 2026-05-19):
- `20270704000001_notification_settings.sql` — per-user × category × channel preference matrix; UNIQUE(user_id, category, channel); DOWNWARD-cap trigger (users can only DECREASE their cap below admin default — never exceed)
- `20270704000002_notification_category_config.sql` — admin-tunable per-category limits/defaults
- `20270704000003_user_notifications.sql` — append-only fire history with cap-window indexes
- `20270704000004_notification_dismissal_state.sql` — D-05 sentiment tracking with UPSERT-compatible schema (per plan-checker iter-1 inline-fix; fresh-user dismissal path proven by integration test)
- `20270704000005_push_subscriptions.sql` — VAPID endpoints UNIQUE(user_id, endpoint)
- `20270704000006_notification_rls.sql` — deny-by-default + per-user CRUD; admin-only writes on category_config
- `20270704000007_notification_category_config_seed.sql` — 5 D-04 matrix rows (idempotent ON CONFLICT)

**Seed rows verified live** (`SELECT count(*) FROM notification_category_config` → 5):
- `ai-insights` daily_cap=3 weekly_cap=null urgent=false
- `billing` daily_cap=null weekly_cap=1 urgent=false
- `clinic-alerts` daily_cap=null weekly_cap=null urgent=true
- `dose-reminders` daily_cap=null weekly_cap=null urgent=false
- `marketing` daily_cap=null weekly_cap=1 urgent=false

**Edge Functions deployed:**
- `notification-send` (**1.663 MB** — bundle size confirms `npm:web-push@3.6.7` resolved cleanly at deploy-time; matches 42-01 spike provisional decision) — service-role POST, parallel context load (settings + cfg + dismissal + fired-counts), `shouldFire()` decision, fan-out (email-router PHI-aware + npm:web-push + in-app via user_notifications INSERT), source-of-truth row with `fired_at` + actual channels. **D-13 PHI gate**: zod-validates clinic-alerts payload shape (subject + deeplink only; no PHI body fields).
- `notification-dismiss` (692 kB) — user-JWT POST, RLS-scoped UPDATE `user_notifications.dismissed_at` then **UPSERT** `notification_dismissal_state` (per plan-checker iter-1 fresh-user fix). `throttle_until = now() + interval '7 days'` when `consecutive_dismissals + 1 >= 3`.
- `notification-snooze` (691 kB) — user-JWT POST, `snoozed_until = now() + (duration_days * '1 day')` on all 3 channel rows for the category. `duration_days ∈ {1, 7, 30}`.
- `push-subscribe` (690 kB) — user-JWT POST, INSERT ON CONFLICT (user_id, endpoint) DO UPDATE; JWT subject overrides body user_id (T-42-05-02 spoof mitigation).

**Shared modules:**
- `supabase/functions/_shared/notification-types.ts` — Category / Channel / NotificationSetting / CategoryConfig / DismissalState / FireDecision types
- `supabase/functions/_shared/notification-fire-decision.ts` — PURE function `shouldFire({...})` returning FireDecision with per-channel `reasons` map for debug audit

**Tests:**
- `leanshot/tests/rls/notification-settings-rls.test.ts` — cross-tenant proof (admin.generateLink + /auth/v1/verify ES256)
- `leanshot/tests/integration/notification-frequency-cap.test.ts` — daily-cap effective math
- `leanshot/tests/integration/notification-sentiment-throttle.test.ts` — `throttle_until > now()` halves effective cap (D-05)
- `leanshot/tests/integration/notification-snooze.test.ts` — snoozed channels suppress fire
- `leanshot/tests/integration/notification-urgent.test.ts` — clinic-alerts bypasses caps when `urgent_escalation=true`
- `leanshot/tests/integration/notification-user-cap-downward.test.ts` — DOWNWARD cap trigger rejects user cap > admin default
- `leanshot/tests/integration/notification-dismissal-fresh-user.test.ts` — **fresh-user path** (event 1 → counter=1, event 3 → throttle_until set) — proves the plan-checker iter-1 UPSERT inline-fix

## Production verification (executed inline this session)

1. Pre-flight: working tree clean of Wave 2 schema files (all committed)
2. `supabase db push --linked` already ran in 42-06 deploy bundle — applied `20270704000001..00007` in batch ✓
3. `db query "SELECT count(*) FROM notification_category_config"` → 5 ✓
4. `db query "SELECT category, daily_cap, weekly_cap, urgent_escalation FROM notification_category_config ORDER BY category"` → matches D-04 matrix exactly ✓
5. `supabase functions deploy notification-send notification-dismiss notification-snooze push-subscribe --project-ref ytnsipxxmzgaebkqmokp` → all 4 deployed ✓ (notification-send 1.663 MB confirms npm:web-push@3.6.7 bundled)
6. Smoke-test SKIPPED per operator decision — Wave 3 plan 42-08 (notif UI) exercises the Fns via real user JWTs.

## Spike decision validation (cross-ref 42-01)

The 1.663 MB `notification-send` bundle confirms `npm:web-push@3.6.7` resolved AND bundled cleanly at deploy-time — same evidence shape as the 42-01 spike (128.7 kB spike bundle). **Runtime correctness still TBD until first user-fired push** — per 42-01 hot-patch contingency, if `notification-send` throws on `npm:web-push.sendNotification(...)` at runtime, swap to the `crypto.subtle` helpers from `supabase/functions/spike-web-push/index.ts` (`importVapidPrivateKey` + `signVapidJwt`) and add RFC 8291 AES-128-GCM payload encryption.

## REQ-IDs

- `POLISH-05` — partial: send + fan-out + frequency cap + snooze + sentiment-throttle + urgent escalation live. Notification preferences UI (plan 42-08) closes POLISH-05.
- `POLISH-06` — partial: per-category opt-out enforced server-side via `notification_settings.enabled`. Self-serve UI (plan 42-08) closes POLISH-06.

## Coordination note

This SUMMARY written by the orchestrator (not a continuation gsd-executor agent) — SendMessage continuation isn't surfaced in this runtime. The 42-05 background executor returned `status: completed` with the Task 4 checkpoint message; orchestrator executed the deploy bundle inline.
