# Phase 54: Push Notifications - Research

**Researched:** 2026-05-25
**Domain:** Cross-platform push notification fan-out (Web Push/VAPID + iOS APNs + Android FCM) via new `push-dispatch` Edge Fn, extending existing Phase 42 push infrastructure
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- NEW `push-dispatch` Edge Fn fans out across all of a user's registered tokens (web VAPID + iOS APNs + Android FCM); reuse existing `push_subscriptions` table.
- Add a `platform` discriminator (`web`/`ios`/`android`) + token/endpoint columns to the existing `push_subscriptions` table (forward-dated migration; do NOT create a parallel native-token table).
- Failing-token auto-prune after **3 consecutive failures** (failure_count column; reset on success).
- Quiet-hours **22:00-08:00 in the user's timezone** blocks non-urgent notifications; **urgent (clinician alerts) override** and still deliver.
- Per-category frequency cap reusing the existing `notification_category_config`.
- Urgency is **category-driven** (`urgent` flag per category: clinician alerts = urgent; community mentions / marketing = non-urgent). User-tz sourced from `notification_settings`/profile; fallback UTC.
- Add `@capacitor/push-notifications`; on native, register the APNs/FCM token into `push_subscriptions` with the platform discriminator. Extend `src/lib/native/push.ts`.
- PostHog telemetry: `push_sent` / `push_delivered` / `push_failed` events with a `platform` property (+ category).
- UI: EXTEND the existing `NotificationsSubtab` with quiet-hours window + per-category toggles, reusing DS primitives; **no new UI-SPEC**.
- "Done" = push-dispatch + quiet-hours + freq-cap + urgency-override + prune + telemetry + native token registration shipped & unit-tested; actual web/APNs/FCM on-device delivery → Phase 70.
- **UI-SPEC skipped** — extends the existing DS-compliant `NotificationsSubtab`; no net-new visual surface.

### Claude's Discretion

- Exact push-dispatch fan-out structure, quiet-hours computation, frequency-cap windows, telemetry event payloads, and migration column shapes.

### Deferred Ideas (OUT OF SCOPE)

- Actual on-device delivery: Chrome web push, iOS APNs (real cert + device), Android FCM (real service account + device); opening-notification deep-link on-device → Phase 70 HUMAN-UAT.
- VAPID/APNs/FCM secret value provisioning → Phase 70.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PUSH-01 | Web Push via vite-plugin-pwa injectManifest path — VAPID keypair; private in Supabase Function Secret; `VITE_VAPID_PUBLIC_KEY` in Vercel env | Already shipped in Phase 42: `sw.ts` has `push` + `notificationclick` listeners; `permission.ts` registers via `pushManager.subscribe`; `push-subscribe` Fn stores rows. This phase wires up the VAPID secret path in dispatch. |
| PUSH-02 | Native iOS push via APNs cert; `@capacitor/push-notifications` plugin integrated; deviceToken registered on `push_subscriptions` with `platform='ios'` | `@capacitor/push-notifications` not yet installed. `src/lib/native/push.ts` is a Phase 12 stub. Migration must add `platform` + `device_token` columns. |
| PUSH-03 | Native Android push via FCM service account; same plugin; deviceToken registered with `platform='android'` | Same stub as PUSH-02. FCM fan-out in `push-dispatch` uses `npm:google-auth-library@9` JWT pattern (Supabase official pattern). |
| PUSH-04 | Edge Fn `push-dispatch` accepts (user_id, payload) → fans out to all user's tokens across platforms; fallback to in-app + email if all tokens fail | `push-dispatch` does NOT exist. Must create. Reuses `push-subscribe` auth pattern (service-role bearer); reuses `notification-send` channel fan-out structure. |
| PUSH-05 | Permission UX: soft-prompt (in-app explainer) BEFORE OS prompt; per platform-specific guidance; telemetry on accept/decline rate | `NotificationsSubtab` already has "Enable push notifications" button using `requestPushPermission`. Extend for native: Capacitor plugin's `checkPermissions()` / `requestPermissions()` before OS prompt. |
| PUSH-06 | Dose-reminder + clinician-alert + community-mention + helpdesk-reply categories wire through `notification_settings` | Existing 15-category CHECK constraint (P49) already covers `dose-reminders`, `clinic-alerts`, `community-mentions`. `helpdesk-reply` is NOT yet a category — needs widening migration. |
| PUSH-07 | Frequency capping + quiet hours (22:00-08:00 user-tz) enforced server-side in `push-dispatch` | `notification-fire-decision.ts` already handles frequency caps and snooze. `push-dispatch` needs quiet-hours logic using `profiles.timezone` (already exists since Phase 38). |
| PUSH-08 | Per-platform delivery telemetry to PostHog; failing tokens auto-pruned after 3 consecutive failures | `posthog-server.ts` helper exists. `push_subscriptions` lacks `failure_count` column — migration needed. |
</phase_requirements>

---

## Summary

Phase 54 ships cross-platform push fan-out on top of a **heavily-built Phase 42 foundation**. The existing infrastructure covers: web VAPID delivery (sw.ts push+notificationclick handlers, `push-subscribe` Fn, `permission.ts` helper, `notification-fire-decision.ts` pure function, `notification-send` Fn with `npm:web-push@3.6.7` as primary path). What does NOT yet exist: the `push-dispatch` Edge Fn, `@capacitor/push-notifications` integration, `platform` + `device_token` + `failure_count` columns on `push_subscriptions`, quiet-hours enforcement in dispatch, and PostHog push telemetry events.

The key architecture decision is **`push-dispatch` vs `notification-send`**. Both remain in use: `notification-send` continues to handle the in-app + email + web-push fan-out decision for in-app-originated notifications (dose reminders triggered by cron, etc.). The new `push-dispatch` is a focused cross-platform push-only fan-out called by `notification-send` (replacing the current `fanOutPush` inline function) or called directly by cron triggers that need push only. This avoids a full rebuild of `notification-send`.

