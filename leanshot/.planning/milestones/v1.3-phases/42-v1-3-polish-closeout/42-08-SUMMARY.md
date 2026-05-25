---
phase: 42-v1-3-polish-closeout
plan: "08"
subsystem: notifications-ui
tags: [polish-05, polish-06, web-push, realtime, settings-center]
requires: [42-04, 42-05]
provides: [notifications-settings-ui, web-push-permission-flow, in-app-realtime-toast, sw-push-handler]
affects: [src/sw.ts, src/components/dashboard/settings/SettingsPage.tsx, src/lib/analytics/events.ts, src/App.tsx]
tech-stack:
  added: []
  patterns:
    - "@/lib/notifications/* module per-feature directory (matches @/lib/clinic-* etc.)"
    - "Optimistic-first React useState + supabase-js (no react-query in this project)"
    - "Pitfall 3 runtime guard: fromUserGesture:true required arg to requestPushPermission"
    - "vi.hoisted() + vi.mock() for supabase mocking (matches src/lib/__tests__/org-realtime.test.ts pattern)"
    - "PLAYWRIGHT_NOTIFICATION_RUN env-var gate + p42-notifications project (per [[reference_playwright_conditional_project_argv]])"
key-files:
  created:
    - leanshot/src/lib/notifications/types.ts
    - leanshot/src/lib/notifications/settings-store.ts
    - leanshot/src/lib/notifications/settings-store.test.ts
    - leanshot/src/lib/notifications/permission.ts
    - leanshot/src/lib/notifications/permission.test.ts
    - leanshot/src/lib/notifications/realtime.ts
    - leanshot/src/lib/notifications/realtime.test.ts
    - leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx
    - leanshot/src/components/dashboard/settings/NotificationsSubtab.test.tsx
    - leanshot/src/components/dashboard/notifications/InAppNotificationToast.tsx
    - leanshot/e2e/notification-settings.spec.ts
  modified:
    - leanshot/src/sw.ts (push + notificationclick listeners EXTENDED, NOT replaced)
    - leanshot/src/lib/analytics/events.ts (+5 TAXO events)
    - leanshot/src/components/dashboard/settings/SettingsPage.tsx (notifications section now renders NotificationsSubtab)
    - leanshot/src/App.tsx (InAppNotificationToast mounted inside authenticated branch — swept up in parallel 42-10 commit 1d1fcd0; intentional cross-plan integration seam)
    - leanshot/playwright.config.ts (PLAYWRIGHT_NOTIFICATION_RUN gate + p42-notifications project + chromium testIgnore)
decisions:
  - "Settings store pattern: plain React useState (not react-query) — matches the rest of /settings/* in this codebase"
  - "Cap UI writes user_cap_override to all 3 channel rows for the category; server fire-decision reads the row for the firing channel"
  - "notification_sent NOT fired client-side (server_only:true per D-34); the in-app toast just renders subject"
  - "e2e spec gated by PLAYWRIGHT_NOTIFICATION_RUN=1 + test.skip when service-role key absent; the HUMAN checkpoint is the live-fire test"
  - "Web-push event listener payload contract synced with supabase/functions/notification-send (kept in sw.ts comment + types.ts WebPushPayload type)"
metrics:
  duration_minutes: 16
  completed: 2026-05-19
  tasks_complete: "3 of 4 (Task 4 = HUMAN checkpoint, orchestrator-resolved)"
  files_created: 11
  files_modified: 5
  tests_added: 16
---

# Phase 42 Plan 42-08: Notifications UI Summary

POLISH-05/06 UI tier — self-serve /settings/notifications + web-push permission flow + Supabase Realtime in-app toast + service-worker push handler — built on the 42-05 backend (4 Edge Fns + 5 tables) and the 42-04 PWA service worker. 16 vitest tests green; 6 Playwright e2e tests opt-in gated awaiting HUMAN checkpoint live-fire.

## Tasks

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | Settings store + permission + realtime + sw push handler | Complete | `ae968c0` |
| 2 | NotificationsSubtab UI + InAppNotificationToast + SettingsPage wire-up | Complete | `1764d6e` |
| 3 | Playwright e2e for /settings/notifications (6 specs, opt-in gated) | Complete | `c86bf25` |
| 4 | HUMAN — Verify push notification end-to-end on real browser | Pending checkpoint | — |

## Artifacts

### Client-side notification library (`leanshot/src/lib/notifications/`)

