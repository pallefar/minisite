---
phase: 54-push-notifications
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/20280201000001_p54_push_subscriptions_platform.sql
  - supabase/migrations/20280201000002_p54_notification_helpdesk_widening.sql
  - supabase/functions/_shared/notification-types.ts
  - leanshot/src/lib/notifications/types.ts
  - supabase/functions/push-dispatch/index.test.ts
  - supabase/functions/push-dispatch/deno.json
  - leanshot/src/lib/native/push.test.ts
autonomous: true
requirements: [PUSH-06, PUSH-07, PUSH-08]
must_haves:
  truths:
    - "push_subscriptions has platform, device_token, failure_count columns; native rows allowed (endpoint/p256dh/auth nullable)"
    - "Existing web rows backfill to platform='web' without breaking the (user_id,endpoint) unique constraint"
    - "helpdesk-reply is an accepted category across all 4 notification_* CHECK constraints and seeded in notification_category_config"
    - "Server + client Category type unions both include all 15 existing categories plus helpdesk-reply (drift resolved)"
    - "RED test scaffolds exist for push-dispatch (fan-out/quiet-hours/prune) and native push registration"
  artifacts:
    - path: "supabase/migrations/20280201000001_p54_push_subscriptions_platform.sql"
      provides: "platform + device_token + failure_count columns; platform CHECK; web-or-native CHECK; partial unique index on (user_id, device_token)"
      contains: "failure_count"
    - path: "supabase/migrations/20280201000002_p54_notification_helpdesk_widening.sql"
      provides: "helpdesk-reply widening across 4 CHECK constraints + category_config seed"
      contains: "helpdesk-reply"
    - path: "supabase/functions/_shared/notification-types.ts"
      provides: "server Category union incl. all 15 existing + helpdesk-reply"
      contains: "helpdesk-reply"
    - path: "leanshot/src/lib/notifications/types.ts"
      provides: "client Category union incl. all 15 existing + helpdesk-reply"
      contains: "helpdesk-reply"
    - path: "supabase/functions/push-dispatch/index.test.ts"
      provides: "RED Deno test scaffold for PUSH-04/07/08"
      min_lines: 40
    - path: "leanshot/src/lib/native/push.test.ts"
      provides: "RED vitest scaffold for PUSH-02/03/05"
      min_lines: 30
  key_links:
    - from: "supabase/migrations/20280201000001_p54_push_subscriptions_platform.sql"
      to: "push_subscriptions.failure_count"
      via: "ALTER TABLE ADD COLUMN"
      pattern: "failure_count"
    - from: "supabase/functions/_shared/notification-types.ts"
      to: "Category union"
      via: "type widening"
      pattern: "helpdesk-reply"
---

<objective>
Lay the cross-platform push foundation: the schema migrations, the shared type widening, and the Wave-0 RED test scaffolds that every downstream Phase 54 plan implements against.

Purpose: push-dispatch (54-02), native registration (54-03), notification-send filter (54-04), and the settings UI (54-05) all need (a) the `platform`/`device_token`/`failure_count` columns, (b) `helpdesk-reply` accepted by the DB + both type unions, and (c) test files to turn GREEN. Shipping these first prevents a scavenger hunt and avoids three executors racing on the shared type files.
Output: 2 forward-dated migrations, 2 widened Category unions, 2 RED test scaffolds, 1 per-Fn deno.json.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/54-push-notifications/54-RESEARCH.md
@.planning/phases/54-push-notifications/54-CONTEXT.md

<interfaces>
<!-- Existing push_subscriptions schema (supabase/migrations/20270704000005_push_subscriptions.sql) -->
Columns: id uuid PK, user_id uuid NOT NULL FK auth.users ON DELETE CASCADE,
  endpoint text NOT NULL, p256dh text NOT NULL, auth text NOT NULL,
  user_agent text, created_at, updated_at.
Unique: push_subscriptions_user_endpoint_uniq (user_id, endpoint).
Index: push_subscriptions_user_id_idx (user_id).
Nonempty CHECKs on endpoint/p256dh/auth (length > 0) — these MUST be relaxed
for native rows.