The defer-to-Phase-70 posture for actual on-device delivery means `push-dispatch` can be built and fully unit-tested with mocked APNs/FCM/web-push transports — identical to the `setPushFnForTest` injection pattern already in `notification-send`.

**Primary recommendation:** Create `push-dispatch` reusing the `notification-send` proxy-admin + injectable-transport pattern. Add `platform`, `device_token`, `failure_count` columns to `push_subscriptions` via a single forward-dated migration. Extend `src/lib/native/push.ts` with `@capacitor/push-notifications`. Extend `NotificationsSubtab` with quiet-hours + per-category controls.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Web VAPID delivery | Edge Fn (push-dispatch) | SW (sw.ts shows notification) | Server holds private key; SW presents UI |
| APNs token delivery | Edge Fn (push-dispatch) | — | Server-to-APNs HTTP/2 call requires private key |
| FCM HTTP v1 delivery | Edge Fn (push-dispatch) | — | Server-to-FCM call requires service-account OAuth |
| Native token registration | Client (Capacitor plugin) | Edge Fn (push-subscribe) | Device generates token; Fn stores in DB |
| Permission UX soft-prompt | Frontend (NotificationsSubtab) | — | UI-side explainer before OS prompt |
| Quiet-hours enforcement | Edge Fn (push-dispatch) | — | Server-authoritative; client cannot be trusted |
| Frequency cap enforcement | Edge Fn (notification-fire-decision) | — | Existing pure function; dispatch reads `notification_category_config` |
| Failing-token prune | Edge Fn (push-dispatch) | — | On delivery failure, increment+check+delete |
| Push telemetry | Edge Fn (push-dispatch → posthog-server) | — | Server-side to bypass adblockers |
| Quiet-hours UI settings | Frontend (NotificationsSubtab) | — | Write to `notification_settings` or `profiles` |

---

## Existing Infrastructure Inventory (EXTEND — DO NOT RECREATE)

### push_subscriptions table (20270704000005)

**Current columns:**

| Column | Type | Constraint | Notes |
|--------|------|-----------|-------|
| id | uuid PK | gen_random_uuid() | |
| user_id | uuid NOT NULL | FK auth.users ON DELETE CASCADE | |
| endpoint | text NOT NULL | CHECK length > 0 | Web Push endpoint URL |
| p256dh | text NOT NULL | CHECK length > 0 | VAPID encryption key |
| auth | text NOT NULL | CHECK length > 0 | VAPID auth secret |
| user_agent | text | nullable | Debug field |
| created_at | timestamptz | default now() | |
| updated_at | timestamptz | default now() + trigger | |

**Unique constraint:** `(user_id, endpoint)`
**Index:** `push_subscriptions_user_id_idx`

