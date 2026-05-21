---
phase: 35-m3-gamification-engine
plan: "08"
subsystem: gamification/settings
tags:
  - gamification
  - settings
  - leaderboard
  - opt-in
  - nudge
  - persistence

dependency_graph:
  requires:
    - 35-04  # leaderboard RPCs: setLeaderboardOptin, suggestLeaderboardHandle, LeaderboardApiError
    - 35-06  # GamificationCard + LeaderboardCard with stubbed props (now wired)
  provides:
    - user_leaderboard_prefs table with monotonic nudge_dismissed_at
    - Settings → Leaderboards subtab (GAME-04 opt-in surface)
    - leaderboardNudgeDismissed store slice + setLeaderboardNudgeDismissed action
    - leanshot:open-settings global event for cross-component navigation
  affects:
    - 35-10  # next gamification plan may consume leaderboardNudgeDismissed state

tech_stack:
  added:
    - user_leaderboard_prefs table (Postgres, RLS, monotonic trigger)
  patterns:
    - Lazy Suspense subtab pattern (mirrors NotificationsSubtab)
    - Fast-paint + DB write-through nudge persistence (localStorage cache + Supabase upsert)
    - Global custom event for cross-component navigation (leanshot:open-settings)

key_files:
  created:
    - supabase/migrations/20270708000022_p35_user_leaderboard_prefs.sql
    - leanshot/src/components/dashboard/settings/LeaderboardsSubtab.tsx
    - leanshot/src/components/dashboard/settings/__tests__/LeaderboardsSubtab.test.tsx
  modified:
    - leanshot/src/components/dashboard/settings/SettingsPage.tsx
    - leanshot/src/components/dashboard/cards/GamificationCard.tsx
    - leanshot/src/lib/storage.ts
    - leanshot/src/lib/store.ts
    - leanshot/src/App.tsx

decisions:
  - "Migration timestamp 20270708000022 used (plan specified 20270708000020 but that was taken by p35_streak_warn_helper)"
  - "Deep-link settingsTargetSection deferred per plan's planner note — onOpenLeaderboardSettings dispatches leanshot:open-settings event, opening Settings at default section"
  - "leaderboardNudgeDismissed cleared on sign-out (clearUserDataSlices) so next user fetches their own dismiss state from DB on hydrate"
  - "setSession action (not hydrate()) is the cross-device sync hook — fires when INITIAL_SESSION resolves with a verified user"
  - "Node_modules symlink created in worktree for test execution (worktree lacks own node_modules per memory reference_npm_install_worktree_main_drift)"

metrics:
  duration: "~30 minutes"
  completed: "2026-05-21"
  tasks_completed: 3
  files_created: 3
  files_modified: 5
---

# Phase 35 Plan 08: Settings → Leaderboards subtab + opt-in nudge wiring + nudge-dismiss persistence Summary

User-facing opt-in surface for cohort leaderboards (GAME-04): a Settings → Leaderboards subtab with per-cohort toggle + handle picker + suggest button; plus persisted single-shot nudge dismissal backed by a new `user_leaderboard_prefs` Postgres table.

## What Was Built

### Task 1 — user_leaderboard_prefs migration (commit 1ea1166)

Created `supabase/migrations/20270708000022_p35_user_leaderboard_prefs.sql`:

- `user_leaderboard_prefs` table: `(user_id PK → auth.users, nudge_dismissed_at, last_seen_at, updated_at)`
- RLS: select-own + insert-own + update-own (auth.uid() = user_id); no DELETE (FK cascade covers account deletion)
- Monotonic trigger `trg_p35_lb_prefs_monotonic` blocks un-dismissal (T-35-08-01 mitigation)
- Named dollar-quoting `$body$` used per Postgres convention

Note: Plan specified timestamp `20270708000020` but that was taken by `p35_streak_warn_helper.sql`; bumped to `20270708000022` (first free slot).

### Task 2 — LeaderboardsSubtab + Section enum + RTL tests (commit 9e73f4e)

**LeaderboardsSubtab.tsx:**
- Fetches leaderboard-enabled cohorts the user belongs to via INNER JOIN on cohort_membership
- Per-cohort: opt-in checkbox, handle picker (shown when opted-in or draft non-empty), suggest button
- `validateHandle` from Plan 35-04 provides live client-side feedback (D-13 regex)
- `suggestLeaderboardHandle` from Plan 35-04 populates handle field
- `setLeaderboardOptin` from Plan 35-04 used for both opt-in (active=true) and opt-out (active=false, handle preserved per D-15)
- Opt-out toast says "changes may take up to 15 minutes to sync" (D-15 matview refresh window)

**SettingsPage.tsx:**
- `Section` type union extended with `'leaderboards'` literal
- `Trophy` nav entry added between Notifications and Privacy
- Lazy import + Suspense render branch added
- `pickPartialized()` updated to include `leaderboardNudgeDismissed` (PersistedState contract)

**RTL tests (3 pass):**
- Lists leaderboard-enabled cohorts
- Suggest button populates handle from RPC
- Invalid handle (real-name shape with spaces) rejected with inline error

