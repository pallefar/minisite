---
status: blocked
trigger: "6/7 deferred e2e specs fail post-signin in prod-build CI; 7th (signout) fails downstream. Local dev passes. After 3 progressive fix attempts in Plan 07-01 (budget raises, store-gate widening, role-based locators), CI still reports 4 pass / 7 fail."
created: 2026-05-12T12:00:00Z
updated: 2026-05-12T13:15:00Z
---

## Current Focus

hypothesis: "Two confirmed root causes fixed (RC1: maybeStartMigration reads stale universal key; RC2: 'All done' MigrationModal masks AppShell nav via aria-modal=true). One remaining: on cold-cache CI runs (specifically the first browser.newContext() spawned in the run), the seeded `state.user` is NOT visible in the in-memory store after seedUserAndSignIn — viewLog reports user=false throughout and selectView returns 'marketing'. The persisted blob ends up with hasUser=false AND ack=null, indicating SOMETHING fully reset state to initialState mid-signin. Retries (warm cache) succeed reliably."
test: "Read diagnostic dump JSON from CI run 25736044388. Compare FAIL state (storeUser=null, lsBlob.hasUser=false) vs PASS retry (storeUser=SEED_USER, lsBlob.hasUser=true)."
expecting: "Identification of the code path that resets state.user + ack to null on cold-cache cross-context first-sign-in. Most plausible: race between renameStorageNamespace, persist.rehydrate, and a SIGNED_OUT or INITIAL_SESSION(null) event from supabase-js's cold-start initialization."
next_action: "Open a follow-up plan (07-02b) that adds Zustand-level instrumentation logging EVERY clearUserDataSlices() invocation + persist.rehydrate() result to window.__leanshot_state_log__, then re-run on CI to catch the reset."

## Symptoms

expected: "All 7 re-enabled e2e specs pass in CI (11/11 green)"
actual: "4 pass / 7 fail across 3 CI runs (25730420437, 25731078841, 25731926117). Failure: post-signin assertion never resolves (`getByTestId('dashboard')`, `getByRole('navigation', { name: /primary navigation/i })`, `getByRole('heading', { name: 'Migrating your data' })`)."
errors: "element(s) not found within timeout, hits per-test setTimeout ceiling (90s/120s)"
reproduction: "Push commit; wait for CI; observe e2e-smoke job fail with 4 pass / 7 fail."
started: "First observed when 07-01 flipped the 7 test.fixme markers to test"

## Eliminated

- hypothesis: "Sidebar's `hidden md:flex` requires viewport ≥768px which CI doesn't provide"
  evidence: "Playwright Desktop Chrome device = 1280×720; the md: breakpoint is active. Confirmed via test snapshot showing nav in DOM."
  timestamp: 2026-05-12T12:30:00Z

- hypothesis: "view never transitions to 'dashboard' (state.user clobbered by setSession or pull)"
  evidence: "setSession only writes to signedIn slice; pullInitialInjections/Photos only touch entity slices. None of the SIGNED_IN drain branch callers touch state.user. mergeServerSettings would (line 1486 of store.ts), but it's only called by pullInitialSettings which is not invoked in the deferOnSignedIn drain."
  timestamp: 2026-05-12T13:05:00Z

- hypothesis: "Cold network fetch takes >30s for chunks"
  evidence: "Trace 1-trace.network for cross-device-sync shows all vendor chunks load in <30ms (localhost preview-server). Slowest items: Supabase POST 431ms, two GET 551ms+554ms (post-signin pulls). Total cold-path completion <2s."
  timestamp: 2026-05-12T13:10:00Z

## Evidence

- timestamp: 2026-05-12T12:01:00Z
  checked: "src/lib/storage.ts:170-178 (namespacedKey)"
  found: "Namespaced key shape is `leanshot_v4:<16hex>` — uses a COLON, not underscore."
  implication: "Specs that filter `localStorage.key.startsWith('leanshot_v4')` still match. Comments in signout-cache-clear.spec.ts that say 'leanshot_v4_user_<hash>' are stale but the startsWith() glob still works. NOT a failure cause."

