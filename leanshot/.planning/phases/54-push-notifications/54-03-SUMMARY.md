---
phase: 54-push-notifications
plan: "03"
subsystem: native-push-registration
tags: [capacitor, push-notifications, apns, fcm, edge-fn]
dependency_graph:
  requires: [54-01]
  provides: [native-push-registration, push-subscribe-native-body]
  affects: [push_subscriptions, src/lib/native/push.ts, supabase/functions/push-subscribe]
tech_stack:
  added: ["@capacitor/push-notifications@^8.1.1"]
  patterns: [capacitor-listener-with-globalthis-guard, discriminated-union-body-validation]
key_files:
  created: []
  modified:
    - leanshot/package.json
    - leanshot/package-lock.json
    - leanshot/src/lib/native/push.ts
    - supabase/functions/push-subscribe/index.ts
decisions:
  - "globalThis registration ID guard prevents stale Capacitor listeners from prior registerForPush calls making spurious fetch calls (vitest vi.mock factory cached across vi.resetModules)"
  - "push-subscribe discriminates web vs native body by presence of device_token/platform field"
  - "native UPSERT uses onConflict user_id,device_token (54-01 partial unique index)"
  - "platform validated as enum ios|android in validateBody (T-54-03-02 tamper mitigation)"
metrics:
  duration: "~12 minutes"
  completed: "2026-05-25"
  tasks_completed: 3
  files_modified: 4
---

# Phase 54 Plan 03: Native Push Registration + Push-Subscribe Extension Summary

**One-liner:** Native APNs/FCM token registration via @capacitor/push-notifications with soft-prompt ordering, POST to extended push-subscribe Edge Fn accepting both web VAPID and native {platform, device_token} bodies.

## What Was Built

### Task 1 — Install @capacitor/push-notifications
Added `@capacitor/push-notifications@^8.1.1` to `leanshot/package.json` dependencies (alphabetically after `@capacitor/preferences`). Package-lock.json updated. Main checkout node_modules symlinked into worktree for test resolution.

Commit: `77b6a2ff`

### Task 2 — Implement native registerForPush() in push.ts
Replaced the Phase 12 throw-stub with full implementation:

- **Web early return**: `detectPlatform() === 'web'|'capacitor-web'` → `{ok:false, error:'not-native: use web VAPID path'}` (PUSH-05 separation)
- **Soft-prompt ordering** (PUSH-05): `checkPermissions()` first; only calls `requestPermissions()` if receive === 'prompt'; never OS-prompts if already granted or denied
- **Permission denied**: returns `{ok:false, error:'permission-denied'}` (or `permission-granted-but-error` etc.)
- **On granted**: `addListener('registration', ...)` → POST `{platform, device_token}` to push-subscribe with Bearer JWT
- **Firewall preserved**: imports `detectPlatform` from `./platform` (sole Capacitor/core import site); `@capacitor/push-notifications` imported directly only from push.ts
- **globalThis registration ID guard**: prevents stale listeners from prior calls making spurious fetch calls — see Deviations

Commit: `42d0e566`

### Task 3 — Extend push-subscribe Edge Function
Extended `validateBody` to discriminate two body shapes:

- **Native** (`device_token` or `platform` key present): validates `platform: 'ios'|'android'` and non-empty `device_token` string; UPSERT onConflict `user_id,device_token`
- **Web** (existing path): `endpoint` (https URL), `p256dh`, `auth`, optional `user_agent`; UPSERT onConflict `user_id,endpoint`

Security: `user_id` always from JWT (T-42-05-02 / T-54-03-01). Platform enum validation (T-54-03-02). 400 on unrecognized body.

Commit: `0e3bb26c`

## Verification

- 5/5 tests in `leanshot/src/lib/native/push.test.ts` GREEN (was RED in 54-01)
- `npx tsc -p tsconfig.app.json --noEmit` — clean
- push-subscribe web path verified intact (onConflict user_id,endpoint preserved)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] globalThis registration ID guard for stale Capacitor listeners**

- **Found during:** Task 2 — T4 failed when run after T3
- **Issue:** vitest 4.1.5's `vi.mock` factory is cached across `vi.resetModules()` calls (mock paths matching `/^mock:/` are excluded from reset by design in `vitest/dist/chunks/utils.BX5Fg8C4.js`). The `listeners` array in the `@capacitor/push-notifications` mock factory persisted across tests. T3's stale `addListener('registration')` callback (capturing `platform='ios'`) fired during T4's `__emit('registration', ...)`, making a fetch call with platform='ios'. T4's `fetchMock.mock.calls[0]` saw 'ios' instead of 'android'.
- **Fix:** Used `globalThis.__leanshot_push_reg_id__` as a shared registration counter. Each `registerForPush` call bumps the counter and captures `myId`. Stale listeners (from prior calls/prior module instances) check `_currentRegId() !== myId` and return early if superseded. Since `globalThis` is shared across module instances even when `vi.resetModules()` re-evaluates `push.ts`, the guard correctly detects superseded registrations.
- **Production behavior:** Correct — prevents double-registration race conditions and stale token deliveries on rapid re-registration.
- **Files modified:** `leanshot/src/lib/native/push.ts`
- **Commit:** `42d0e566`

## Known Stubs

None. Full registration flow implemented end-to-end. Actual on-device APNs/FCM delivery (real certs/service accounts) and notification-tap deep-link → Phase 70 HUMAN-UAT.

## Threat Flags

No new threat surface introduced beyond what the threat register covers (T-54-03-01 through T-54-03-SC). push-subscribe user_id JWT enforcement verified.

## Post-Merge Actions Required

**MANDATORY:** After merge to main, run `npm install --legacy-peer-deps` in `leanshot/` to install `@capacitor/push-notifications` in main's `node_modules` (node_modules is gitignored; only package.json + lock file transfer on merge — memory reference_npm_install_worktree_main_drift).

## Self-Check: PASSED

- FOUND: leanshot/src/lib/native/push.ts
- FOUND: supabase/functions/push-subscribe/index.ts
- FOUND: .planning/phases/54-push-notifications/54-03-SUMMARY.md
- FOUND: commit 77b6a2ff (Task 1 — package install)
- FOUND: commit 42d0e566 (Task 2 — push.ts implementation)
- FOUND: commit 0e3bb26c (Task 3 — push-subscribe extension)
- 5/5 tests GREEN confirmed
