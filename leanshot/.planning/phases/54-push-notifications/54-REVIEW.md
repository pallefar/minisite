---
phase: 54-push-notifications
reviewed: 2026-05-25T11:54:14Z
depth: deep
files_reviewed: 7
files_reviewed_list:
  - supabase/functions/push-dispatch/index.ts
  - supabase/functions/push-subscribe/index.ts
  - supabase/functions/notification-send/index.ts
  - leanshot/src/lib/native/push.ts
  - leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx
  - supabase/migrations/20280201000001_p54_push_subscriptions_platform.sql
  - supabase/migrations/20280201000002_p54_notification_helpdesk_widening.sql
findings:
  critical: 4
  warning: 4
  info: 2
  total: 10
status: issues_found
---

# Phase 54: Code Review Report

**Reviewed:** 2026-05-25T11:54:14Z
**Depth:** deep
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 54 adds cross-platform push fan-out (APNs ES256, FCM, web-push), native device registration, quiet-hours gating, and a helpdesk-reply notification category. The implementation is architecturally coherent, and the threat-model documentation is thorough. However, two patient-safety BLOCKERS exist in the core dispatch path: (1) the `notification_category_config` query drops the category filter to work around a test-mock limitation, meaning `urgent_escalation` for clinic-alerts will never load correctly in production with multiple config rows, and (2) the `profiles` timezone query is also unfiltered. Additionally, APNs defaults to sandbox mode absent an explicit env var, silently discarding all production iOS pushes. The FCM transport forwards the entire payload (including clinic-alert `subject`) to Google's servers as the `data` field. A re-registration UPSERT in `push-subscribe` fails to reset `failure_count`, allowing a re-registered device to be pruned after a single subsequent failure.

---

## Critical Issues

### CR-01: `notification_category_config` queried without category filter — urgent escalation always null in production

**File:** `supabase/functions/push-dispatch/index.ts:527-529`
**Issue:** The `notification_category_config` query calls `.select(...).single()` with no `.eq('category', category)` filter. The comment at line 512 shows the *intended* query (`.eq('category', val)`) was deliberately removed to match the test mock's chain limitations. In production, `notification_category_config` has one row per category (16+ rows). Without a filter, `.single()` returns a Supabase PGRST116 error ("multiple rows returned"), so `cfgResult.data` is `null`, `cfg` is `null`, and `isUrgent` is always `false`. This means urgent clinic-alert pushes (T-54-02-03 / patient safety invariant) will always be blocked during quiet-hours — the exact failure mode the `urgent_escalation` flag exists to prevent.

**Fix:** Add the missing `.eq('category', category)` filter. The test mock must be updated to support the full `.select().eq().single()` chain (not just `.select().single()`):

```typescript
(admin.from('notification_category_config') as any)
  .select('category, urgent_escalation, daily_cap, weekly_cap')
  .eq('category', category)
  .single(),
```

The test mock needs to handle `.eq()` before `.single()` for non-subscription tables. If the mock cannot be extended, switch to `.maybeSingle()` and add `.eq()` — the mock can be restructured to return the correct value based on the `.eq()` argument.

---

### CR-02: `profiles` queried without user_id filter — wrong timezone returned for every user

**File:** `supabase/functions/push-dispatch/index.ts:530-532`
**Issue:** The `profiles` query calls `.select('timezone').single()` with no `.eq('id', user_id)` filter. In a multi-tenant database, `.single()` on an unfiltered table either errors (multiple rows → `data: null`, defaulting to `'UTC'`) or returns the lexicographically first profile's timezone. Every dispatch therefore evaluates quiet-hours against the wrong user's timezone (or UTC). A user in Tokyo (JST +9) at 07:00 local would not be gated, but a user in San Francisco (PST -8) at 01:00 local would also not be gated — depending on which random row `.single()` picks.

**Fix:** Add `.eq('id', user_id)` before `.single()`. Update the test mock correspondingly:

```typescript
(admin.from('profiles') as any)
  .select('timezone')
  .eq('id', user_id)
  .single(),
```

---

### CR-03: APNs defaults to sandbox — all production iOS pushes silently dropped

