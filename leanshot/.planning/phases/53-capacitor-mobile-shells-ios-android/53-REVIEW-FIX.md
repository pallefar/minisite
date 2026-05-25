---
phase: 53-capacitor-mobile-shells-ios-android
fixed_at: 2026-05-25T12:00:00Z
review_path: leanshot/.planning/phases/53-capacitor-mobile-shells-ios-android/53-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 53: Code Review Fix Report

**Fixed at:** 2026-05-25T12:00:00Z
**Source review:** leanshot/.planning/phases/53-capacitor-mobile-shells-ios-android/53-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (2 Critical, 4 Warning; Info findings excluded per fix_scope=critical_warning)
- Fixed: 6
- Skipped: 0

## Fixed Issues

### CR-01: sign-and-upload-ios missing web-asset build + cap sync

**Files modified:** `.github/workflows/mobile-ios.yml`
**Commit:** `d9ba45ba`
**Applied fix:** Added `actions/setup-node@v4` + `npm ci --legacy-peer-deps` + `npm run build` + `npx cap sync ios` steps to the `sign-and-upload-ios` job before the `ruby/setup-ruby` and fastlane steps. The job is now self-contained: fresh runner gets web assets built and synced to `apps/ios/App/App/public/` before `gym()` runs.

---

### WR-01: FASTLANE_USER and FASTLANE_TEAM_ID not mapped in sign-and-upload-ios env block

**Files modified:** `.github/workflows/mobile-ios.yml`
**Commit:** `d9ba45ba` (same atomic commit as CR-01)
**Applied fix:** Added `FASTLANE_USER: ${{ secrets.FASTLANE_USER }}` and `FASTLANE_TEAM_ID: ${{ secrets.FASTLANE_TEAM_ID }}` to the `sign-and-upload-ios` env block. Both are required by `match()` (team ID for certificate lookup) and `pilot()` (Apple ID for TestFlight upload).

---

### WR-02: cancel-in-progress: true can interrupt live TestFlight / Play Store uploads

**Files modified:** `.github/workflows/mobile-ios.yml`, `.github/workflows/mobile-android.yml`
**Commit:** `d9ba45ba` (iOS), `588e22b7` (Android)
**Applied fix:** Removed the workflow-level `concurrency` block from both workflows. Added job-level `concurrency` with `cancel-in-progress: true` scoped to `build-ios` and `build-android` jobs only. The `sign-and-upload-*` jobs have no concurrency key and will always run to completion.

---

### CR-02: sign-and-upload-android upload_play lane missing build + keystore decode

**Files modified:** `.github/workflows/mobile-android.yml`, `leanshot/fastlane/Fastfile`
**Commit:** `588e22b7`
**Applied fix (workflow):** Added `actions/setup-node@v4`, `actions/setup-java@v4` (temurin 17), `npm ci --legacy-peer-deps`, `npm run build`, `npx cap sync android`, and a keystore decode step (`echo "$KEYSTORE_BASE64" | base64 --decode > apps/android/app/leanshot-release.jks`) before the `ruby/setup-ruby` and fastlane steps. Keystore contents are never echoed.

**Applied fix (Fastfile):** Added `gradle()` call with `task: "bundle"`, `build_type: "Release"`, `project_dir: "apps/android/"`, and all four signing properties (`store.file`, `store.password`, `key.alias`, `key.password` from ENV) before the existing `supply()` call in the `upload_play` lane. The keystore file path uses `File.expand_path` relative to `apps/android/`.

---

### WR-04: android:allowBackup="true" exposes sensitive health data to ADB backup

**Files modified:** `leanshot/apps/android/app/src/main/AndroidManifest.xml`
**Commit:** `905fa3ee`
**Applied fix:** Changed `android:allowBackup="true"` to `android:allowBackup="false"` and added `android:fullBackupContent="false"` on the `<application>` element. All existing content preserved: LAUNCHER intent-filter, App Links intent-filter with `android:autoVerify="true"` and `android:host="app.leanshot.app"`, FileProvider, and INTERNET permission. XML parse and all three grep checks pass.

---

### WR-03: sha256_cert_fingerprints test passes trivially on placeholder string

**Files modified:** `leanshot/src/lib/native/deeplink-association.test.ts`
**Commit:** `505f7fa0`
**Applied fix:** Added a second assertion below the existing non-empty check. The new test validates that `sha256_cert_fingerprints[0]` is EITHER a string starting with `REPLACE_WITH_` (known Phase 70 placeholder, tolerated during defer window) OR a valid colon-delimited hex SHA-256 fingerprint matching `/^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/`. The existing non-empty array assertion is preserved. All 29 vitest-mobile tests pass with the current placeholder value. The TODO comment marks Phase 70 as the deadline to remove the placeholder branch.

---

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-05-25T12:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