<!-- Latest applied migration timestamp in repo: 20280101000002. New migrations
     MUST be forward-dated PAST this (back-dated migration blocks supabase db push
     — memory reference_supabase_back_dated_migration_blocks_push). Use 20280201*. -->

<!-- Live category list as of P49 widening (20271001000005) — copy verbatim into the
     helpdesk-reply widening, then append 'helpdesk-reply': -->
'dose-reminders','ai-insights','clinic-alerts','billing','marketing',
'community-mentions','community-replies','community-dm','community-admin-report',
'event_reminders_1d','event_reminders_1h','event_promotion',
'banned_word_escalate','daily_community_digest','weekly_community_digest'

<!-- Server Category union currently (supabase/functions/_shared/notification-types.ts)
     has only 9 of the 15 live categories — it is MISSING the event_*, banned_word_escalate,
     and both _digest categories. Client union (leanshot/src/lib/notifications/types.ts)
     has only 7 (5 core + 2 digests). Both unions MUST be synced to the full 15 + helpdesk-reply. -->

<!-- push-dispatch service-role bearer + Deno.serve guard pattern to mirror in the
     scaffold — from push-subscribe/index.ts lines 168-181:
     const denoGlobal: any = (globalThis as any).Deno;
     if (denoGlobal?.serve) { denoGlobal.serve(handler); }
     export const __internal = { handler, setAdminForTest, resetAdminForTest, validateBody }; -->

<!-- notification-send injectable transport seam (the model push-dispatch must follow):
     type PushFn = (subscription, payload, options:{TTL,urgency}) => Promise<{ok,status?}>;
     let _pushFn = defaultPushFn; setPushFnForTest(fn); resetPushFnForTest();
     exposed via __internal. push-dispatch needs an analogous per-platform seam. -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Forward-dated push_subscriptions platform migration</name>
  <files>supabase/migrations/20280201000001_p54_push_subscriptions_platform.sql</files>
  <action>
    Create a single atomic (BEGIN/COMMIT) idempotent migration that extends public.push_subscriptions per D-01..D-03 / PUSH-02/03/08. Timestamp MUST be 20280201000001 (forward-dated past the latest applied migration 20280101000002 — a back-dated file blocks `supabase db push` entirely; memory reference_supabase_back_dated_migration_blocks_push).
    Steps: (1) ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'web' (backfills existing web rows); ADD COLUMN IF NOT EXISTS device_token text; ADD COLUMN IF NOT EXISTS failure_count int NOT NULL DEFAULT 0.
    (2) Drop+add CHECK push_subscriptions_platform_chk CHECK (platform IN ('web','ios','android')).
    (3) Relax the web-only NOT NULLs so native rows are valid: ALTER COLUMN endpoint/p256dh/auth DROP NOT NULL. ALSO drop the length-based nonempty CHECKs (push_subscriptions_endpoint_nonempty_chk, _p256dh_nonempty_chk, _auth_nonempty_chk) via DROP CONSTRAINT IF EXISTS — they reference now-nullable columns and would reject native rows where these are NULL.
    (4) Add a structural CHECK push_subscriptions_web_or_native_chk: web rows require endpoint+p256dh+auth NOT NULL; ios/android rows require device_token NOT NULL.
    (5) CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_user_device_token_uniq ON (user_id, device_token) WHERE device_token IS NOT NULL (partial — keeps existing (user_id,endpoint) unique for web rows intact).
    Wrap each ALTER that can raise duplicate_object in a DO $$ ... exception when duplicate_object then null; end $$ block following the existing migration's pattern (lines 34-40). Add a non-comment `comment on column ... is '...'` documenting platform so plan-checker greps see live references. Do NOT create a parallel native-token table (D-02). Do NOT mention `device_push_tokens` (REQUIREMENTS.md PUSH-02 names it, but D-02 supersedes: reuse push_subscriptions) — keep the rejected name out of the committed file (memory feedback_negation_grep_defeated_by_comment_string).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && grep -v '^--' supabase/migrations/20280201000001_p54_push_subscriptions_platform.sql | grep -Eq "platform|device_token|failure_count" && grep -v '^--' supabase/migrations/20280201000001_p54_push_subscriptions_platform.sql | grep -q "drop not null" && ! grep -q "device_push_tokens" supabase/migrations/20280201000001_p54_push_subscriptions_platform.sql && echo PASS</automated>
  </verify>
  <done>Migration adds 3 columns, relaxes NOT NULL + drops nonempty CHECKs on endpoint/p256dh/auth, adds platform + web-or-native CHECKs, adds partial unique index; idempotent; forward-dated; no reference to device_push_tokens.</done>