**What is MISSING for Phase 54:**
- No `platform` column (`web`/`ios`/`android`) — all existing rows are web
- No `device_token` column — APNs/FCM use an opaque token string, not a VAPID endpoint
- No `failure_count` column — needed for auto-prune logic
- The UNIQUE constraint `(user_id, endpoint)` does not cover native tokens (tokens don't have an `endpoint` in the web-push sense)

**Migration approach:** `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for all 3 columns; add a second unique constraint `(user_id, device_token)` for native rows; set `platform DEFAULT 'web'` for all existing rows. Native rows use `device_token` and leave `endpoint`/`p256dh`/`auth` as nullable (must relax NOT NULL on those columns for native rows, or use a check constraint: `CHECK (platform = 'web' OR device_token IS NOT NULL)`).

### notification_settings table (20270704000001)

**Current columns:** `user_id`, `category`, `channel`, `enabled`, `snoozed_until`, `user_cap_override`, `created_at`, `updated_at`

**Current CHECK categories (as of P49 widening):** dose-reminders, ai-insights, clinic-alerts, billing, marketing, community-mentions, community-replies, community-dm, community-admin-report, event_reminders_1d, event_reminders_1h, event_promotion, banned_word_escalate, daily_community_digest, weekly_community_digest (15 categories)

**What is MISSING for Phase 54:**
- No `quiet_hours_start` / `quiet_hours_end` / `quiet_hours_enabled` column — quiet-hours is a NEW per-user setting. Options: (a) add columns to `notification_settings`, (b) use `profiles` table, (c) add to a new `notification_preferences` table. Decision: extend `notification_settings` with `quiet_hours_enabled BOOLEAN DEFAULT true` at the user level OR derive from `profiles.timezone` with hardcoded 22:00-08:00 window (no per-user override needed per CONTEXT). **CONTEXT says quiet-hours window is fixed at 22:00-08:00; only the timezone is per-user and it already exists in `profiles.timezone` (Phase 38).** No new column needed; the dispatch Fn reads `profiles.timezone`.
- `helpdesk-reply` category does NOT exist in the CHECK constraint. Phase 54 requires adding it (PUSH-06).

### notification_category_config table (20270704000002 + seed 20270704000007 + P44-P49 widenings)

**Current columns:** `category` PK, `daily_cap`, `weekly_cap`, `urgent_escalation`, `push_enabled_default`, `email_enabled_default`, `in_app_enabled_default`, `created_at`, `updated_at`

**What is MISSING for Phase 54:**
- No `urgent` flag beyond `urgent_escalation`. `urgent_escalation` already serves this purpose (clinic-alerts = true). No new column needed — dispatch uses this column directly.
- No per-category seed for `helpdesk-reply` (needs adding in widening migration).

### sw.ts (leanshot/src/sw.ts)

**Status: FULLY IMPLEMENTED.** Has `push` and `notificationclick` event listeners. Handles payload `{ title, body, icon?, tag?, urgency?, deeplink? }`. `requireInteraction` for urgency='high'. Deep-link handling focuses existing window or opens new. Does NOT need changes for Phase 54 (web-push path unchanged). [VERIFIED: direct file read]

### push-subscribe Edge Fn (supabase/functions/push-subscribe/index.ts)

**Status: WEB-ONLY.** Accepts `{ endpoint, p256dh, auth, user_agent? }` body via user JWT auth. UPSERTs on `(user_id, endpoint)`. Does NOT accept `platform` or `device_token`. Must be EXTENDED to accept native registration: new body schema `{ platform: 'ios'|'android', device_token: string }` for native path; existing `{ endpoint, p256dh, auth }` schema for web path. [VERIFIED: direct file read]

### notification-send Edge Fn (supabase/functions/notification-send/index.ts)

**Status: IN-APP + EMAIL + WEB-PUSH for existing categories.** Contains `fanOutPush()` function that iterates `push_subscriptions` rows and calls `npm:web-push@3.6.7`. The `push-dispatch` Fn should eventually REPLACE `fanOutPush` inside `notification-send` OR `notification-send` can call `push-dispatch` as a sub-call. For Phase 54, the planner may choose to leave `notification-send` intact and have `push-dispatch` be the new multi-platform entry point called from cron jobs. [VERIFIED: direct file read]

### notification-fire-decision.ts (_shared)

**Status: FULLY IMPLEMENTED.** Pure function. `shouldFire({ prefs, cfg, dismissal, firedTodayCount, firedThisWeekCount, now })` returns `FireDecision { email, push, in_app, urgent, reasons }`. Already handles: snooze, daily cap, weekly cap, D-05 halving on dismissal throttle, per-channel enabled check. **Does NOT handle quiet-hours** — that must be added to `push-dispatch` directly (not to `shouldFire`, to keep it pure and avoid breaking existing callers). [VERIFIED: direct file read]

### src/lib/notifications/types.ts (client-side)

**Status: PARTIALLY CURRENT.** `Category` union has 7 members (missing `community-dm`, `community-admin-report`, event categories, `banned_word_escalate` from server-side, and the 2 digest categories ARE present). This drift is pre-existing. For Phase 54: add `helpdesk-reply` to this file AND to `_shared/notification-types.ts`. [VERIFIED: direct file read]

### src/lib/notifications/permission.ts (client-side)

**Status: WEB-ONLY, COMPLETE.** `requestPushPermission({ fromUserGesture: true })` handles web VAPID subscription + POST to `push-subscribe`. Has Pitfall 3 guard (gesture gate). Does NOT handle native. For Phase 54, the native path goes through `@capacitor/push-notifications` in `src/lib/native/push.ts` (currently a Phase 12 stub that throws). [VERIFIED: direct file read]

### src/lib/native/push.ts

**Status: STUB.** Phase 12 stub that exports `PushChannel` type and `registerForPush()` that throws. Must be fully implemented for Phase 54. [VERIFIED: direct file read]

### NotificationsSubtab.tsx

**Status: WEB-PUSH + 5×3 MATRIX + SNOOZE + CAPS.** Has: "Enable push notifications" button (web VAPID), 5×3 category × channel toggle matrix, snooze controls (1/7/30 days), frequency cap inputs, email digest section (Phase 49). Uses `MATRIX_CATEGORIES` const to limit matrix to 5 core categories. Uses `requestPushPermission` from `permission.ts`. 

**What is MISSING for Phase 54 UI:** Quiet-hours section (fixed 22:00-08:00, user shows timezone + enable/disable toggle). Per-category phase 54 has no new categories to surface — the existing matrix already covers `dose-reminders`, `clinic-alerts`, etc. The `helpdesk-reply` category must be added to `VALID_CATEGORIES` in `notification-send/index.ts` and to `MATRIX_CATEGORIES` / `CATEGORY_LABEL` in `NotificationsSubtab`. [VERIFIED: direct file read]

### package.json (@capacitor/push-notifications)

**Status: NOT INSTALLED.** Current Capacitor plugins in `dependencies`: `@capacitor/app`, `@capacitor/browser`, `@capacitor/clipboard`, `@capacitor/filesystem`, `@capacitor/haptics`, `@capacitor/keyboard`, `@capacitor/network`, `@capacitor/preferences`, `@capacitor/share`, `@capacitor/splash-screen`, `@capacitor/status-bar`. Also `@capacitor/android`, `@capacitor/cli`, `@capacitor/ios` in devDependencies. 

`@capacitor/push-notifications@8.1.1` is NOT listed. Must be added. Note project installs with `--legacy-peer-deps` due to `@sentry/capacitor` sibling-check blocker (memory reference_sentry_capacitor_npm_install_blocker). [VERIFIED: direct file read]

---

## Standard Stack

### Core (Edge Fn: push-dispatch)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `npm:web-push@3.6.7` | 3.6.7 | Web Push/VAPID delivery | Already used in `notification-send`; Phase 42 spike winner; pattern stable |
| `npm:google-auth-library@9` | ~9.x | FCM HTTP v1 OAuth — service-account JWT for Bearer token | Supabase official push-notifications example pattern [CITED: supabase.com/docs/guides/functions/examples/push-notifications] |
| `npm:@supabase/supabase-js@2` | 2.x | Admin client for DB reads (subscriptions, profiles.timezone) | Project-standard across all Edge Fns |
| `crypto.subtle` (Deno built-in) | Web Crypto API | ES256 JWT signing for APNs token auth | Native Deno — no package needed; avoids `node-apn` which has native bindings incompatible with Deno |
| `_shared/posthog-server.ts` | project-internal | Emit `push_sent`/`push_delivered`/`push_failed` events | Existing pattern; vendor-gated no-op when key absent |
| `_shared/notification-types.ts` | project-internal | Shared `Category`, `Channel`, `FireDecision` types | Already imported by `notification-send` |

### Core (Client: native push registration)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@capacitor/push-notifications` | 8.1.1 | APNs/FCM token registration + permission on native | Official Capacitor plugin; matches existing `@capacitor/core@^8.3.4` version family |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `posthog-js` (client-side) | already in package.json | Emit client-side `push_permission_accepted/declined` | Client-side only events where server has no user context |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `npm:google-auth-library@9` for FCM | Raw `crypto.subtle` JWT signing for FCM | google-auth-library is simpler; it handles JWT RS256 signing against Google's token endpoint; `crypto.subtle` works but requires manual JWT assembly |
| `crypto.subtle` for APNs JWT | `npm:jose` or `npm:djwt` | `crypto.subtle` native to Deno avoids any package legitimacy risk; APNs ES256 JWT is straightforward with `importKey` + `sign` |
| Extending `notification-send` fan-out | Separate `push-dispatch` Fn | Separate Fn keeps SRP clean; `notification-send` callers are unchanged; `push-dispatch` can be called from cron directly |

**Installation (client-side):**
```bash
npm install @capacitor/push-notifications --legacy-peer-deps
```

**Installation (Edge Fn — no install needed, Deno imports):**
- `npm:google-auth-library@9` — imported inline in `push-dispatch/index.ts`
- `npm:web-push@3.6.7` — already in `notification-send`; copy import pattern

---

## Package Legitimacy Audit

> slopcheck was unavailable at research time. All packages below are tagged `[ASSUMED]` for download counts; packages have been verified against official source repos and npm registry.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@capacitor/push-notifications` | npm | ~5 yrs (Ionic team) | High (official Capacitor plugin) | github.com/ionic-team/capacitor-plugins | [ASSUMED] | Approved — official Ionic/Capacitor org |
| `web-push` | npm | ~9 yrs (last release 2024-01-16) | High (Web Push reference impl) | github.com/web-push-libs/web-push | [ASSUMED] | Approved — already used in Phase 42; no postinstall scripts in scripts object |
| `google-auth-library` | npm | ~8 yrs | High (Google official) | github.com/googleapis/google-cloud-node-core | [ASSUMED] | Approved — Google official googleapis org |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*slopcheck was unavailable at research time; all packages above are tagged `[ASSUMED]` for download data but have official source repos and registry presence confirmed. The planner should gate each new package install behind a `checkpoint:human-verify` task or use `npm view <pkg> repository.url` as a proxy check.*

---

## Architecture Patterns

### System Architecture Diagram

```
Client (Web Browser / Capacitor Native)
  |
  +-- [Web] requestPushPermission() → pushManager.subscribe() → POST push-subscribe Fn
  |     (stores: endpoint, p256dh, auth, platform='web')
  |
  +-- [Native] @capacitor/push-notifications
        .register() → 'registration' event → deviceToken
        → POST push-subscribe Fn (stores: device_token, platform='ios'|'android')

Cron / notification-send Fn
  |
  v
push-dispatch Edge Fn  (NEW)
  |
  +-- 1. Verify service-role bearer (constant-time)
  +-- 2. Validate body { user_id, category, payload, urgency? }
  +-- 3. Load user's push_subscriptions (all platforms) + profiles.timezone
  +-- 4. Quiet-hours check: if isQuietHours(timezone) AND !urgent → skip all platforms
  +-- 5. Fan out per platform:
  |     [platform='web']     → npm:web-push sendNotification (VAPID)
  |     [platform='ios']     → APNs HTTP/2 (crypto.subtle ES256 JWT)
  |     [platform='android'] → FCM HTTP v1 (google-auth-library JWT → Bearer)
  +-- 6. Per delivery result:
  |     success → reset failure_count=0
  |     failure → failure_count++; if failure_count >= 3 → DELETE row (auto-prune)
  +-- 7. captureServer: push_sent / push_delivered / push_failed (per platform)
  +-- 8. Respond { sent: N, failed: N, pruned: N, skipped_quiet_hours: bool }

PostHog ← push_sent / push_delivered / push_failed (platform, category props)
```

### Recommended Project Structure

```
supabase/functions/push-dispatch/
  index.ts                   # NEW: main fan-out Fn
  index.test.ts              # NEW: Deno unit tests (mock transports)
  deno.json                  # NEW: per-Fn deno.json (--no-check pattern)

supabase/migrations/
  20270704XXXXXX_p54_push_subscriptions_platform.sql   # NEW: platform + device_token + failure_count columns
  20270704XXXXXX_p54_notification_category_widening.sql # NEW: helpdesk-reply category

leanshot/src/lib/native/push.ts   # EXTEND: implement registerForPush() with Capacitor plugin
leanshot/src/lib/notifications/types.ts  # EXTEND: add helpdesk-reply to Category union
leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx  # EXTEND: quiet-hours UI section
supabase/functions/_shared/notification-types.ts  # EXTEND: add helpdesk-reply to Category
supabase/functions/push-subscribe/index.ts  # EXTEND: add native registration body schema
supabase/functions/notification-send/index.ts  # EXTEND: add helpdesk-reply to VALID_CATEGORIES
```

### Pattern 1: push-dispatch — Quiet-Hours Gate

```typescript
// Source: project pattern (profiles.timezone already exists since Phase 38)
function isQuietHours(timezone: string, now: Date): boolean {
  const localHour = new Date(
    now.toLocaleString('en-US', { timeZone: timezone })
  ).getHours();
  // 22:00–08:00 local time → quiet
  return localHour >= 22 || localHour < 8;
}

// Usage in push-dispatch:
const tz = profileRow?.timezone ?? 'UTC';
const quiet = isQuietHours(tz, new Date());
if (quiet && !cfg.urgent_escalation) {
  return jsonResponse(200, { skipped: 'quiet_hours', tz });
}
```

Note: `profiles.timezone` is an IANA name (e.g. `America/New_York`) with regex constraint. `toLocaleString('en-US', { timeZone: tz })` is valid in Deno's V8. [VERIFIED: Phase 38 migration confirms IANA column exists with CHECK]

### Pattern 2: APNs JWT via crypto.subtle (Deno built-in)

```typescript
// Source: [ASSUMED] — based on Web Crypto API standard + APNs token auth docs
// APNs requires ES256 (ECDSA P-256) JWT signed with the .p8 private key
async function signApnsJwt(
  teamId: string,
  keyId: string,
  privateKeyPem: string, // the .p8 file content (PKCS#8 PEM)
): Promise<string> {
  const header = { alg: 'ES256', kid: keyId };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: teamId, iat: now };

  const enc = (s: string) =>
    btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const signingInput =
    enc(JSON.stringify(header)) + '.' + enc(JSON.stringify(payload));

  // Import PKCS#8 private key
  const keyData = pemToBuffer(privateKeyPem); // strip PEM headers, base64 decode
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  const sigB64 = enc(String.fromCharCode(...new Uint8Array(sig)));
  return signingInput + '.' + sigB64;
}

