---
phase: 53-capacitor-mobile-shells-ios-android
plan: "02"
subsystem: testing
tags: [capacitor, revenuecat, deep-link, aasa, assetlinks, vitest, mobile, ios, android]

# Dependency graph
requires:
  - phase: 16-capacitor-native-shells
    provides: "Native dirs (apps/ios, apps/android), capacitor.config.ts, iap.ts RC bridge"
  - phase: 07-account-management
    provides: "DeleteAccountModal + SettingsPage delete-account affordance"
  - phase: 53-capacitor-mobile-shells-ios-android
    provides: "Phase 53 research + AASA/assetlinks.json well-known files (53-01)"
provides:
  - "VITE_RC_API_KEY_IOS + VITE_RC_API_KEY_ANDROID env stubs in .env.example (Phase-70-gated values)"
  - "TEAMID/SHA256 substitution runbook in apps/ios/marketing/"
  - "AASA + assetlinks.json validity + shape regression tests (MOBILE-05)"
  - "Cap config validity + native dir existence + plugin-presence regression tests (MOBILE-01, MOBILE-04)"
  - "SettingsPage account-deletion reachability test at 375px viewport (MOBILE-08)"
affects: [phase-53, phase-70, 53-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Worktree node_modules symlink: symlink leanshot/node_modules → main leanshot/node_modules when worktree node_modules dir is empty stubs"
    - "Mobile vitest: use ./node_modules/.bin/vitest run --config vitest-mobile.config.ts <file> for test invocation"
    - "SettingsPage test harness: mock @/lib/auth, @/lib/mfa/patient-mfa, @/lib/supabase, @/lib/export-data, react-i18next; seed store with permanent user; click Privacy nav to reach delete section"

key-files:
  created:
    - leanshot/.env.example (modified — appended RC section)
    - leanshot/apps/ios/marketing/deeplink-id-substitution-runbook.md
    - leanshot/src/lib/native/deeplink-association.test.ts
    - leanshot/src/lib/native/settings-delete-reachability.test.tsx
  modified:
    - leanshot/.env.example

key-decisions:
  - "RC client-SDK keys (VITE_RC_API_KEY_IOS/ANDROID) declared as empty stubs; Phase-70-gated per iap.ts threat model T-53-04 (public SDK keys, VITE_-prefix correct)"
  - "Webhook secrets (REVENUECAT_WEBHOOK_SECRET/AUTH) explicitly NOT added here; server-only Function Secrets owned by 53-04"
  - "AASA TEAMID + assetlinks SHA256 stubs retained as intentional Phase-70-gated placeholders; runbook documents the exact swap procedure"
  - "settings-delete-reachability.test.tsx placed under src/lib/native/ (auto-discovered by vitest-mobile include globs) not src/test/"
  - "requireStepUp mocked to return ok=true so modal opens immediately in test; this is correct per the plan's behavior spec (modal reachability, not step-up UX)"

patterns-established:
  - "RC env stubs pattern: VITE_-prefixed public SDK keys + comment block referencing iap.ts, Phase 70 gating, and pointer to server-only secrets runbook"
  - "Worktree symlink pattern: rm empty node_modules dir, ln -s main node_modules; never commit the symlink"

requirements-completed: [MOBILE-01, MOBILE-04, MOBILE-05, MOBILE-08]

# Metrics
duration: 5min
completed: 2026-05-25
---

# Phase 53 Plan 02: RC Env Stubs + Deep-Link Validity + Mobile Delete Reachability Summary

**RC client-SDK env stubs declared, AASA/assetlinks.json proven valid + shaped, and SettingsPage account-deletion proven reachable at 375px — all via Vitest without a native build**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-25T09:40:00Z
- **Completed:** 2026-05-25T09:44:55Z
- **Tasks:** 3/3
- **Files modified:** 4

## Accomplishments

- Appended `VITE_RC_API_KEY_IOS` + `VITE_RC_API_KEY_ANDROID` stubs to `.env.example` with full comment block (Phase-70-gated, public SDK keys, pointer to server-only 53-04 runbook — no VITE_-prefixed webhook secret)
- Created `deeplink-id-substitution-runbook.md` documenting TEAMID + SHA256 Phase-70 swap procedures with exact file paths, occurrence counts, vendor dashboard locations, and deployment notes
- Wrote `deeplink-association.test.ts` (23 tests): AASA valid JSON + appID shape + required paths + webcredentials; assetlinks valid JSON + package_name + relation + sha256 array; native dirs exist; cap config validity; all 6 MOBILE-04 plugins present
- Wrote `settings-delete-reachability.test.tsx` (5 tests): SettingsPage renders "Delete account" heading + button at 375px; button not hidden; clicking opens DeleteAccountModal (requireStepUp mocked ok=true); role=dialog reachable; configureRC web no-op doesn't block render

## Task Commits

1. **Task 1: RC client-SDK env stubs + runbook** - `14172021` (chore)
2. **Task 2: Deep-link association validity tests** - `0b272787` (test)
3. **Task 3: Account-deletion mobile-viewport reachability test** - `9181215d` (test)

## Files Created/Modified

- `leanshot/.env.example` — Appended Phase 53 RC client-SDK key stubs section (VITE_RC_API_KEY_IOS, VITE_RC_API_KEY_ANDROID; no webhook secrets)
- `leanshot/apps/ios/marketing/deeplink-id-substitution-runbook.md` — Phase-70-gated TEAMID + SHA256 swap runbook
- `leanshot/src/lib/native/deeplink-association.test.ts` — AASA + assetlinks validity + cap config + plugin presence (MOBILE-01, MOBILE-04, MOBILE-05)
- `leanshot/src/lib/native/settings-delete-reachability.test.tsx` — SettingsPage delete-account reachability at 375px (MOBILE-08)

## Decisions Made

- **VITE_-prefix for RC keys is correct** per iap.ts threat model T-53-04: RevenueCat public SDK keys are designed to be embedded in the client bundle. Webhook secrets are explicitly excluded.
- **Test harness for SettingsPage** requires mocking 6 dependencies: `@/lib/auth`, `@/lib/mfa/patient-mfa`, `@/lib/supabase`, `@/lib/export-data`, `react-i18next`, `@/lib/account-delete`. The store must be seeded with `is_anonymous: undefined` (falsy) for `isPermanent=true`.
- **requireStepUp mocked ok=true** in the reachability test — the test proves the modal is reachable from the Privacy section, not that step-up UX works (step-up is covered by HIPAA-15 tests elsewhere).

## Deviations from Plan

None — plan executed exactly as written.

**Node_modules worktree symlink note (operational, not a deviation):** The worktree's `leanshot/node_modules/` directory existed as a stub (only `.vite` cache) which blocked Vite from resolving `react/jsx-dev-runtime`. Fixed by removing the stub dir and symlinking to `leanshot/node_modules` from the main checkout. The symlink was NOT committed (gitignored by root `.gitignore: leanshot/node_modules/`).

## Known Stubs

The following stubs are intentional and Phase-70-gated per the plan and threat model:

| Stub | File | Reason |
|------|------|--------|
| `VITE_RC_API_KEY_IOS=` (empty) | `leanshot/.env.example` | RC dashboard + app provisioning deferred to Phase 70 |
| `VITE_RC_API_KEY_ANDROID=` (empty) | `leanshot/.env.example` | RC dashboard + app provisioning deferred to Phase 70 |
| `TEAMID.app.leanshot.ios` | `leanshot/public/.well-known/apple-app-site-association` | Apple Team ID obtained at Phase 70 Apple enrollment |
| `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_AT_PLAN_16_09` | `leanshot/public/.well-known/assetlinks.json` | Play App Signing SHA256 obtained at Phase 70 Play Console |

These stubs do NOT prevent the plan's goal — the goal is "config valid + files present + reachable", all verified by Vitest. Device-level deep-link resolution requires the real IDs but is explicitly deferred to Phase 70.

## Issues Encountered

**Worktree empty node_modules:** When running `npx vitest run` from the worktree's leanshot dir, Vite found the empty `node_modules/` stub (containing only `.vite` cache) and stopped walking up the directory tree — `react/jsx-dev-runtime` was not found. Resolution: removed the stub directory and created a symlink to the main checkout's `node_modules`. This is a known pattern for worktree-based parallel execution.

## Next Phase Readiness

- 53-04 can proceed: RC webhook secret + canonical subscriptions mirror (MOBILE-06 server half) — the client-SDK keys for the RC bridge are declared in `.env.example`
- Phase 70: The TEAMID + SHA256 runbook is in place; exact file paths and vendor dashboard locations are documented
- All MOBILE-01, MOBILE-04, MOBILE-05, MOBILE-08 test assertions are committed as regression guards

---
*Phase: 53-capacitor-mobile-shells-ios-android*
*Completed: 2026-05-25*

## Self-Check: PASSED

Files confirmed:
- `leanshot/.env.example` contains `VITE_RC_API_KEY_IOS` and `VITE_RC_API_KEY_ANDROID`
- `leanshot/apps/ios/marketing/deeplink-id-substitution-runbook.md` exists
- `leanshot/src/lib/native/deeplink-association.test.ts` exists, 23 tests pass
- `leanshot/src/lib/native/settings-delete-reachability.test.tsx` exists, 5 tests pass

Commits confirmed:
- `14172021` — chore(53-02): RC client-SDK env stubs + TEAMID/SHA256 substitution runbook
- `0b272787` — test(53-02): deep-link association validity + cap config + plugin presence tests
- `9181215d` — test(53-02): account-deletion mobile-viewport reachability test (MOBILE-08)