</task>

<task type="auto">
  <name>Task 2: helpdesk-reply category widening migration + sync both Category unions</name>
  <files>supabase/migrations/20280201000002_p54_notification_helpdesk_widening.sql, supabase/functions/_shared/notification-types.ts, leanshot/src/lib/notifications/types.ts</files>
  <action>
    Per PUSH-06 / Pitfall 4 (VALID_CATEGORIES drift). Create migration 20280201000002 (forward-dated; immediately after Task 1's) following the P49 widening pattern verbatim (supabase/migrations/20271001000005): single BEGIN/COMMIT transaction, drop+add the category CHECK on ALL 4 tables (notification_settings, notification_category_config, user_notifications, notification_dismissal_state) listing the full 15 live categories PLUS 'helpdesk-reply'. Then INSERT the helpdesk-reply row into notification_category_config (daily_cap=10, weekly_cap=50, urgent_escalation=false, push_enabled_default=true, email_enabled_default=true, in_app_enabled_default=true) ON CONFLICT (category) DO NOTHING. Add a non-comment `comment on constraint` line referencing helpdesk-reply on at least one table so the grep gate counts it as a live reference.
    THEN widen both Category type unions to the full 15 + 'helpdesk-reply' (resolving the pre-existing drift per Open Question 3): in supabase/functions/_shared/notification-types.ts add the missing event_reminders_1d/_1h, event_promotion, banned_word_escalate, daily_community_digest, weekly_community_digest AND helpdesk-reply. In leanshot/src/lib/notifications/types.ts add community-mentions, community-replies, community-dm, community-admin-report, event_reminders_1d/_1h, event_promotion, banned_word_escalate AND helpdesk-reply (it already has the 5 core + 2 digests). Keep the existing CATEGORIES const ordering in the client file unchanged for the first 5; append new members so existing snapshot ordering is preserved. Do NOT touch NotificationsSubtab MATRIX_CATEGORIES here (54-05 owns that).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && grep -c "helpdesk-reply" supabase/migrations/20280201000002_p54_notification_helpdesk_widening.sql | awk '$1>=5' >/dev/null && grep -q "helpdesk-reply" supabase/functions/_shared/notification-types.ts && grep -q "helpdesk-reply" leanshot/src/lib/notifications/types.ts && grep -q "banned_word_escalate" supabase/functions/_shared/notification-types.ts && echo PASS</automated>
  </verify>
  <done>helpdesk-reply present in all 4 CHECK constraints + config seed; both Category unions synced to full 15 + helpdesk-reply; client CATEGORIES const ordering preserved for first 5.</done>
</task>

<task type="auto">
  <name>Task 3: Wave-0 RED test scaffolds (push-dispatch + native push) + deno.json</name>
  <files>supabase/functions/push-dispatch/index.test.ts, supabase/functions/push-dispatch/deno.json, leanshot/src/lib/native/push.test.ts</files>
  <action>
    Create RED scaffolds the downstream plans turn GREEN (Nyquist Rule). These import from files that do NOT exist yet (push-dispatch/index.ts, the rebuilt push.ts) so they fail until 54-02/54-03 ship — that is the intended RED state.
    (1) supabase/functions/push-dispatch/deno.json — per-Fn deno.json mirroring the project pattern (no import-map reliance; memory reference_supabase_functions_deploy_import_map_flag). Minimal `{ "imports": {} }` or copy an existing per-Fn deno.json shape if one exists alongside another function.
    (2) supabase/functions/push-dispatch/index.test.ts — Deno tests covering PUSH-04/07/08, importing { __internal } from './index.ts' and a per-platform injectable transport seam. Write test names + bodies asserting: T1 quiet-hours blocks non-urgent at 23:00 in a UTC user's tz (isQuietHours returns true → skipped); T2 quiet-hours urgent override delivers a clinic-alerts (urgent_escalation=true) push at 23:00 (Pitfall 3 — patient-safety; use cfg.urgent_escalation NOT client payload); T3 fan-out calls the web transport for platform='web' rows, the apns transport for ios rows, the fcm transport for android rows via mocked seams; T4 fail-soft: when a platform's secret env is absent the platform is skipped (no throw); T5 failure_count increments on failure, row deleted at 3 consecutive failures (PUSH-08); T6 success resets failure_count to 0. Guard against the Deno.serve top-level trap by importing only __internal (memory reference_deno_test_top_level_serve_trap). Since index.ts is absent, the import resolves RED — acceptable.
    (3) leanshot/src/lib/native/push.test.ts — vitest tests covering PUSH-02/03/05 using vi.mock for '@capacitor/push-notifications' and the existing __mocks__/capacitor-core.ts seam (Capacitor.getPlatform/isNativePlatform). Assert: registerForPush on web returns {ok:false} (not-native path); on native iOS calls checkPermissions BEFORE requestPermissions (PUSH-05 soft-prompt ordering — assert call order), on grant fires the 'registration' listener and POSTs {platform:'ios', device_token} to push-subscribe; android path POSTs platform:'android'; permission denied returns {ok:false, error:'permission-denied'}. These import registerForPush from './push' which currently throws (Phase 12 stub) → RED until 54-03.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && test -f supabase/functions/push-dispatch/index.test.ts && test -f supabase/functions/push-dispatch/deno.json && test -f leanshot/src/lib/native/push.test.ts && grep -q "isQuietHours\|quiet" supabase/functions/push-dispatch/index.test.ts && grep -q "checkPermissions\|requestPermissions" leanshot/src/lib/native/push.test.ts && echo PASS</automated>
  </verify>
  <done>Both test files exist with the enumerated cases; deno.json present; tests are RED (import absent/stub targets) — Wave 0 expected-failure state documented in SUMMARY.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| migration → live push_subscriptions | NOT NULL relaxation + new CHECKs run against a live table with existing web rows |
| category CHECK → notification-send | DB accepts/rejects categories the Edge Fn enumerates; drift = 500 mid-deploy |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-54-01-01 | Tampering | push_subscriptions web-or-native CHECK | mitigate | structural CHECK forbids native rows without device_token and web rows missing endpoint keys |
| T-54-01-02 | Denial of Service | partial unique index (user_id, device_token) | mitigate | prevents token-stuffing duplicate native rows per user |
| T-54-01-03 | Tampering | category CHECK / type union drift | mitigate | same-migration widen of all 4 CHECKs + both type unions in this plan (Pitfall 4) |
| T-54-01-SC | Tampering | npm/Deno installs | accept | no package installs in this plan; install gated in 54-03 |
</threat_model>

<verification>
- `cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check supabase/functions/push-dispatch/index.test.ts` — expected RED (index.ts absent); count failures for the Wave-0 inventory.
- `cd leanshot && npx vitest run src/lib/native/push.test.ts` — expected RED (push.ts is a throwing stub).
- `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` — type unions compile (no unused/dup union members).
</verification>

<success_criteria>
push_subscriptions migration adds platform/device_token/failure_count + relaxes web NOT NULLs + structural CHECK + partial unique index, forward-dated and idempotent. helpdesk-reply widened across all 4 CHECKs + config seed. Both Category unions synced to 15 + helpdesk-reply. RED scaffolds for push-dispatch and native push exist with enumerated cases. No reference to device_push_tokens.
</success_criteria>

<output>
Create `.planning/phases/54-push-notifications/54-01-SUMMARY.md` when done. Record the Wave-0 RED failure count (push-dispatch tests + native push tests) so 54-02/54-03 close-out can confirm they turned GREEN.
</output>
