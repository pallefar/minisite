# Phase 49 — Deferred Items

Out-of-scope discoveries surfaced during plan execution. Each entry lists what was found, where, and which plan should pick it up.

---

## D-49-DEFERRED-01 — Pre-existing inverted opt-out fake in community-daily-digest tests

**Discovered:** Plan 49-07 execution (Task 2 Deno test sweep).
**Status:** OUT OF SCOPE for 49-07 (pre-existing on main; not caused by 49-07 changes).
**File:** `supabase/functions/community-daily-digest/index.test.ts`
**Symptom:** `deno test --no-check --allow-all supabase/functions/community-daily-digest/` — T2 and T3 fail with inverted assertions:
  - T2 ("opt-out → skipped:opted_out") returns `sent` instead.
  - T3 ("non-empty + opted-in → sent") returns `skipped:opted_out` instead.
**Root cause:** Fake admin's `maybeSingle()` for `notification_settings` returns `enabled: cfg.optOut === false ? false : true`, which is the inverse of intent. When `cfg.optOut=true`, the fake returns `enabled: true` (the run treats the user as opted-IN).
**Fix:** Replace with `enabled: cfg.optOut !== true` (same fix applied to the weekly test scaffold landed in 49-07).
**Suggested owner:** Phase 49 close-out OR a Plan 49-06 fast-follow. Trivial 1-line fix; no migration impact.
**Production impact:** None. The Edge Fn logic itself is correct (`isOptedOut` returns `data?.enabled === false`). Only the test fixture is wrong → false-failing test suite for the daily Fn.

---
