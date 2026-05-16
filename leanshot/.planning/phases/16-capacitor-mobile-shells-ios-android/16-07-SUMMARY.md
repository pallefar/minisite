---
phase: 16-capacitor-mobile-shells-ios-android
plan: 07
subsystem: mobile / privacy / store-submission
tags: [ios, android, privacy-manifest, data-safety, ci-gate, mobile-05, d-18]
status: complete
dependency_graph:
  requires: [16-01, 16-02, 16-04]
  provides:
    - apps/ios/App/App/PrivacyInfo.xcprivacy
    - apps/ios/App/App/App.entitlements
    - apps/android/data-safety.md
    - scripts/audit-privacy-manifest.mjs (REAL — replaces Wave-0 stub)
    - .github/workflows/mobile-privacy-audit.yml
  affects:
    - 16-09 (mobile.yml NOT touched; coordination honored)
    - 16-10 (launch checklist needs branch-protection toggle + Play Console copy-paste)
    - 18 (NSHealthShareUsageDescription STUB to fill with real HealthKit read scope)
tech-stack:
  added:
    - "Apple PrivacyInfo.xcprivacy plist XML schema (Apple iOS 17+ requirement)"
    - "Google Play Data Safety form spec (operator copy-paste, regression-checked vs iOS)"
  patterns:
    - "Zero-npm-dependency CI-gate script (security-critical asset; hand-rolled plist regex extractor)"
    - "Source-of-truth cross-reference table — Play row ↔ iOS NSPrivacyCollectedDataType key (regression contract)"
    - "Dedicated workflow per concern (mobile-privacy-audit.yml separate from mobile.yml owned by 16-09; avoids parallel-wave add/add conflict)"
key-files:
  created:
    - apps/ios/App/App/PrivacyInfo.xcprivacy
    - apps/ios/App/App/App.entitlements
    - apps/android/data-safety.md
    - scripts/audit-privacy-manifest.test.mjs
    - .github/workflows/mobile-privacy-audit.yml
  modified:
    - apps/ios/App/App/Info.plist (added 5 usage strings + LSApplicationQueriesSchemes)
    - apps/ios/App/App.xcodeproj/project.pbxproj (CODE_SIGN_ENTITLEMENTS wired Debug+Release)
    - scripts/audit-privacy-manifest.mjs (replaced Wave-0 stub with real diff logic)
    - package.json (added 3 audit:privacy* scripts)
decisions:
  - "Hand-craft PrivacyInfo (no plugin auto-emit). Each plugin's privacy declarations are aggregated by hand because Capacitor 8 does not auto-merge per-plugin xcprivacy contributions yet (D-18)."
  - "HealthKit declared Linked=false (D-18 explicit) — on both iOS and Play Data Safety. Mirrors the medical-privacy posture from Phase 7."
  - "Zero npm deps in audit script. Pulled-in plist/XML parser would add supply-chain surface for a CI gate that only needs ~10 keys; hand-rolled regex extractor is auditable in <300 LOC."
  - "Dedicated mobile-privacy-audit.yml workflow file (NOT folded into mobile.yml owned by 16-09). Parallel-wave file-ownership rule. Smaller footprint = easier required-status enforcement in branch protection."
  - "--strict flag exits 1 on warnings (for fastlane lanes); default mode exits 0 on warnings-only (informational)."
  - "App.entitlements declares BOTH applinks:leanshot.app + applinks:app.leanshot.app (D-09 max-coverage; matches the user's invest-on-end-user-audience pattern for marketing-to-app deeplinks)."
metrics:
  duration: "~45 min wall clock"
  completed: "2026-05-16"
  tasks_complete: 3
  files_created: 5
  files_modified: 4
  commits: 4
requirements: [MOBILE-05]
---

# Phase 16 Plan 16-07: Privacy Manifest + Data Safety Audit Summary

**One-liner:** Hand-crafted Apple PrivacyInfo.xcprivacy + Google Play Data Safety spec + zero-dep CI gate that diffs declared vs canonical-Apple reason codes intersected with installed-plugin inventory.

## What shipped