- **`types.ts`** — Client-side mirror of `supabase/functions/_shared/notification-types.ts`. Category (`dose-reminders | ai-insights | clinic-alerts | billing | marketing`), Channel (`email | web-push | in-app`), NotificationSetting / CategoryConfig / DismissalState shapes, UserNotificationRow (Realtime payload), WebPushPayload (web-push contract). Intentional duplication at the trust boundary — server types cannot be statically imported by the client.
- **`settings-store.ts`** — `useNotificationSettings(userId)` returns `{settings: Map<SettingKey, NotificationSetting>, isLoading, error, update, refetch}`. Optimistic-first upsert with `onConflict: 'user_id,category,channel'` matching migration 20270704000001 UNIQUE; rollback on failure.
- **`permission.ts`** — `requestPushPermission({fromUserGesture:true})` runtime-guards Pitfall 3 (throws synchronously without flag); decodes VAPID public key from `import.meta.env.VITE_VAPID_PUBLIC_KEY` (LITERAL reference per memory `reference_vite_static_env_inlining`); calls `pushManager.subscribe({userVisibleOnly:true, applicationServerKey:Uint8Array})` and POSTs `subscription.toJSON()` to `/push-subscribe` with the user's `auth.access_token` bearer.
- **`realtime.ts`** — `subscribeToUserNotifications(userId, onFire)` opens `supabase.channel('user_notifications:<userId>')` with `postgres_changes` INSERT filter `user_id=eq.<userId>` (server-side bandwidth saver; RLS is the authoritative gate). Returns unsubscribe function.

### Service worker extension (`leanshot/src/sw.ts`)

Added (NOT replaced) per plan-checker iter-1 inline-fix:
- `self.addEventListener('push', …)` parses `{title, body, icon?, tag?, urgency?, deeplink?}` from `event.data.json()`; calls `self.registration.showNotification(title, {...})` inside `event.waitUntil`. `urgency:'high'` sets `requireInteraction:true` (D-03 clinical-alerts).
- `self.addEventListener('notificationclick', …)` closes the notification, then `event.waitUntil(matchAll → focus-or-openWindow(deeplink))`.

### Analytics taxonomy (`leanshot/src/lib/analytics/events.ts`)

Five additive events (per ESLint additive-only-events rule):
- `notification_sent` — `server_only:true` (D-34 ITP/uBlock resilience; fired from notification-send Edge Fn via posthog-server.ts)
- `notification_dismissed` — client-fired (category + channel)
- `notification_clicked` — client-fired
- `notification_snoozed` — client-fired (zod refine to enforce `duration_days ∈ {1, 7, 30}` per D-06)
- `notification_permission_granted` — client-fired on Pitfall-3-gated grant

### UI surfaces (`leanshot/src/components/dashboard/`)

- **`settings/NotificationsSubtab.tsx`** (~340 lines) — accessibility-first:
  - `<table aria-label="Notification preferences">` with `<th scope="row">` per RESEARCH §Pattern 1
  - 15 cells, each `<button role="switch" aria-checked aria-label>` (15 toggles)
  - Suppression banner above the table for categories where `notification_dismissal_state.throttle_until > now()` with "Restore" CTA (updates throttle_until to now())
  - "Enable push notifications" button (only when `Notification.permission !== 'granted'`) — `requestPushPermission({fromUserGesture:true})` invoked inline; this is the ONLY call site
  - Snooze controls: `<select aria-label="Snooze category">` + 1d/7d/30d buttons (calls `/notification-snooze` Edge Fn)
  - Frequency caps: `<Input max={admin daily_cap}>` per category — clamps client-side; server-side DOWNWARD trigger from 42-05 is the source of truth
- **`notifications/InAppNotificationToast.tsx`** — mounts `subscribeToUserNotifications(userId, onFire)`; pipes incoming `row.payload.subject` into `useToast` slice; renders null. Does NOT fire `notification_sent` (server_only).
- **`settings/SettingsPage.tsx`** — `notifications` section replaced v1.1 stub Card with `<NotificationsSubtab />` (NAV entry unchanged; routing path `/settings/notifications` already in NAV).

### App.tsx integration