**File:** `supabase/functions/push-dispatch/index.ts:351`
**Issue:** `const sandbox = Deno.env.get('APNS_SANDBOX') !== 'false'` evaluates to `true` when `APNS_SANDBOX` is absent. An absent env var is the normal production state unless an operator explicitly sets `APNS_SANDBOX=false`. APNs sandbox tokens are issued by `api.sandbox.push.apple.com` and are rejected by `api.sandbox.push.apple.com` for non-sandbox apps — but the real problem is the reverse: production device tokens registered against `api.push.apple.com` will receive a 400 or 410 from the sandbox endpoint, causing `push-dispatch` to treat every iOS delivery as a failure, incrementing `failure_count` toward the prune threshold. After 3 failures, production iOS subscriptions are deleted.

**Fix:** Default to production (sandbox=false) and require an explicit opt-in for sandbox:

```typescript
const sandbox = Deno.env.get('APNS_SANDBOX') === 'true';
```

Document `APNS_SANDBOX=true` as a dev/test-only secret in the Fn's README.

---

### CR-04: FCM `data` field forwards clinic-alert `subject` (PHI-adjacent) to Google's servers

**File:** `supabase/functions/push-dispatch/index.ts:430`
**Issue:** The FCM message body includes `data: parsedPayload` (line 430), which is the entire notification payload. For `clinic-alerts`, the D-13 gate permits `{subject, deeplink}`. The `subject` field contains a clinic-generated alert subject line (e.g. "Your lab result for HbA1c is available") — PHI-adjacent health context. This is sent in the `data` envelope to Google's FCM API and is stored/logged by Google's servers per their FCM data-handling policy. T-54-02-04 mitigates PHI in the *visible* push body but does not prevent it from reaching a third-party vendor in the data envelope.

**Fix:** For `clinic-alerts`, strip the `data` field from the FCM message body, or replace it with a non-PHI deeplink-only envelope:

```typescript
const isClinicAlert = /* detect from category context */;
const fcmBody = {
  message: {
    token: deviceToken,
    notification: {
      title: String(parsedPayload.title ?? ''),
      body: String(parsedPayload.body ?? ''),
    },
    // Only include data for non-PHI categories
    ...(isClinicAlert ? {} : { data: parsedPayload }),
  },
};
```

Since `defaultFcmTransport` does not currently receive `category`, the simplest fix is to pass `category` as a transport option (extend `FcmTransportFn` signature) or strip `subject` from the `data` field regardless of category (since notification bodies should not duplicate in `data`).

---

## Warnings

### WR-01: `push-subscribe` UPSERT does not reset `failure_count` on re-registration

**File:** `supabase/functions/push-subscribe/index.ts:190-198`
**Issue:** When a device re-registers (token refresh, app reinstall) with the same `(user_id, device_token)` pair, the UPSERT at lines 190-198 updates `platform` and `updated_at` but does NOT reset `failure_count` to `0`. If the subscription had `failure_count=2` (one more failure away from auto-prune), re-registration does not clear that counter. One subsequent delivery failure will prune the subscription even though the device actively re-registered.

**Fix:** Add `failure_count: 0` to both native and web UPSERT payloads:

```typescript
upsertRes = await (admin.from('push_subscriptions') as any).upsert(
  {
    user_id: userId,
    platform: body.platform,
    device_token: body.device_token,
    failure_count: 0,          // ← reset on re-registration
    updated_at: new Date().toISOString(),
  },
  { onConflict: 'user_id,device_token' },
);
```

Apply the same fix to the web UPSERT at lines 203-214.

---

### WR-02: `push-subscribe` uses deprecated `denoGlobal?.serve` guard instead of `import.meta.main`

**File:** `supabase/functions/push-subscribe/index.ts:229-231`
**Issue:** `push-subscribe` was modified in Phase 54 (54-03) but retains the old guard pattern `if (denoGlobal?.serve)` instead of the `import.meta.main` pattern required by `reference_deno_test_top_level_serve_trap`. The project memory explicitly notes the old guard is "insufficient — Deno.serve exists in test context." `push-dispatch` (the Phase 54 flagship Fn) correctly uses `import.meta.main`. Any test that imports `push-subscribe` (e.g., the Phase 42 `push-subscribe` test suite, or any future integration test) will trigger `Deno.serve`, binding a port and aborting subsequent tests.