| Path | Type | Notes |
|---|---|---|
| `apps/ios/App/App/PrivacyInfo.xcprivacy` | NEW | 4 required-reason API categories, 6 collected-data types, NSPrivacyTracking=false |
| `apps/ios/App/App/Info.plist` | MOD | +NSFaceID, NSHealthShare (STUB), NSPhotoLibrary{,Add}, NSCamera, LSApplicationQueriesSchemes |
| `apps/ios/App/App/App.entitlements` | NEW | associated-domains (2 hosts) + keychain-access-groups |
| `apps/ios/App/App.xcodeproj/project.pbxproj` | MOD | CODE_SIGN_ENTITLEMENTS=App/App.entitlements (Debug + Release) |
| `apps/android/data-safety.md` | NEW | 148 lines, 9 sections, Play-Console-copy-paste-ready |
| `scripts/audit-privacy-manifest.mjs` | MOD (real impl) | Replaces Wave-0 stub; zero npm deps; CLI flags + --strict |
| `scripts/audit-privacy-manifest.test.mjs` | NEW | 8 self-tests via `node --test` |
| `package.json` | MOD | +`audit:privacy`, `audit:privacy:test`, `audit:privacy:strict` |
| `.github/workflows/mobile-privacy-audit.yml` | NEW | Dedicated workflow (NOT mobile.yml owned by 16-09) |

## Commits

| Hash | Type | Description |
|---|---|---|
| `b1f1aa4` | feat | Task 1 — PrivacyInfo.xcprivacy + Info.plist + App.entitlements + pbxproj wiring |
| `3502615` | test | Task 2 RED — 8 self-tests against stub audit script (7/8 fail expected) |
| `a969ef2` | feat | Task 2 GREEN — real audit script with diff logic + D-18 invariants (all 8 tests pass) |
| `ec0c0c0` | feat | Task 3 — Play Data Safety spec + dedicated CI workflow |

## Required-reason API categories declared

| Category | Reason code | Driven by (installed plugins) |
|---|---|---|
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` | `@capacitor/preferences`, `@revenuecat/purchases-capacitor`, `@sentry/capacitor` |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `C617.1` | `@capacitor/filesystem` |
| `NSPrivacyAccessedAPICategorySystemBootTime` | `35F9.1` | `@capacitor/core`, `@sentry/capacitor` |
| `NSPrivacyAccessedAPICategoryDiskSpace` | `E174.1` | `@capacitor/filesystem`, `@sentry/capacitor` |

Live audit result: `audit-privacy-manifest: PASS — 4 required-reason categories declared, 4 required by installed plugins, 0 warnings` (matches under `--strict` too).

## Collected-data types declared (Linked/Tracking matrix)

| iOS data type | Linked | Tracking | Purposes |
|---|---|---|---|
| `NSPrivacyCollectedDataTypeEmailAddress` | **YES** | NO | AppFunctionality, AccountManagement |
| `NSPrivacyCollectedDataTypeUserID` | **YES** | NO | AppFunctionality, AccountManagement |
| `NSPrivacyCollectedDataTypeHealth` | **NO** (D-18) | NO | AppFunctionality, Analytics |
| `NSPrivacyCollectedDataTypePhotosorVideos` | **YES** | NO | AppFunctionality |
| `NSPrivacyCollectedDataTypeCrashData` | **NO** | NO | AppFunctionality, Analytics |
| `NSPrivacyCollectedDataTypePurchaseHistory` | **YES** | NO | AppFunctionality |

**D-18 critical line:** HealthKit explicitly `NSPrivacyCollectedDataTypeLinked=<false/>` — health info is stored under an opaque per-device key not directly joinable to email/profile on the analytics path. CI audit script enforces this on every PR (`Test 6` in `audit-privacy-manifest.test.mjs`).

## Coordination with sibling 16-09

`mobile.yml` is owned by Plan 16-09 (also Wave 3). This plan creates a SEPARATE file `mobile-privacy-audit.yml` so the parallel-wave execution has zero add/add conflict risk. Verified: `mobile.yml` does NOT exist in this worktree's history.

## Verification snapshot

```
=== plutil lint === PrivacyInfo / Info.plist / App.entitlements: all OK
=== audit:privacy:test === 8 tests pass / 0 fail
=== audit:privacy === PASS — 4 declared, 4 required, 0 warnings
=== audit:privacy:strict === PASS — 4 declared, 4 required, 0 warnings
=== data-safety mirror === OK (cross-ref table + NSPrivacy* references present)
=== workflow === OK (audit:privacy:strict invocation present)
=== D-18 HealthKit Linked=false === PASS
=== mobile.yml NOT touched === OK
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] runScript() helper in audit-privacy-manifest.test.mjs only captured stderr on non-zero exits**