`<InAppNotificationToast userId={signedInUser?.id ?? null} />` mounted inside the authenticated dashboard branch (before `<AppShell>`). The import + mount landed in parallel 42-10 commit `1d1fcd0` (swept up by a co-running executor's `git add`; intentional cross-plan integration seam — not a regression).

### Playwright e2e (`leanshot/e2e/notification-settings.spec.ts` + `playwright.config.ts`)

- 6 specs covering matrix render, persistence, snooze, cap clamp, realtime toast, push subscribe POST observation
- Gate: `PLAYWRIGHT_NOTIFICATION_RUN=1` env var → `p42-notifications` project; default chromium project excludes via testIgnore. `test.skip` short-circuits when `SUPABASE_SERVICE_ROLE_KEY` + `VITE_SUPABASE_ANON_KEY` absent (informative message).
- Per `[[reference_playwright_state_seeding]]`: `page.addInitScript()` seeds `sb-leanshot-auth` BEFORE `goto`
- Per `[[feedback_realtime_layer_e2e_pattern]]`: e2e-5 drives the `user_notifications` INSERT via service-role and observes the in-app DS Toast surface (DB-level invariant + UI proof)

## Verification

- **vitest:** 16/16 pass — `src/lib/notifications/*.test.ts` (8 tests across 3 files) + `src/components/dashboard/settings/NotificationsSubtab.test.tsx` (8 tests).
- **tsc:** clean for all 42-08 files. One pre-existing error in `src/components/nps/QuarterlyNPSModal.tsx` (`nps_quarterly_responded` not in EVENTS) — verified pre-dates 42-08 via `git stash` round-trip; logged to `deferred-items.md` for the 42-10/42-11 NPS plans to resolve.
- **eslint:** all new files clean. SettingsPage.tsx has 2 pre-existing import-order errors unchanged by 42-08 (project-wide lint debt baselined per `[[project_lint_debt_import_x_order]]`).
- **Playwright project gating:** `npx playwright test --list` (default) excludes the spec; `PLAYWRIGHT_NOTIFICATION_RUN=1 npx playwright test --project=p42-notifications --list` shows 6 tests; running without creds → all 6 skip with informative annotation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Used `capture()` instead of `track()` for new analytics events**

- **Found during:** Task 2 typecheck
- **Issue:** `track()` from `src/lib/analytics.ts` only accepts a legacy EventName union (7 events); my new `notification_*` events live in the newer `src/lib/analytics/events.ts` EVENTS registry. tsc error: `Argument of type '"notification_permission_granted"' is not assignable to parameter of type EventName`.
- **Fix:** Switched `NotificationsSubtab.tsx` to import `capture` from `@/lib/analytics/capture` (the EVENTS-aware wrapper added in Phase 24 D-12). `InAppNotificationToast.tsx` does NOT call capture for `notification_sent` because that event is `server_only:true` per D-34 (capture() would warn/throw in DEV).
- **Files modified:** `src/components/dashboard/settings/NotificationsSubtab.tsx` (2 call sites changed from track → capture); `src/components/dashboard/notifications/InAppNotificationToast.tsx` (removed accidental track('notification_sent', …) — server-only)
- **Commit:** `1764d6e`

**2. [Rule 1 — Bug] Suppression-banner test regex misaligned with element-bounded copy**

- **Found during:** Task 2 vitest run (1/8 failed)
- **Issue:** Asserted banner copy via `findByText(/reduced.*AI insights.*frequency.*dismissed/i)` but the rendered copy wraps the category name in `<strong>`, breaking the contiguous text node.
- **Fix:** Replaced with `findByRole('button', { name: /Restore/i })` (only present in the banner) + `getAllByText('AI insights').length > 0`.
- **Files modified:** `src/components/dashboard/settings/NotificationsSubtab.test.tsx`
- **Commit:** `1764d6e`

### Out-of-scope discoveries logged

- Pre-existing TS error in `QuarterlyNPSModal.tsx:119` (`nps_quarterly_responded` not in EVENTS map). Owned by 42-10/42-11 plans; appended to `.planning/phases/42-v1-3-polish-closeout/deferred-items.md` (this commit).

### Cross-plan integration seam (intentional)

App.tsx import + `<InAppNotificationToast userId={signedInUser?.id ?? null} />` mount were authored in this session but committed by the parallel 42-10 executor (`1d1fcd0`) due to the shared git index pattern (`[[feedback_parallel_executor_git_isolation]]`). Net effect is correct — App.tsx now mounts the realtime toast renderer inside the authenticated branch. Documented here for trace; no remediation needed.

## Threat Surface Review

All threats from the plan's `<threat_model>` mitigations are implemented:

| Threat ID | Disposition | Mitigation Evidence |
|-----------|-------------|---------------------|
| T-42-08-01 | mitigate | `permission.ts` runtime guard throws without `fromUserGesture:true`; `NotificationsSubtab.tsx` is the ONLY call site and passes the flag inline within onClick. |
| T-42-08-02 | mitigate | `realtime.ts` channel name + postgres_changes filter both scope to `user_id`. RLS on `user_notifications` (migration 20270704000006) is the authoritative gate. |
| T-42-08-03 | mitigate | UI clamps cap input to `max={admin daily_cap}`; server-side DOWNWARD trigger (42-05 migration) enforces. |
| T-42-08-04 | mitigate | Push subscription endpoint NEVER logged to PostHog from the client; `notification_permission_granted` payload carries only `had_prior_subscription` boolean. |
| T-42-08-SC | accept | No new npm dependencies added in 42-08. |

No new threat flags introduced — no net-new network endpoints, auth paths, or file-access patterns beyond those already declared in the plan's threat model.

## Self-Check: PASSED

Files verified to exist (`ls -la`):
- FOUND: leanshot/src/lib/notifications/types.ts
- FOUND: leanshot/src/lib/notifications/settings-store.ts
- FOUND: leanshot/src/lib/notifications/settings-store.test.ts
- FOUND: leanshot/src/lib/notifications/permission.ts
- FOUND: leanshot/src/lib/notifications/permission.test.ts
- FOUND: leanshot/src/lib/notifications/realtime.ts
- FOUND: leanshot/src/lib/notifications/realtime.test.ts
- FOUND: leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx
- FOUND: leanshot/src/components/dashboard/settings/NotificationsSubtab.test.tsx
- FOUND: leanshot/src/components/dashboard/notifications/InAppNotificationToast.tsx
- FOUND: leanshot/e2e/notification-settings.spec.ts

Commits verified (git log):
- FOUND: ae968c0 — Task 1
- FOUND: 1764d6e — Task 2
- FOUND: c86bf25 — Task 3

## REQ-IDs

- `POLISH-05` — UI tier complete (matrix + push permission + realtime + snooze + cap). Backend already shipped in 42-05. CLOSED when HUMAN checkpoint (Task 4) confirms real-browser push delivery.
- `POLISH-06` — Self-serve opt-out UI shipped via `NotificationsSubtab.tsx`. CLOSED when HUMAN checkpoint (Task 4) confirms persistence + reload behavior.

## Task 4 — HUMAN checkpoint (Orchestrator-resolved)

This plan's final task is a `checkpoint:human-verify` gate. Per execution context, the orchestrator handles the deploy / live-fire steps inline (the gsd-executor agent does NOT resume after a checkpoint return). The verbatim resume-signal expected by the plan: **"notifications-verified"** once (a) permission grant works, (b) system push lands, (c) in-app toast renders, (d) snooze blocks fire.

The full verification recipe (browser steps + curl smoke + DB inspection) is documented inline in `42-08-PLAN.md` Task 4 `<how-to-verify>`. Pre-conditions for the orchestrator to satisfy before initiating Task 4: dev server up on http://localhost:5173, a real test user signed in, VAPID public key reachable on the client, and the `notification-send` Edge Fn deployed (already shipped in 42-05).

### Task 4 deferred to 42-11 (operator decision 2026-05-19)

Operator chose to defer the live browser-push verify to Plan 42-11 (integration verify wave, bundles VoiceOver HUMAN-UAT + notification push e2e + other final-wave verifies).

**Why:** Curl smoke-test from orchestrator was attempted; **blocked** because `notification-send` Edge Fn checks `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` via `constantTimeEqual` against the new Supabase `sb_secret_*` format auto-injected at Fn deploy. The legacy HS256 service-role JWT (what `supabase projects api-keys` returns) is rejected. The new `sb_secret_KMdbJ…` token is masked in CLI output → not extractable without dashboard. See [[supabase-service-role-key-format-divergence]].

**Tasks 1-3 evidence remains strong:** 5/5 Deno unit tests + 6/6 integration tests (frequency-cap / sentiment-throttle / snooze / urgent / user-cap-downward / dismissal-fresh-user) + 31/31 a11y tests passing on the live build + Edge Fn deployed at 1.663 MB (`npm:web-push` bundled).

POLISH-05/06 remain PARTIAL until 42-11 closes. The 4 invariants (permission / system push / in-app toast / snooze) are NOT proven yet — `42-11-PLAN.md` Task 4 (VoiceOver UAT) absorbs this verify; closing 42-11 also closes POLISH-05/06.
