---
status: investigating
trigger: "3/11 e2e specs (cross-device-sync, offline-conflict-toast, offline-log-then-sync) fail on cold-cache first browser.newContext() runs. Seeded state.user + acknowledgedDisclaimer wiped to null mid-signin. Retries on warm cache pass <5s every time."
created: 2026-05-12T14:18:34Z
updated: 2026-05-12T14:18:34Z
---

## Current Focus

hypothesis: "On cold-cache first context, the seeded state ends up wiped (hasUser=false AND ack=null in the persisted blob, matching initialState exactly). The wipe must come from a `set()` call that REPLACES state — most likely a stale-snapshot rehydrate from the EMPTY namespaced storage. Suspected sequence: (a) seed writes universal `leanshot_v4`; (b) reload + hydrate reads universal → state OK; (c) sign in → handler calls `await setActiveStorageUserId(userId)` setting `activeNamespaceKey` to a namespaced key whose localStorage entry is EMPTY; (d) `await renameStorageNamespace(userId)` THEN runs, copying universal blob to namespaced and deleting universal; (e) BUT if any `set()` fires between (c) and (d), or if `useStore.persist.rehydrate()` is re-invoked while pointed at the empty key, state gets reset to initialState; (f) the supabase-js INITIAL_SESSION + SIGNED_IN double-fire pattern (cold start typically fires INITIAL_SESSION with the cached session first, then SIGNED_IN moments later) means the storage-routing dance runs TWICE — second run sees namespaced key with the partialized state and skips the rename, but if the persist write between SET_ACTIVE and RENAME races a recompute, the wipe lands."
test: "Add a state-mutation seam in store.ts that records every set() that mutates user or acknowledgedDisclaimer, then update cross-device-sync.spec.ts to dump __leanshot_state_log__ on first failure. Push, watch CI run, identify offending set() caller from stack trace."
expecting: "State log entries showing a transition `user: set → null, ack: v1 → null` with a stack pointing to the offending code path. Most likely candidates: (1) persist middleware rehydrate from empty namespaced key, (2) a sync-defer'd dispatch arriving late, (3) clearUserDataSlices misfiring."
next_action: "Add seam to src/lib/store.ts (after the useStore.setState assignment around line 1950, gated by VITE_E2E === 'true'). Update e2e/cross-device-sync.spec.ts to dump __leanshot_state_log__ on failure. Commit + push."

## Symptoms

expected: "Cold-cache first browser.newContext() signin lands on dashboard with seeded user + ack intact."
actual: "viewLog shows hash going #/auth/signin → '' (empty) with user=false throughout. Persisted blob ends as { version: 8, hasUser: false, ack: null } — a full reset to initialState. Retries on warm cache succeed in <5s."
errors: "expect(getByRole('navigation') | getByText | getByTestId).toBeVisible() times out at 12-30s. Final view: 'marketing'. bodyText: marketing page."
reproduction: "Push commit; observe CI e2e-smoke job — cross-device-sync, offline-conflict-toast, offline-log-then-sync fail on attempt 1, succeed on retry."
started: "After 8800529 (RC1-RC3 fixes). RC4 unmasked because earlier failures (migration modal, tour, namespaced-key bug) were hiding it."

## Eliminated

- hypothesis: "mergeServerSettings clobbers state.user with empty server row"
  evidence: "pullInitialSettings is in pullAndSubscribeAll (sync.ts:765-813) but NOT called from the deferOnSignedIn drain (sync-defer.ts:75-103). The drain only does pullInitialInjections + pullInitialPhotos + flushSyncQueue + maybeStartMigration. No settings pull → no mergeServerSettings call."
  timestamp: 2026-05-12T14:20:00Z

- hypothesis: "Migration state machine overwrites state on cold start"
  evidence: "Failing specs seed migration_state.complete=true → maybeStartMigration hits branch (4) 'already complete' and early-exits without touching state. RC3 fix (8800529) confirmed this — photo-cross-device PASSES with the same seed pattern."
  timestamp: 2026-05-12T14:20:00Z

- hypothesis: "auth-migration.runAnonPromotionMigrationIfNeeded wipes state"
  evidence: "auth-migration.ts:39-46 only fires when lastWasAnon is true. Cold context has lastWasAnon=false (fresh sessionStorage). Only side-effect is a showToast call — no user/ack mutation."
  timestamp: 2026-05-12T14:20:00Z

## Evidence

- timestamp: 2026-05-12T14:18:34Z
  checked: "CI run 25736044388 diagnostic dump (from prior debug session)"
  found: "viewLog: 3 entries ALL user=false. lsBlob[leanshot_v4:ef356e0cac6ab2e3]={version:8, hasUser:false, ack:null}. Hash went #/auth/signin → '' (empty)."
  implication: "State was wiped to initialState shape. Hash going to '' means either history.replaceState(null,'',pathname) ran OR window.location.hash was empty all along (e.g. supabase-js fragment parse stripped it)."

- timestamp: 2026-05-12T14:20:00Z
  checked: "src/lib/storage.ts:188-212 renameStorageNamespace + src/App.tsx:206-242 SIGNED_IN handler ordering"
  found: "SIGNED_IN runs `await setActiveStorageUserId(session.user.id)` then `await renameStorageNamespace(session.user.id)`. Between these two awaits, the persist adapter is pointed at the EMPTY namespaced key. Any `set()` call (including `setSession`) during this window writes the partialized state to the EMPTY namespaced key (persist serializes the FULL current state, not a delta), so user+ack are PRESERVED in that write — not the wipe culprit."
  implication: "The persist adapter routing during the await window is not by itself the cause; need to instrument actual mutations to identify the offending caller."

- timestamp: 2026-05-12T14:20:00Z
  checked: "src/App.tsx:206-228 INITIAL_SESSION handler"
  found: "INITIAL_SESSION fires on EVERY page load. For cold context navigating to /#/auth/signin with no prior session, INITIAL_SESSION fires with session=null → setSession(null) runs → set({signedIn: null}). No user/ack touch. After password sign-in, SIGNED_IN fires — same async dance with setActiveStorageUserId + renameStorageNamespace + deferOnSignedIn."
  implication: "Double-fire pattern (INITIAL_SESSION + SIGNED_IN) doubles the storage-namespace shuffle. If there's any ordering bug it'll show in the second pass."

## Resolution

root_cause: ""
fix: ""
verification: ""
files_changed: []