- **Found during:** Task 2 GREEN test run (Test 3 failed — assertion checked for `::warning::` in combined stdout+stderr but stderr was empty)
- **Issue:** `execFileSync` returns just stdout on success; stderr only populated in the catch branch via `e.stderr`. Test 3 (warning-only case exits 0) hit the try-branch and lost the stderr emission containing `::warning::`.
- **Fix:** Swapped helper to `spawnSync` which always returns both streams regardless of exit code.
- **Files modified:** `leanshot/scripts/audit-privacy-manifest.test.mjs`
- **Commit:** `a969ef2` (same commit as the GREEN script)

### Other notes

- **Worktree-base recovery during Task 1.** Initial Write/Edit calls used absolute paths under `/Users/karstenhaldan/minisite/leanshot/...` (the MAIN repo, not the worktree). Caught by the per-commit branch-protection check on the first commit attempt. Recovery: `cp` modified files from main → worktree, `git checkout -- <leaked>` on main to restore, `rm -f <stray>` for new files, then committed cleanly from the worktree via `git -C <worktree>`. No commit landed on main. This is the documented absolute-path drift trap from `[[reference-worktree-base-drift-recovery]]`. Lesson reinforced: always derive absolute paths from the worktree root, not from a `pwd` captured earlier in the orchestrator context.

### Auth gates

None. Fully autonomous.

## Open items for 16-10 launch checklist

1. **Operator copies `data-safety.md` into Play Console.** Walk through the form wizard following §8 of the doc; export submission PDF and attach to the change-log row.
2. **Operator enables `Mobile Privacy Manifest Audit` workflow as a required-status check** in GitHub branch protection on `main`. Without this, the audit can be bypassed by merging a PR that doesn't touch the path filters.
3. **Phase 18 fills `NSHealthShareUsageDescription` STUB** with the actual HealthKit read scope text (current value: `"STUB — Phase 18 fills with the actual HealthKit read scope. Required string is present so Xcode validates."`).
4. **Refresh canonical reason-code list** in `audit-privacy-manifest.mjs` when Apple updates the PrivacyInfo schema. No automated refresh; check on each Apple privacy-manifest schema bump.

## Threat Flags

None. All new surface stays within the plan's `<threat_model>` register (T-16-07-01 through T-16-07-07 mitigated as designed). The only nuance: T-16-07-04 (workflow disabled via path-filter removal) requires the operator branch-protection action listed above to fully mitigate — flagged in the 16-10 launch checklist.

## Self-Check: PASSED

- `apps/ios/App/App/PrivacyInfo.xcprivacy` — FOUND
- `apps/ios/App/App/App.entitlements` — FOUND
- `apps/android/data-safety.md` — FOUND (148 lines)
- `scripts/audit-privacy-manifest.test.mjs` — FOUND
- `.github/workflows/mobile-privacy-audit.yml` — FOUND
- Commit `b1f1aa4` (Task 1) — FOUND
- Commit `3502615` (Task 2 RED) — FOUND
- Commit `a969ef2` (Task 2 GREEN) — FOUND
- Commit `ec0c0c0` (Task 3) — FOUND
- `npm run audit:privacy:test` — 8/8 pass
- `npm run audit:privacy:strict` — PASS
- D-18 HealthKit `Linked=<false/>` — PASS
- `mobile.yml` NOT created (16-09 coordination) — VERIFIED
