---
phase: 54-push-notifications
fixed_at: 2026-05-25T14:02:00Z
review_path: leanshot/.planning/phases/54-push-notifications/54-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 54: Code Review Fix Report

**Fixed at:** 2026-05-25T14:02:00Z
**Source review:** leanshot/.planning/phases/54-push-notifications/54-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (4 Critical + 3 Warning; Info findings excluded by fix_scope)
- Fixed: 7
- Skipped: 0

---

## Fixed Issues

### CR-01 + CR-02: Missing .eq filters on category_config and profiles queries

**Files modified:** `supabase/functions/push-dispatch/index.ts`, `supabase/functions/push-dispatch/index.test.ts`
**Commit:** `df1d02ea`
**Applied fix:** Added `.eq('category', category)` before `.single()` on the `notification_category_config` query, and `.eq('id', user_id)` before `.single()` on the `profiles` query. Without these filters, `single()` on a multi-row table returns a PGRST116 error in production (multiple rows), making `cfg` null and `isUrgent` always false — silently blocking urgent clinic-alerts during quiet-hours. The `profiles` filter ensures quiet-hours evaluates against the correct user's timezone rather than a random row.

Updated the test mock in `index.test.ts` to support the `.select().eq().single()` chain for `notification_category_config` and `profiles` tables: `eq()` now returns a chainable object with a `.single()` method for non-subscriptions tables, while `push_subscriptions` retains the leaf `{ data: [], error: null }` shape. All 6 Deno tests pass (T1–T6).

---

### CR-03: APNs sandbox default inverted — production is now the default

**Files modified:** `supabase/functions/push-dispatch/index.ts`
**Commit:** `78136a3c`
**Applied fix:** Changed `Deno.env.get('APNS_SANDBOX') !== 'false'` to `=== 'true'`. Previously, an absent `APNS_SANDBOX` env var (the normal production state) defaulted to sandbox mode, routing all production iOS device tokens to `api.sandbox.push.apple.com`. This caused 400/410 responses that incremented `failure_count` and eventually triggered the PUSH-08 auto-prune (3 failures), deleting all iOS subscriptions. Sandbox is now explicit opt-in.

---

### CR-04: PHI data-minimization — subject field stripped from vendor push payloads (requires human verification)

**Files modified:** `supabase/functions/push-dispatch/index.ts`
**Commit:** `3d5cd444`
**Applied fix:** Before the fan-out loop, a PHI-safe `vendorPayload` is derived from the category. For PHI categories (`clinic-alerts`), the vendor payload replaces the subject with a generic body ("You have a new clinic alert. Open the app to view.") and retains only `title` and `deeplink` (if present). The raw `subject` — which may contain clinic-generated health context (lab values, HbA1c, etc.) — is never serialized into `payloadJson` for PHI categories. Non-PHI categories (dose-reminders, community-*, marketing, billing, etc.) pass the full payload unchanged.

**PHI category classification used:**
- `clinic-alerts` — PHI (clinic-generated subject, may contain lab results / health context)
- All other categories — non-PHI (no personal health data in subject field)

This fix applies at the `dispatch()` level so the minimized payload flows through all three transports (web VAPID, APNs, FCM) without per-transport changes.

**Status: fixed — requires human verification** (logic judgment call on PHI category scope; operator should confirm the generic body text meets UX/clinical requirements)

---

### WR-01: failure_count reset on push-subscribe re-registration

**Files modified:** `supabase/functions/push-subscribe/index.ts`
**Commit:** `aacf0c86`
**Applied fix:** Added `failure_count: 0` to both the native `device_token` UPSERT and the web `endpoint` UPSERT payloads. A re-registering device is actively healthy; preserving a stale `failure_count` would prune it after a single subsequent delivery failure even though the device explicitly re-registered.

---

### WR-02: Upgrade denoGlobal?.serve guard to import.meta.main

**Files modified:** `supabase/functions/push-subscribe/index.ts`, `supabase/functions/notification-send/index.ts`
**Commit:** `65248d79`
**Applied fix:** Replaced the deprecated `denoGlobal?.serve` guard with `if (import.meta.main)` in both files. The legacy guard fires during `deno test` because `Deno.serve` exists in test context, binding a real port and aborting subsequent tests. `import.meta.main` is the reliable discriminator (matches `push-dispatch/index.ts` which already used this pattern). Verified: all 17 notification-send tests and all 6 push-dispatch tests pass after change.

---

### WR-03: constantTimeEqual — eliminate early exit on length mismatch

**Files modified:** `supabase/functions/push-dispatch/index.ts`, `supabase/functions/notification-send/index.ts`
**Commit:** `6f34be2f`
**Applied fix:** Both implementations returned `false` immediately when `a.length !== b.length`, leaking whether the submitted bearer token is the correct length via timing side-channel. New implementation: iterate the full expected-value length (`b.length`), then fold the length difference into the XOR accumulator (`diff |= a.length ^ b.length`). This preserves the constant-time contract claimed in the threat model (T-54-02-01, T-42-05).

---

### WR-04: handleRestore sets throttle_until to null, not NOW()

**Files modified:** `leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx`
**Commit:** `74640a60`
**Applied fix:** Changed the DB update from `{ throttle_until: new Date().toISOString() }` to `{ throttle_until: null }` and updated the optimistic `setDismissals` local state update to match. Setting `throttle_until` to the current timestamp instead of `null` left a non-null value in the database (breaks future `IS NULL` checks), and the local optimistic update raced with the DB write (freshly computed `new Date()` is a few ms later, briefly re-showing the suppression banner). Type-safe: `DismissalState.throttle_until` is typed as `string | null`.

---

## Verification Results

| Check | Result |
|-------|--------|
| `deno test push-dispatch/index.test.ts` | 6/6 passed |
| `deno test notification-send/index.test.ts` | 17/17 passed |
| `tsc -p tsconfig.app.json --noEmit` | exit 0 (no errors) |
| `vitest run NotificationsSubtab.test.tsx` | 16/16 passed |

---

_Fixed: 2026-05-25T14:02:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