// APNs HTTP/2 call:
const jwt = await signApnsJwt(teamId, keyId, privateKey);
const apnsHost = isProduction
  ? 'https://api.push.apple.com'
  : 'https://api.sandbox.push.apple.com';
const res = await fetch(`${apnsHost}/3/device/${deviceToken}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${jwt}`,
    'apns-topic': bundleId, // e.g. 'app.leanshot.ios'
    'apns-push-type': 'alert',
    'apns-priority': urgent ? '10' : '5',
  },
  body: JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
    }
  }),
});
```

[ASSUMED] — JWT signing approach is standard Web Crypto; APNs HTTP/2 endpoint verified from Apple Developer docs. Token is valid for 1 hour — cache at Fn level or re-sign per request (Deno isolate is short-lived so per-request is fine).

### Pattern 3: FCM HTTP v1 via google-auth-library

```typescript
// Source: [CITED: supabase.com/docs/guides/functions/examples/push-notifications]
import { JWT } from 'npm:google-auth-library@9';

const serviceAccount = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT_JSON') ?? '{}');
const jwtClient = new JWT({
  email: serviceAccount.client_email,
  key: serviceAccount.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
});
const tokenResponse = await jwtClient.authorize();
const accessToken = tokenResponse.access_token;

const fcmRes = await fetch(
  `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title: payload.title, body: payload.body },
        data: { deeplink: payload.deeplink ?? '/' },
      },
    }),
  }
);
```

### Pattern 4: Capacitor Native Push Registration (client-side)

```typescript
// Source: [CITED: capacitorjs.com/docs/apis/push-notifications]
// In src/lib/native/push.ts — REPLACES the Phase 12 stub
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';

export type PushChannel = 'apns' | 'fcm' | 'web-push';

export async function registerForPush(
  accessToken: string,
  supabaseUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, error: 'not-native: use web VAPID path' };
  }

  // 1. Check / request permission
  let permission = await PushNotifications.checkPermissions();
  if (permission.receive === 'prompt') {
    permission = await PushNotifications.requestPermissions();
  }
  if (permission.receive !== 'granted') {
    return { ok: false, error: `permission-${permission.receive}` };
  }

  // 2. Register with APNs/FCM
  return new Promise((resolve) => {
    PushNotifications.addListener('registration', async (token) => {
      const platform = Capacitor.getPlatform(); // 'ios' | 'android'
      const res = await fetch(`${supabaseUrl}/functions/v1/push-subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          platform,
          device_token: token.value,
        }),
      });
      resolve({ ok: res.ok, error: res.ok ? undefined : String(res.status) });
    });
    PushNotifications.addListener('registrationError', (err) => {
      resolve({ ok: false, error: err.error });
    });
    void PushNotifications.register();
  });
}
```

[ASSUMED] — Capacitor push-notifications API shape based on official docs pattern. The `registration` listener fires asynchronously after `register()`.

### Pattern 5: Failure Count Increment + Auto-Prune

```typescript
// In push-dispatch, per-subscription delivery result handler
async function handleDeliveryResult(
  admin: SupabaseClient,
  rowId: string,
  success: boolean,
  currentFailureCount: number,
): Promise<void> {
  if (success) {
    await admin.from('push_subscriptions').update({ failure_count: 0 }).eq('id', rowId);
  } else {
    const newCount = currentFailureCount + 1;
    if (newCount >= 3) {
      await admin.from('push_subscriptions').delete().eq('id', rowId);
    } else {
      await admin.from('push_subscriptions').update({ failure_count: newCount }).eq('id', rowId);
    }
  }
}
```

### Anti-Patterns to Avoid

- **Quiet-hours in `shouldFire()`:** `notification-fire-decision.ts` is a pure function used by `notification-send` for in-app + email channels too. Adding quiet-hours there would block email (which should not be quiet-hours gated). Keep quiet-hours enforcement in `push-dispatch` only.
- **Calling `auth.uid()` in SECDEF RPC from push-dispatch:** `push-dispatch` is service-role (cron caller); any SECDEF RPC it calls must not reference `auth.uid()` (reference_rpc_auth_uid_vs_service_role_mismatch).
- **Native platform check in permission.ts:** Do NOT add Capacitor logic to `permission.ts` — keep it web-only. Native path goes through `native/push.ts` only (import-x/no-restricted-paths `DO NOT import from ./health` pattern extended to keep web/native separation).
- **Storing APNs private key in VITE_* env var:** Private keys must NEVER go into `VITE_*` variables (build-time, client-bundle visible). Supabase Function Secrets only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| VAPID encryption for Web Push | Custom ECDH key agreement + AES-GCM | `npm:web-push@3.6.7` | RFC 8291 VAPID + RFC 8030 encryption is 400+ lines of crypto; existing Phase 42 dependency |
| FCM service-account JWT → OAuth token | Manual RS256 JWT + Google token endpoint | `npm:google-auth-library@9` JWT class | Handles key parsing, expiry refresh, scope management; Supabase official pattern |
| APNs JWT signing | Third-party library | `crypto.subtle` (built-in) | ES256 JWT for APNs is ~30 lines of Web Crypto; no package needed |
| Quiet-hours timezone math | Manual UTC offset calculation | `toLocaleString({ timeZone: tz }).getHours()` | Deno V8 supports IANA timezone via Intl; single line |
| Per-platform delivery telemetry | Custom HTTP to PostHog | `_shared/posthog-server.ts captureServer()` | Already handles env-gating, shutdown, events_mirror dual-write |
| Frequency cap enforcement | Custom cap logic | `_shared/notification-fire-decision.ts` | Already handles daily_cap, weekly_cap, throttle halving, snooze |

**Key insight:** The biggest trap in this phase is rebuilding logic already in `notification-fire-decision.ts`. The quiet-hours gate is the ONLY new logic; everything else (cap, snooze, channel-enable) already exists.

---

## Migration Plan (Net-New)

### Migration 1: push_subscriptions platform extension

```sql
-- Forward-dated migration
-- Adds: platform, device_token, failure_count to push_subscriptions
-- Does NOT break existing web rows (platform defaults to 'web', others nullable)

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS device_token text,  -- APNs/FCM token
  ADD COLUMN IF NOT EXISTS failure_count int NOT NULL DEFAULT 0;

