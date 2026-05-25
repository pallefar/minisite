# Phase 45 — Deferred Items (out-of-scope discoveries)

Issues discovered during execution that are NOT directly caused by the current
plan's changes and were intentionally NOT fixed (per executor scope boundary).

---

## P44 latent gap — `templateForCategory` missing community-mentions / community-replies arms

- **Discovered during:** Plan 45-02 Task 3 (extending `VALID_CATEGORIES`).
- **File:** `supabase/functions/notification-send/index.ts:300` (`templateForCategory`).
- **Issue:** Phase 44 widened the `Category` union to include
  `'community-mentions'` and `'community-replies'` (commit
  `20270720000004_p44_notification_community.sql`) AND set
  `email_enabled_default=true` for `community-mentions`. But
  `templateForCategory` was never extended with cases for either category.
  Result: when notification-send fans out an email for `community-mentions`,
  the switch falls through with no matching arm and returns `undefined`,
  causing the caller's `{ template, phi } = templateForCategory(...)`
  destructure to throw `Cannot destructure property 'template' of undefined`.
- **Why deferred:** Pre-existing from Phase 44; out of scope for Plan 45-02
  per executor scope boundary (only auto-fix issues DIRECTLY caused by the
  current task's changes).
- **Mitigation in this plan:** Added a `default:` arm returning
  `{ template: 'marketing_announcement', phi: false }` so the function is
  total. This unblocks Phase 45 community-dm + community-admin-report fan-out
  (which DO have proper switch arms) AND silently fixes the Phase 44 crash
  by routing mention/reply emails through the marketing template (suboptimal
  but no longer crashes).
- **Pickup:** Phase 44 cleanup PR — add explicit
  `case 'community-mentions': return { template: 'community_mention', phi: false };`
  + `case 'community-replies': return { template: 'community_reply', phi: false };`
  arms, then drop the catch-all default.

---

## P44 latent gap — `templateForCategory` is non-exhaustive (TS2366)

- **Discovered during:** Plan 45-02 Task 3 (`deno check notification-send/index.ts`).
- **Issue:** The function declared return type
  `{ template: EmailTemplate; phi: boolean }` but only handled 5 of the 7
  Phase 44-era Category union members. `deno check` reports TS2366. The
  project's CI evidently does not gate on `deno check` for this file (no
  Phase 44 SUMMARY entry, no Phase 48 follow-up).
- **Why deferred:** Pre-existing; this plan's default-arm fix above also
  resolves the TS error.