**Fix:** Replace the guard in `push-subscribe/index.ts` (and `notification-send/index.ts` which has the same issue):

```typescript
// push-subscribe/index.ts — replace lines 229-232:
if (import.meta.main) {
  Deno.serve(handleSubscribe);
}
```

---

### WR-03: `constantTimeEqual` early-exits on length mismatch — leaks key-length via timing

**File:** `supabase/functions/push-dispatch/index.ts:65-70` and `supabase/functions/notification-send/index.ts:71-76`
**Issue:** Both implementations return `false` immediately when `a.length !== b.length`, which reveals whether the submitted bearer is the right length in O(1) measurable time. For service-role JWTs (large, fixed-format tokens) this is a very low practical risk, but it breaks the constant-time contract explicitly claimed in the threat model (T-54-02-01, T-42-05 "constant-time bearer check").

**Fix:** Always iterate the full expected length regardless of input length:

```typescript
function constantTimeEqual(a: string, b: string): boolean {
  const len = b.length; // use expected length as authoritative
  let diff = 0;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) ?? 0) ^ b.charCodeAt(i);
  }
  diff |= a.length ^ b.length; // fold length difference in
  return diff === 0;
}
```

---

### WR-04: `handleRestore` sets `throttle_until` to `now()` instead of clearing it

**File:** `leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx:318-330`
**Issue:** `handleRestore` calls `.update({ throttle_until: new Date().toISOString() })` (line 320). This sets the throttle expiry to the current moment, not to `null`. The `throttledCats` filter (line 218) tests `new Date(d.throttle_until).getTime() > now` — with `throttle_until` equal to `now`, the condition is false, so the banner disappears. However, the optimistic local state update at line 330 sets `throttle_until` to a freshly computed `new Date()` that is a few milliseconds *later* than the DB write, which means the in-memory filter briefly re-shows the suppression banner on the next render cycle. More importantly, setting `throttle_until = NOW()` rather than `null` leaves a non-null value in the database, which may confuse future queries that check for `throttle_until IS NULL` (vs `throttle_until > now()`). The semantically correct action is to set `throttle_until` to `null` (or a past timestamp).

**Fix:**

```typescript
const { error } = await supabase
  .from('notification_dismissal_state')
  .update({ throttle_until: null })          // ← clear, not set-to-now
  .eq('user_id', userId)
  .eq('category', category);
// Optimistic update:
{ ...r, throttle_until: null }
```

---

## Info

### IN-01: `now` field in `DispatchBody` is dead code for HTTP callers; misleading header comment

**File:** `supabase/functions/push-dispatch/index.ts:7` and `:135-156`
**Issue:** The block comment documents `now?: Date` as part of the HTTP body. However, `JSON.parse` never produces `Date` instances, so `obj.now instanceof Date` (line 156) is always `false` for HTTP requests — `now` is always `undefined` and `new Date()` is always used. The field exists only for unit tests that call `dispatch()` directly. The public-facing comment implies it's an HTTP-settable clock override, which it is not.

**Fix:** Remove `now` from the block-comment body description, and add a note clarifying it is internal-only:

```typescript
// Body: { user_id: string, category: Category, payload: object }
// NOTE: `now` is not accepted via HTTP; inject via dispatch() directly in tests only.
```

---

### IN-02: `String(error)` in `registrationError` listener may log unhelpful `[object Object]`

**File:** `leanshot/src/lib/native/push.ts:120`
**Issue:** `resolve({ ok: false, error: String(error) })` converts Capacitor's `RegistrationError` object with `String()`. Capacitor's `RegistrationError` is `{ error: string }` — `String({ error: "..." })` produces `[object Object]` rather than the error message. This causes unhelpful error strings in the `NotificationsSubtab` UI (`res.error` in the toast at lines 254-257).

**Fix:**

```typescript
void PushNotifications.addListener('registrationError', (error) => {
  if (_currentRegId() !== myId) return;
  const msg = typeof error === 'object' && error !== null && 'error' in error
    ? String((error as { error: unknown }).error)
    : String(error);
  resolve({ ok: false, error: msg });
});
```

---

_Reviewed: 2026-05-25T11:54:14Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