-- Platform CHECK
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_platform_chk,
  ADD CONSTRAINT push_subscriptions_platform_chk
    CHECK (platform IN ('web', 'ios', 'android'));

-- Structural integrity: web rows must have endpoint; native rows must have device_token
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_web_or_native_chk,
  ADD CONSTRAINT push_subscriptions_web_or_native_chk
    CHECK (
      (platform = 'web' AND endpoint IS NOT NULL AND p256dh IS NOT NULL AND auth IS NOT NULL)
      OR
      (platform IN ('ios', 'android') AND device_token IS NOT NULL)
    );

-- Unique constraint for native tokens
-- (existing unique is on (user_id, endpoint); native rows have device_token)
-- Use partial unique indexes to handle nullability
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_user_device_token_uniq
  ON public.push_subscriptions (user_id, device_token)
  WHERE device_token IS NOT NULL;

-- Also relax NOT NULL on endpoint, p256dh, auth for native rows
-- (They were set NOT NULL for web; native rows don't use them)
-- Use the structural CHECK above + partial index instead of NOT NULL removal
-- to avoid migration complexity on existing constraint enforcement.
-- NOTE: Postgres requires a workaround to make previously NOT NULL columns
-- nullable: ALTER COLUMN ... DROP NOT NULL
ALTER TABLE public.push_subscriptions
  ALTER COLUMN endpoint DROP NOT NULL,
  ALTER COLUMN p256dh   DROP NOT NULL,
  ALTER COLUMN auth     DROP NOT NULL;
```

[ASSUMED] — exact SQL; planner should verify idempotent DO $$ blocks around each ALTER.

### Migration 2: notification category widening (helpdesk-reply)

Adds `helpdesk-reply` to all 4 notification CHECK constraints + seeds `notification_category_config`. Follows the exact P49 pattern (atomic single transaction, all 4 tables). [ASSUMED] — category name; CONTEXT.md says "helpdesk replies" — use `helpdesk-reply` to match kebab convention of existing community categories.

---

## Common Pitfalls

### Pitfall 1: Deno isolate APNs JWT token reuse
**What goes wrong:** APNs JWT is valid for 1 hour. If the Deno isolate reuses a cached token across requests, stale tokens cause 403 ExpiredProviderToken after 1 hour.
**Why it happens:** Deno isolates can be kept warm; module-level cached `let _apnsJwt` is reused.
**How to avoid:** Cache token with `let _apnsJwtExpiry = 0` and check `Date.now() / 1000 < _apnsJwtExpiry - 60` before reusing. Re-sign if within 60s of expiry.
**Warning signs:** APNs 403 responses after ~55 minutes of heavy traffic.

### Pitfall 2: push_subscriptions NOT NULL drop races with existing UPSERT
**What goes wrong:** Dropping NOT NULL on `endpoint`, `p256dh`, `auth` while the existing `push-subscribe` Fn is deployed could fail if the DB migration lands before the Fn update. The existing Fn always sends all 3 fields, so this is low-risk — but the structural CHECK constraint must be in the same migration.
**How to avoid:** Migration must be deployed atomically (single `BEGIN; ... COMMIT;`). Fn update does not break the DB because existing web registrations still send all 3 fields.

### Pitfall 3: Quiet-hours blocking clinician alerts on urgency override
**What goes wrong:** `urgent_escalation = true` on `clinic-alerts` category must bypass quiet-hours. If the quiet-hours check in `push-dispatch` uses the wrong field, clinician alerts are silently dropped during 22:00-08:00.
**Why it happens:** Developer checks `payload.urgent` (client-provided, untrusted) instead of `cfg.urgent_escalation` (DB-authoritative).
**How to avoid:** `push-dispatch` MUST load the `notification_category_config` row for the category and use `cfg.urgent_escalation`, NOT any client-supplied urgency flag.
**Warning signs:** Test: send a clinic-alert category push at 23:00 UTC with a user in UTC timezone — must deliver.

### Pitfall 4: VALID_CATEGORIES set drift
**What goes wrong:** Adding `helpdesk-reply` to DB CHECK but forgetting to add it to `VALID_CATEGORIES` Set in `notification-send/index.ts` and `Category` union in `_shared/notification-types.ts`. The DB accepts the row; the Edge Fn rejects the category at 400 before it reaches the DB.
**How to avoid:** The widening migration and all TypeScript category unions must be updated in the same plan/commit.

### Pitfall 5: @capacitor/push-notifications postinstall + --legacy-peer-deps
**What goes wrong:** `npm install @capacitor/push-notifications` without `--legacy-peer-deps` fails due to `@sentry/capacitor` peer dep conflict (memory reference_sentry_capacitor_npm_install_blocker).
**How to avoid:** Always `npm install @capacitor/push-notifications --legacy-peer-deps`. The executor plan MUST include this flag.

### Pitfall 6: `notification-send` `fanOutPush` still runs after `push-dispatch` is added
**What goes wrong:** If `notification-send` is not updated to delegate push fan-out to `push-dispatch`, both functions independently attempt to deliver to `push_subscriptions`. New APNs/FCM rows are unknown to the old `fanOutPush` which only knows the web-push shape.
**How to avoid:** Either (a) replace `fanOutPush` in `notification-send` to call `push-dispatch` sub-call, or (b) `notification-send`'s `fanOutPush` only iterates `platform='web'` rows by adding `.eq('platform', 'web')` filter; native delivery is `push-dispatch`-only. Option (b) is safer and avoids circular Fn calls.

### Pitfall 7: Deno.serve unguarded — test runner abort (existing pattern)
**What goes wrong:** `push-dispatch/index.ts` uses `Deno.serve(handler)` not guarded by `import.meta.main`. Running `deno test path/` triggers real HTTP server on import (memory reference_deno_test_top_level_serve_trap). 
**How to avoid:** Follow existing project pattern: guard `Deno.serve` with `const denoGlobal: any = (globalThis as any).Deno; if (denoGlobal?.serve) { denoGlobal.serve(handler); }`. See `push-subscribe/index.ts` line 171-173.

---

## Runtime State Inventory

Phase 54 is a new-capability phase (no rename/refactor). However, the migration changes column nullability on `push_subscriptions` — a live table.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `push_subscriptions`: existing rows have `platform=NULL` (column doesn't exist yet), `endpoint NOT NULL`, `p256dh NOT NULL`, `auth NOT NULL` | Migration adds `platform DEFAULT 'web'` (backfills existing rows), drops NOT NULL on endpoint/p256dh/auth |
| Live service config | Supabase Function Secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` already referenced in `notification-send`; `FCM_SERVICE_ACCOUNT_JSON` and APNs secrets (`APNS_PRIVATE_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`) are pending-provisioning (Phase 52/70) | push-dispatch must be fail-soft when APNs/FCM secrets are absent (mirroring vendor-smoke pattern) |
| OS-registered state | None | N/A |
| Secrets/env vars | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — already set per Phase 42 spike. `FCM_SERVICE_ACCOUNT_JSON`, `APNS_PRIVATE_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` — pending provisioning from Phase 52 | push-dispatch reads these with `?? ''` fallback and skips the platform if key is empty (fail-soft) |
| Build artifacts | None — `@capacitor/push-notifications` is a new npm dep; after `npm install` the `node_modules` is gitignored; worktrees need their own install | Post-merge: orchestrator must run `npm install --legacy-peer-deps` in `leanshot/` |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.5 (client-side), Deno test (Edge Fn) |
| Config file | `leanshot/vitest.config.ts` (Pitfall: `projects:` block may mask; use `--config vite.config.ts` if 0 tests collected — reference_vitest_4_projects_config_masks_default) |
| Quick run command | `cd leanshot && npx vitest run src/lib/native/push.test.ts src/lib/notifications/permission.test.ts` |
| Edge Fn run command | `$HOME/.deno/bin/deno test --no-check supabase/functions/push-dispatch/index.test.ts` |
| Full suite command | `cd leanshot && npm run test:unit && $HOME/.deno/bin/deno test --no-check supabase/functions/push-dispatch/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PUSH-01 | Web VAPID subscription via `permission.ts` registers to push-subscribe | unit | `npx vitest run src/lib/notifications/permission.test.ts` | ✅ exists |
| PUSH-02 | `registerForPush()` on native iOS calls Capacitor plugin + POSTs device_token | unit | `npx vitest run src/lib/native/push.test.ts` | ❌ Wave 0 |
| PUSH-03 | `registerForPush()` on native Android calls Capacitor plugin + POSTs device_token | unit | `npx vitest run src/lib/native/push.test.ts` | ❌ Wave 0 |
| PUSH-04 | push-dispatch fans out to web + ios + android subscriptions; skips missing-secret platforms | unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/push-dispatch/index.test.ts` | ❌ Wave 0 |
| PUSH-05 | Soft-prompt: Capacitor `checkPermissions()` called before `requestPermissions()` | unit | `npx vitest run src/lib/native/push.test.ts` | ❌ Wave 0 |
| PUSH-06 | `helpdesk-reply` category accepted by notification-send and push-dispatch | unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/notification-send/index.test.ts` | ✅ exists (needs widening test) |
| PUSH-07 | Quiet-hours gate blocks non-urgent at 23:00 UTC; allows urgent at 23:00 UTC | unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/push-dispatch/index.test.ts` | ❌ Wave 0 |
| PUSH-08 | failure_count increments on failure; row deleted at failure_count=3; push_failed telemetry | unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/push-dispatch/index.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `$HOME/.deno/bin/deno test --no-check supabase/functions/push-dispatch/index.test.ts`
- **Per wave merge:** `cd leanshot && npm run test:unit`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `supabase/functions/push-dispatch/index.test.ts` — covers PUSH-04, PUSH-07, PUSH-08 (quiet-hours, prune, fan-out with mock transports)
- [ ] `leanshot/src/lib/native/push.test.ts` — covers PUSH-02, PUSH-03, PUSH-05 (Capacitor mock via vi.mock)
- [ ] `supabase/functions/push-dispatch/deno.json` — per-Fn test config

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | push-dispatch verifies service-role bearer (constant-time compare, same as `notification-send`) |
| V3 Session Management | no | Fn is service-role; no session |
| V4 Access Control | yes | push-subscribe uses user JWT; push-dispatch uses service-role only; native tokens tied to auth'd user |
| V5 Input Validation | yes | Body validation: user_id UUID, category enum, payload shape; device_token non-empty string |
| V6 Cryptography | yes | APNs JWT signed via `crypto.subtle` (ES256); web-push via `npm:web-push` (ECDH + AES-GCM); never hand-roll |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Fake device token registration | Spoofing | user JWT required for push-subscribe; JWT verified via `admin.auth.getUser(jwt)` before UPSERT |
| Service-role token exposure in APNs/FCM error logs | Information Disclosure | Delivery error logs must NOT echo back the device token or APNs response body |
| PHI in push notification payload | Information Disclosure | clinic-alerts PHI gate (already in `notification-send`) MUST be enforced in `push-dispatch` too; payload `{ subject, deeplink }` only for clinic-alerts |
| Quiet-hours urgency override abuse | Tampering | `urgent` flag derived from DB `cfg.urgent_escalation`, NOT client payload |
| Token stuffing / mass registration | DoS | One unique constraint per (user_id, device_token); existing constraint per (user_id, endpoint); existing rate-limiting at Supabase layer |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `helpdesk-reply` is the correct category slug for Phase 54 PUSH-06 | Standard Stack, Migration Plan | Must match other category naming conventions; use `helpdesk-reply` (kebab) |
| A2 | APNs JWT token can be signed per-request in a Deno isolate (no need for persistent HTTP/2 connection pooling) | Code Examples — Pattern 2 | APNs HTTP/2 DOES support connection reuse but Deno Deploy isolates are stateless; per-request JWT is correct and Apple supports it |
| A3 | Capacitor `@capacitor/push-notifications` `registration` event provides a `token.value` string for both APNs and FCM | Code Examples — Pattern 4 | If API shape differs, native registration would fail silently |
| A4 | `toLocaleString('en-US', { timeZone: tz }).getHours()` produces correct local hour in Deno V8 for IANA names | Code Examples — Pattern 1 | If Deno V8's Intl timezone DB is outdated, DST transitions could be off by 1h |
| A5 | `google-auth-library@9` JWT class works in Deno with `npm:` prefix without native bindings | Standard Stack | If it requires Node.js built-ins not available in Deno, raw `crypto.subtle` RS256 fallback is needed |
| A6 | web-push postinstall field was a false positive (npm view returned empty stdout = no postinstall) | Package Legitimacy | Confirmed: `npm view web-push scripts` shows no postinstall key |
| A7 | `notification-send`'s `fanOutPush` can be restricted to `platform='web'` rows via `.eq('platform', 'web')` filter without breaking current behavior | Pitfall 6 | All existing `push_subscriptions` rows will have `platform='web'` after the migration backfill; correct |

---

## Open Questions (RESOLVED)

1. **push-dispatch as sub-call vs standalone** — **RESOLVED:** filter approach (no Fn-to-Fn). `notification-send.fanOutPush` adds `.eq('platform','web')`; `push-dispatch` queries all platforms; callers choose which Fn. Encoded in 54-02 + 54-04.

2. **APNs sandbox vs production** — **RESOLVED:** add `APNS_SANDBOX` Function Secret (default true); push-dispatch picks endpoint accordingly. Operator flips to false at Phase 70 when real certs land. Encoded in 54-02 pinned facts.

3. **notification-send category drift** — **RESOLVED:** the 54-01 widening migration syncs `_shared/notification-types.ts` `Category` to all existing categories + `helpdesk-reply` (pre-existing drift cleanup). Encoded in 54-01.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Deno | Edge Fn tests | ✓ | via `$HOME/.deno/bin/deno` | — |
| Node.js / npm | `@capacitor/push-notifications` install | ✓ | v22.18.0 | — |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | push-dispatch web-push | Provisioned (Phase 42 spike) | — | fail-soft: log + skip platform |
| `FCM_SERVICE_ACCOUNT_JSON` | push-dispatch FCM | Not provisioned (Phase 52/70) | — | fail-soft: skip android platform |
| `APNS_PRIVATE_KEY_P8` / `APNS_KEY_ID` / `APNS_TEAM_ID` | push-dispatch APNs | Not provisioned (Phase 52/70) | — | fail-soft: skip ios platform |

**Missing dependencies with no fallback:** None that block build/test. All vendor secrets fail-soft.

**Missing dependencies with fallback:** FCM + APNs secrets — push-dispatch skips those platforms gracefully and logs; unit tests use injectable mock transports.

---

## Sources

### Primary (HIGH confidence)
- Direct file reads of all inventoried files — all `[VERIFIED: direct file read]` tags
- Phase 42 migrations and Edge Fns confirmed verbatim
- `profiles.timezone` confirmed in `20270705000009_phase38_profiles_timezone.sql`
- P49 widening confirmed full 15-category list in `20271001000005_p49_notification_digest_widening.sql`

### Secondary (MEDIUM confidence)
- [Supabase push notifications official example](https://supabase.com/docs/guides/functions/examples/push-notifications) — FCM + google-auth-library@9 JWT pattern `[CITED]`
- npm registry: `@capacitor/push-notifications@8.1.1`, `web-push@3.6.7`, `google-auth-library@10.6.2` confirmed as registry-present with official source repos

### Tertiary (LOW confidence)
- APNs HTTP/2 JWT signing pattern via `crypto.subtle` — [ASSUMED] based on Web Crypto API standard + Apple Developer documentation references; exact `pemToBuffer` implementation not verified
- Capacitor `@capacitor/push-notifications` registration event API shape — [ASSUMED] from official Capacitor docs description

---

## Metadata

**Confidence breakdown:**
- Existing infrastructure inventory: HIGH — all files read directly
- Net-new push-dispatch architecture: MEDIUM — follows established project patterns exactly
- APNs JWT via crypto.subtle: MEDIUM — Web Crypto API is standard; exact PEM parsing helpers [ASSUMED]
- FCM via google-auth-library@9: HIGH — official Supabase example pattern cited
- Migration column shapes: MEDIUM — correct SQL approach; exact idempotency patterns follow project conventions

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (30 days; Capacitor/Supabase are stable; APNs HTTP/2 protocol is stable)