- timestamp: 2026-05-12T12:30:00Z
  checked: "CI run 25731926117 Playwright trace 1d9c9816..."
  found: "Test cross-device-sync hit toBeVisible(nav) waited 30s then timed out. test-failed-1.png and aria snapshot at test end show FULLY-RENDERED DASHBOARD with nav AND guided tour dialog open."
  implication: "Dashboard does eventually render. The failure was a timing issue: nav not visible within 30s after click."

- timestamp: 2026-05-12T12:50:00Z
  checked: "src/lib/migration.ts:169 readV4Snapshot vs App.tsx SIGNED_IN ordering"
  found: "App.tsx calls renameStorageNamespace BEFORE deferOnSignedIn (which triggers maybeStartMigration). renameStorageNamespace DELETES the universal `leanshot_v4` key. By the time maybeStartMigration runs, readV4Snapshot's localStorage.getItem('leanshot_v4') returns null → v4HasUserData(null) false → fresh-migration early-returns → MigrationModal never renders."
  implication: "CONFIRMED ROOT CAUSE 1 for migrate-resume.spec.ts Test 1 (Phase 6 SC#1 first-sign-in path). FIX: a8f6824 — readV4Snapshot/snapshotPreCloudBackup now fall back to getActiveStorageNamespace() when universal is empty."

- timestamp: 2026-05-12T13:20:00Z
  checked: "CI run 25734224859 — migrate-resume Test 1 post fix #1"
  found: "Migration heading 'Migrating your data' now appears. Test progresses to click 'Continue to dashboard' but Playwright reports: '<div role=\"button\" aria-label=\"Close tour\" class=\"absolute inset-0 bg-black/55 pointer-events-auto\"></div> subtree intercepts pointer events.'"
  implication: "CONFIRMED ROOT CAUSE 2 (subset): GuidedTour auto-opens 900ms after dashboard mount and its backdrop intercepts clicks. For non-migration-modal tests, this was already visible in the test snapshot from run 25731926117 — but masked because migrate-resume Test 1 had a prior failure earlier in the chain."

- timestamp: 2026-05-12T13:25:00Z
  checked: "src/App.tsx:344-357 auto-launch tour effect"
  found: "Tour auto-opens whenever shouldShowTour() returns true (i.e., when localStorage.leanshot_tour_seen_v4 is unset). Seeded blobs do NOT include this key, so every seeded-then-signed-in test triggers the tour. The 4 passing specs (auth-signup-verify-signin × 2, onboarding, password-reset) don't click any dashboard element post-signin so the tour overlay never blocks them."
  implication: "FIX 2 applied (6e78c2a): skip auto-launch tour when VITE_E2E='true'. Vercel production builds do NOT set this flag — real users still see the tour on first dashboard mount."

- timestamp: 2026-05-12T13:30:00Z
  checked: "CI run 25735158043 (after fixes 1 + 2)"
  found: "migrate-resume Test 1 PASSES (3.8s — was FAIL). Tour no longer blocks. BUT 'All done' MigrationModal still renders for the 5 non-migration seeded specs (cross-device-sync, offline-conflict-toast, offline-log-then-sync, photo-cross-device, signout-cache-clear) because the migration state machine now actually runs (post fix #1). Modal sets aria-modal='true' (Modal.tsx:83) which masks the AppShell nav from getByRole accessibility queries."
  implication: "CONFIRMED ROOT CAUSE 3: a11y modal masking. FIX 3 applied (8800529): seed `migration_state: { complete: true, all-entities: 'complete' }` in 4 spec helpers (cross-device-sync, offline-log-then-sync, offline-conflict-toast, photo-cross-device) so maybeStartMigration's already-complete short-circuit fires."

- timestamp: 2026-05-12T13:40:00Z
  checked: "CI run 25736044388 (after fixes 1 + 2 + 3)"
  found: "photo-cross-device PASSES (5.0s — was FAIL). migrate-resume Test 1 + Test 2 PASS. cross-device-sync, offline-conflict-toast, offline-log-then-sync STILL fail. Diagnostic spec also FAILED on first attempt (19.6s, retry passed in 4.8s). FAIL viewLog: 3 entries ALL with user=false. lsBlob shows the namespaced key holds {version: 8, hasUser: false, ack: null}. Final view: 'marketing'. bodyText: marketing page."
  implication: "CONFIRMED ROOT CAUSE 4 (UNRESOLVED): on cold-cache CI runs, the seeded state.user is somehow erased mid-signin. The persisted blob ends with user=null AND ack=null, suggesting a full reset to initialState. Source unknown — none of the SIGNED_IN handlers, sync-defer dispatches, or migration paths touch user/ack. Retries with warm cache succeed reliably, indicating a timing race likely involving renameStorageNamespace, persist middleware writes, or supabase-js's INITIAL_SESSION."

