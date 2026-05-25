# Phase 54: Push Notifications - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 3 grey areas accepted as recommended

<domain>
## Phase Boundary

Cross-platform push fan-out (Web Push/VAPID + iOS APNs + Android FCM) with consistent permission UX, frequency-capping, quiet-hours, urgency override, per-platform delivery telemetry, and failing-token auto-prune. Foundation for dose reminders + clinician alerts + community mentions + helpdesk replies.

**Already in place (EXTEND, do NOT recreate):** `src/sw.ts` (injectManifest PWA SW from Phase 42); Edge Fns `push-subscribe`, `notification-send`, `notification-dismiss`, `notification-snooze`, `notify-community`; migrations `push_subscriptions`, `notification_settings`, `notification_category_config`, `user_notifications`, `notification_dismissal_state`; `src/lib/native/push.ts`, `src/lib/notifications/{types,permission}.ts` (+ permission.test.ts), `NotificationsSubtab.tsx`.

**Net-new this phase:** unified `push-dispatch` Edge Fn (cross-platform fan-out); `@capacitor/push-notifications` plugin + native APNs/FCM token registration; platform discriminator on `push_subscriptions`; quiet-hours + frequency-cap + urgency-override logic in dispatch; failing-token auto-prune; PostHog delivery telemetry; quiet-hours/per-category UI in the existing `NotificationsSubtab`.

Per D-08: actual on-device delivery (Chrome web push, iOS APNs cert, Android FCM) defers to Phase 70 (needs VAPID/APNs/FCM secrets + real devices, all pending-provisioning). Build + unit-test the dispatch/quiet-hours/freq-cap/prune/telemetry/registration logic now.
</domain>

<decisions>
## Implementation Decisions

### Dispatch architecture & data model
- NEW `push-dispatch` Edge Fn (success criteria names it) fans out across all of a user's registered tokens (web VAPID + iOS APNs + Android FCM), reusing the existing `push_subscriptions` table. Keep `notification-send` for in-app notifications.
- Add a `platform` discriminator (`web`/`ios`/`android`) + token/endpoint columns to the existing `push_subscriptions` table (forward-dated migration; do NOT create a parallel native-token table).
- Failing-token auto-prune after **3 consecutive failures** (failure_count column; reset on success).

### Quiet-hours, frequency-cap, urgency
- Quiet-hours **22:00–08:00 in the user's timezone** blocks non-urgent notifications; **urgent (clinician alerts) override** and still deliver.
- Per-category frequency cap reusing the existing `notification_category_config`.
- Urgency is **category-driven** (an `urgent` flag per category: clinician alerts = urgent; community mentions / marketing = non-urgent). User-tz sourced from `notification_settings`/profile; fallback UTC.

### Native push, telemetry, UI, defer posture
- Add `@capacitor/push-notifications`; on native, register the APNs/FCM token into `push_subscriptions` with the platform discriminator. Extend `src/lib/native/push.ts`.
- PostHog telemetry: `push_sent` / `push_delivered` / `push_failed` events with a `platform` property (+ category).
- UI: EXTEND the existing `NotificationsSubtab` with quiet-hours window + per-category toggles, reusing DS primitives — **no new UI-SPEC** (no net-new surface; reuses existing settings subtab).
- "Done" = push-dispatch + quiet-hours + freq-cap + urgency-override + prune + telemetry + native token registration shipped & unit-tested; actual web/APNs/FCM on-device delivery → Phase 70.

### UI design contract
- **UI-SPEC skipped** — extends the existing DS-compliant `NotificationsSubtab`; no net-new visual surface.

### Claude's Discretion
- Exact push-dispatch fan-out structure, quiet-hours computation, frequency-cap windows, telemetry event payloads, and migration column shapes are at Claude's discretion within the above + project patterns.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase/functions/push-subscribe/`, `notification-send/`, `notification-dismiss/`, `notification-snooze/` — existing push/notification Edge Fns.
- `supabase/migrations/20270704000005_push_subscriptions.sql`, `..._notification_settings.sql`, `..._notification_category_config.sql`, `..._user_notifications.sql` — existing schema to extend.
- `leanshot/src/sw.ts` — injectManifest PWA service worker (push/notificationclick listeners go here; generateSW can't host them — memory reference_vite_plugin_pwa_strategy_choice).
- `leanshot/src/lib/native/push.ts`, `src/lib/notifications/{types,permission}.ts` + permission.test.ts.
- `leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx` — settings UI to extend.

### Established Patterns
- Edge Fn conventions: per-function deno.json; Deno.serve unguarded (file-targeted deno test — Deno.serve trap); HMAC/service-role auth; vault service_role_key for cron.
- VAPID keypair + Supabase Function Secrets recipe (memory reference_vapid_keypair_supabase_setup): `npx web-push gen` → `supabase secrets set` → `VITE_VAPID_PUBLIC_KEY` in env; private key NEVER in VITE_*.
- State-counter tables keyed by (user, category) need UPSERT/ON CONFLICT, not bare UPDATE (memory).
- @sentry/capacitor + capacitor plugins: `npm ci --legacy-peer-deps`.

### Integration Points
- New Fn `supabase/functions/push-dispatch/`; migration under supabase/migrations/; native registration in src/lib/native/push.ts; UI in NotificationsSubtab.tsx.

</code_context>

<specifics>
## Specific Ideas

- VAPID public key already may be referenced (VITE_VAPID_PUBLIC_KEY); private key + APNs cert + FCM service-account JSON are pending-provisioning (Phase 52 smoke-tracked, set at P70).
- Quiet-hours urgent override is critical for clinician alerts (patient-safety adjacent) — must never be silently dropped.
</specifics>

<deferred>
## Deferred Ideas

- Actual on-device delivery: Chrome web push, iOS APNs (real cert + device), Android FCM (real service account + device); opening-notification deep-link on-device → Phase 70 HUMAN-UAT.
- VAPID/APNs/FCM secret value provisioning → Phase 70.
</deferred>