### Task 3 — GamificationCard wiring + store slice (commit 59a11eb)

**storage.ts:**
- `leaderboardNudgeDismissed: boolean` added to `PersistedState` interface + `initialState` (default: `false`)

**store.ts:**
- `setLeaderboardNudgeDismissed` action: monotonic fast-paint set + best-effort DB upsert to `user_leaderboard_prefs`
- `setSession` extended: when verified user signs in, fetches `nudge_dismissed_at` from DB for cross-device sync
- `partialize` includes `leaderboardNudgeDismissed`
- `clearUserDataSlices` resets to `false` on sign-out

**GamificationCard.tsx:**
- `primaryCohort` fetched on mount (alphabetically first leaderboard-enabled cohort)
- All 5 LeaderboardCard props wired: `cohortId`, `hasOptedIn`, `nudgeDismissed`, `onDismissNudge`, `onOpenLeaderboardSettings`
- `onOpenLeaderboardSettings` dispatches `leanshot:open-settings` custom event

### Rule 3 Auto-fix — App.tsx event listener (commit 6a74c41)

`GamificationCard.onOpenLeaderboardSettings` dispatches `leanshot:open-settings` but App.tsx had no listener, making the nudge CTA button a no-op. Added event listener in App.tsx following the `leanshot:replay-tour` pattern. TypeScript confirmed clean after fix.

## Confirmation of Plan Requirements

- **SettingsPage Section enum + nav entry + render branch:** All updated (Section union has `'leaderboards'`, nav has `Trophy` entry, render branch with Suspense exists).
- **Deep-link settingsTargetSection:** Not added (planner's note: deferred). `onOpenLeaderboardSettings` opens Settings at the default `'account'` section via the new event. User sees the nav and can navigate to Leaderboards.
- **Store hydrate pulls user_leaderboard_prefs.nudge_dismissed_at:** Implemented in `setSession` (fires on every INITIAL_SESSION + SIGNED_IN). The `hydrate()` function itself doesn't need extension since it triggers `persist.rehydrate()` which then triggers `setSession` from App.tsx's auth handler.
- **Manual test (dismiss nudge + reload → nudge stays gone):** Persistence mechanism is in place: localStorage cache (`leaderboardNudgeDismissed: true`) + DB row (`nudge_dismissed_at` timestamp). Single-shot: once `true`, the store never sets it back to `false` for the current user. Cross-device: DB fetch on sign-in re-hydrates the dismissed state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added leanshot:open-settings event listener in App.tsx**
- **Found during:** Task 3 stub scan
- **Issue:** GamificationCard dispatches `leanshot:open-settings` but App.tsx had no listener — the CTA button was a no-op
- **Fix:** Added `useEffect` listener in App.tsx mirroring the `leanshot:replay-tour` pattern
- **Files modified:** `leanshot/src/App.tsx`
- **Commit:** 6a74c41

**2. [Rule 2 - Missing critical] leaderboardNudgeDismissed in SettingsPage.pickPartialized()**
- **Found during:** TypeScript check after Task 3
- **Issue:** `PersistedState` type required `leaderboardNudgeDismissed` but `pickPartialized()` didn't include it
- **Fix:** Added `leaderboardNudgeDismissed: fullState.leaderboardNudgeDismissed` to `pickPartialized()`
- **Files modified:** `leanshot/src/components/dashboard/settings/SettingsPage.tsx`
- **Commit:** included in 59a11eb

**3. [Timestamp collision] Migration file timestamp bumped**
- **Found during:** Task 1
- **Issue:** Plan specified `20270708000020` but `20270708000020_p35_streak_warn_helper.sql` already exists
- **Fix:** Used `20270708000022` (next free slot after `20270708000021`)
- **Documented in:** Migration file header comment

## Known Stubs

None — all plan-specified props are wired. The `onOpenLeaderboardSettings` opens settings at the default section (not deep-linked to 'leaderboards') per planner's note; this is documented as a polish deferral, not a stub that blocks the feature.

## Threat Surface Scan

No new network endpoints or trust boundaries beyond the plan's declared `user_leaderboard_prefs` table (T-35-08-01 through T-35-08-05 already in plan threat model). The `leanshot:open-settings` custom event is local to the browser window and does not cross any trust boundary.

## Self-Check: PASSED

Files exist:
- `supabase/migrations/20270708000022_p35_user_leaderboard_prefs.sql` — FOUND
- `leanshot/src/components/dashboard/settings/LeaderboardsSubtab.tsx` — FOUND
- `leanshot/src/components/dashboard/settings/__tests__/LeaderboardsSubtab.test.tsx` — FOUND

Commits exist:
- `1ea1166` (migration) — FOUND
- `9e73f4e` (subtab + tests) — FOUND
- `59a11eb` (store wiring) — FOUND
- `6a74c41` (App.tsx fix) — FOUND

TypeScript: clean (0 errors)
Tests: 49 passed (3 new LeaderboardsSubtab RTL + 46 existing gamification)