## Resolution

root_cause: "Three confirmed root causes resolved. Fourth identified but unresolved.

  RC1 — Migration ordering bug (a8f6824):
    App.tsx SIGNED_IN handler runs setActiveStorageUserId + renameStorageNamespace BEFORE deferOnSignedIn → maybeStartMigration. The latter reads `localStorage.getItem('leanshot_v4')` but renameStorageNamespace already deleted it. Fresh-migration branch returns early → MigrationModal never shows. Fix: readV4Snapshot + snapshotPreCloudBackup fall back to active namespaced key.

  RC2 — Tour overlay blocks clicks (6e78c2a):
    App.tsx auto-launches GuidedTour 900ms after view='dashboard'. Its backdrop has pointer-events-auto and z-150. Seeded tests don't seed the leanshot_tour_seen_v4 flag, so every signin-from-seed triggers the tour. The backdrop intercepts every subsequent click. Fix: skip auto-launch when VITE_E2E='true' (CI only; Vercel production unaffected).

  RC3 — 'All done' modal masks nav (8800529):
    Post RC1 fix, migration state machine now actually runs on every seeded-signin. Completes near-instantly (empty entity arrays) and shows the 'All done' Modal with aria-modal='true'. The modal excludes everything outside the dialog from Playwright's accessibility-tree queries. Fix: seed migration_state.complete=true in 4 specs (cross-device-sync, offline-log-then-sync, offline-conflict-toast, photo-cross-device) so maybeStartMigration's already-complete short-circuit fires.

  RC4 — Cold-cache state.user reset (UNRESOLVED):
    On the FIRST browser.newContext() spawn per CI run, the seeded state.user appears to be reset to null mid-signin. The persisted blob ends with hasUser=false AND ack=null (a full state reset to initialState). None of the code paths in the SIGNED_IN handler, sync-defer dispatch, or migration flow touch user/ack — yet they end up null. Retries with warm cache succeed in <5s every time. Most plausible: a race involving renameStorageNamespace, persist.rehydrate, and supabase-js's INITIAL_SESSION timing on the cold-start of @supabase/supabase-js dyn-import."

fix: "Three fixes landed across commits a8f6824, 6e78c2a, 8800529. RC4 awaits a dedicated 07-02b investigation plan with Zustand-level state-mutation logging."

verification: "CI progression:
  - 25731926117 (HEAD before this work): 4 passed / 7 failed.
  - 25733196268 (diagnostic seam only): 4 passed / 7 failed. Captured first concrete viewLog evidence.
  - 25734224859 (RC1 fix): 5 passed / 6 failed. migrate-resume Test 1 advanced past migration-modal assertion.
  - 25735158043 (RC1 + RC2): 6 passed / 5 failed. migrate-resume Test 1 PASSED.
  - 25736044388 (RC1 + RC2 + RC3): 8 passed / 3 failed. photo-cross-device PASSED.

  Final state: 8/11 pass. Remaining 3 fails: cross-device-sync, offline-conflict-toast, offline-log-then-sync. All hit RC4 on cold-cache first-attempt; retries with warm cache succeed.

  Phase 7 entry condition (11/11) NOT MET. Recommend a follow-up plan."

files_changed:
  - leanshot/src/App.tsx (debug seam + tour skip in VITE_E2E)
  - leanshot/src/lib/migration.ts (readV4Snapshot/snapshotPreCloudBackup namespaced-key fallback)
  - leanshot/e2e/cross-device-sync.spec.ts (seed migration_state complete)
  - leanshot/e2e/offline-log-then-sync.spec.ts (seed migration_state complete)
  - leanshot/e2e/offline-conflict-toast.spec.ts (seed migration_state complete)
  - leanshot/e2e/photo-cross-device.spec.ts (seed migration_state complete)
  - leanshot/e2e/diagnostic-post-signin-view.spec.ts (NEW — investigation seam, can be removed when RC4 is closed)
  - leanshot/playwright.config.ts (html reporter so failure artifacts upload)
