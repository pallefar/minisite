---
phase: 53-capacitor-mobile-shells-ios-android
reviewed: 2026-05-25T10:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - .github/workflows/mobile-ios.yml
  - .github/workflows/mobile-android.yml
  - leanshot/apps/android/app/src/main/AndroidManifest.xml
  - leanshot/fastlane/Fastfile
  - leanshot/fastlane/Appfile
  - leanshot/fastlane/Matchfile
  - leanshot/fastlane/Gemfile
  - leanshot/fastlane/README.md
  - leanshot/src/lib/native/deeplink-association.test.ts
  - leanshot/src/lib/native/settings-delete-reachability.test.tsx
  - leanshot/.env.example
  - supabase/functions/revenuecat-webhook/SECRETS-RUNBOOK.md
findings:
  critical: 2
  warning: 4
  info: 2
  total: 8
status: issues_found
---

# Phase 53: Code Review Report

**Reviewed:** 2026-05-25T10:00:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 53 ships CI workflows for iOS and Android mobile builds, AndroidManifest App Links, fastlane lanes, RevenueCat env stubs, and native-bridge tests. The gating model (unsigned build always-green, upload gated on secrets presence) is correctly structured. No hardcoded credentials were found. Secret values are not echoed or printed in any workflow step.

Two critical blockers exist in the sign-and-upload jobs: (1) the iOS sign-and-upload job omits the web-asset build + Capacitor sync steps that `gym()` requires, meaning the lane will fail the first time Apple secrets are provisioned; (2) the Android upload_play lane omits a build step and a keystore decode/signing step — it calls `supply()` against an AAB that does not exist on the fresh upload runner, and the KEYSTORE_BASE64 secret is mapped into env but never decoded. Both blockers are deferred to Phase 70 execution but will block that phase unless fixed now.

Four warnings cover: missing env mapping for required Apple ID secrets, a cancel-in-progress concurrency setting that can interrupt live uploads, a trivially-passing sha256 fingerprint test, and the `android:allowBackup="true"` attribute exposing sensitive health data to ADB backup.

## Critical Issues

### CR-01: sign-and-upload-ios missing web-asset build + cap sync — gym() will fail

**File:** `.github/workflows/mobile-ios.yml:82-96`

**Issue:** The `sign-and-upload-ios` job (lines 82–96) runs on a fresh `macos-latest` runner and contains only: `checkout`, `setup-ruby`, `fastlane run setup_ci`, and `bundle exec fastlane upload_testflight`. The `upload_testflight` lane calls `gym()` which invokes `xcodebuild archive` — but `apps/ios/App/App/public/` (the web-assets dir populated by `npx cap sync ios`) does not exist on the new runner because no `npm ci`, `npm run build`, or `npx cap sync ios` step runs. The Xcode build will fail with a missing web assets bundle error the first time Apple secrets are provisioned. The `build-ios` job that precedes it runs on a separate runner; its build artifacts are not uploaded and thus are not available to this job.

**Fix:** Add the web-asset pipeline to the `sign-and-upload-ios` job before invoking fastlane, and install Node + npm:

```yaml
  sign-and-upload-ios:
    needs: build-ios
    runs-on: macos-latest
    env:
      APPLE_CERTIFICATE_BASE64: ${{ secrets.APPLE_CERTIFICATE_BASE64 }}
      FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD: ${{ secrets.FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD }}
      MATCH_GIT_BASIC_AUTHORIZATION: ${{ secrets.MATCH_GIT_BASIC_AUTHORIZATION }}
      MATCH_PASSWORD: ${{ secrets.MATCH_PASSWORD }}
      FASTLANE_USER: ${{ secrets.FASTLANE_USER }}
      FASTLANE_TEAM_ID: ${{ secrets.FASTLANE_TEAM_ID }}
    if: env.APPLE_CERTIFICATE_BASE64 != '' && env.FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD != ''
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: leanshot/package-lock.json

      - name: Install dependencies
        working-directory: leanshot
        run: npm ci --legacy-peer-deps

      - name: Build web assets
        working-directory: leanshot
        run: npm run build

      - name: Sync Capacitor iOS
        working-directory: leanshot
        run: npx cap sync ios

      - uses: ruby/setup-ruby@v1
        with:
          bundler-cache: true
          working-directory: leanshot

      - name: Set up Fastlane CI environment
        working-directory: leanshot
        run: bundle exec fastlane run setup_ci

      - name: Upload to TestFlight
        working-directory: leanshot
        run: bundle exec fastlane upload_testflight
```

---

### CR-02: sign-and-upload-android upload_play lane missing build + keystore decode — supply() has no AAB to upload

**File:** `.github/workflows/mobile-android.yml:84-94` and `leanshot/fastlane/Fastfile:85-93`

**Issue:** The `sign-and-upload-android` job runs on a fresh `ubuntu-latest` runner. It maps `KEYSTORE_BASE64` into env but never decodes it to a `.jks` file. The `upload_play` Fastfile lane calls only `supply(track: "internal", json_key_data: ENV["PLAY_SERVICE_ACCOUNT_JSON"])` — no `gradle()` build step, no keystore decode, no signing. `supply()` without an explicit `aab:` or `apk:` parameter looks for the AAB at the gradle output path (`apps/android/app/build/outputs/bundle/release/app-release.aab`), which does not exist on a fresh runner. The README describes the keystore as "decoded at CI build time" but no decode step exists in either the workflow or the Fastfile. The lane will fail immediately on Phase 70 activation.

**Fix — CI workflow:** Add keystore decode + build steps before fastlane upload:

```yaml
      - name: Decode keystore
        working-directory: leanshot
        run: |
          echo "$KEYSTORE_BASE64" | base64 --decode > apps/android/app/leanshot-release.jks

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: leanshot/package-lock.json

      - name: Install dependencies
        working-directory: leanshot
        run: npm ci --legacy-peer-deps

      - name: Build web assets
        working-directory: leanshot
        run: npm run build

      - name: Sync Capacitor Android
        working-directory: leanshot
        run: npx cap sync android

      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
```

**Fix — Fastfile `upload_play` lane:** Add signing build before supply:

```ruby
lane :upload_play do
  gradle(
    task: "bundle",
    build_type: "Release",
    project_dir: "apps/android/",
    properties: {
      "android.injected.signing.store.file"     => File.expand_path("app/leanshot-release.jks", "apps/android"),
      "android.injected.signing.store.password" => ENV["KEYSTORE_PASSWORD"],
      "android.injected.signing.key.alias"      => ENV["KEY_ALIAS"],
      "android.injected.signing.key.password"   => ENV["KEY_PASSWORD"],
    }
  )
  supply(
    track: "internal",
    json_key_data: ENV["PLAY_SERVICE_ACCOUNT_JSON"]
  )
end
```

---

## Warnings

### WR-01: FASTLANE_USER and FASTLANE_TEAM_ID not mapped in sign-and-upload-ios env block

**File:** `.github/workflows/mobile-ios.yml:75-80`

**Issue:** The Fastfile `upload_testflight` lane comment (line 42) lists `FASTLANE_USER` and `FASTLANE_TEAM_ID` as required secrets. The `Appfile` (lines 15–16) notes that fastlane reads these from `ENV["FASTLANE_USER"]` / `ENV["FASTLANE_TEAM_ID"]` by convention. GitHub Actions does NOT inject secrets into `ENV` unless they are explicitly mapped in the job's `env:` block. The `sign-and-upload-ios` job maps 4 secrets (lines 76–79) but omits both `FASTLANE_USER` and `FASTLANE_TEAM_ID`. The `match()` call for certificate lookup and the `pilot()` call for TestFlight will fail without a valid Apple ID and team ID.

**Fix:** Add the missing mappings to the `sign-and-upload-ios` env block (shown in CR-01 fix above):

```yaml
    env:
      # ... existing secrets ...
      FASTLANE_USER: ${{ secrets.FASTLANE_USER }}
      FASTLANE_TEAM_ID: ${{ secrets.FASTLANE_TEAM_ID }}
```

---

### WR-02: cancel-in-progress: true can interrupt live TestFlight / Play Store uploads

**File:** `.github/workflows/mobile-ios.yml:25-27` and `.github/workflows/mobile-android.yml:25-27`

**Issue:** Both workflows set `concurrency.cancel-in-progress: true` at the workflow level with a single group per branch. A subsequent push to `main` while a `sign-and-upload-*` job is actively uploading to TestFlight or the Play Store will cancel the entire workflow run, including the in-flight upload job. This can leave a partially uploaded binary in a bad state on the App Store Connect / Play Console side. The `build-*` jobs can safely be cancelled; the upload jobs cannot.

**Fix:** Apply the concurrency group only to the build job (using job-level concurrency), and give the upload jobs a separate non-cancellable group or omit cancellation for them:

```yaml
# At the workflow level: remove the global concurrency block.
# Add job-level concurrency to build-ios only:
  build-ios:
    concurrency:
      group: mobile-ios-build-${{ github.ref }}
      cancel-in-progress: true

# sign-and-upload-ios: no concurrency key (allow it to always complete)
```

---

### WR-03: sha256_cert_fingerprints test passes trivially on placeholder string — no format validation

**File:** `leanshot/src/lib/native/deeplink-association.test.ts:146-149`

**Issue:** The test asserts `fps.length > 0` against `assetlinks.json`. The actual value committed is `["REPLACE_WITH_PLAY_APP_SIGNING_SHA256_AT_PLAN_16_09"]` — a single string element. The assertion passes trivially on this placeholder. It will also pass after Phase 70 substitution only if the real SHA-256 fingerprint is present. However, it will silently pass even if the placeholder is never replaced, providing no regression signal. Additionally, the AASA equivalent (`appID` prefix check at line 81–85) also accepts `"TEAMID"` literally, so both association files are tested in a structurally-valid-but-semantically-meaningless state.

**Fix:** Add a format assertion that rejects the placeholder and validates the expected colon-separated hex format (deferred to Phase 70 substitution, guarded by a skip condition while placeholder is in place):

```typescript
it('[0].target.sha256_cert_fingerprints[0] matches SHA-256 colon-hex format or is a known placeholder', () => {
  const fp = assetlinks[0]?.target.sha256_cert_fingerprints[0] ?? '';
  const isPlaceholder = fp.startsWith('REPLACE_WITH_');
  const isSHA256ColonHex = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(fp);
  // At Phase 70: remove the isPlaceholder branch. This assertion must be a real fingerprint.
  expect(isPlaceholder || isSHA256ColonHex).toBe(true);
});
```

---

### WR-04: android:allowBackup="true" exposes sensitive health data to ADB backup

**File:** `leanshot/apps/android/app/src/main/AndroidManifest.xml:5`

**Issue:** `android:allowBackup="true"` is set in the `<application>` element. This is the Capacitor-generated default. For a GLP-1 health tracking app that stores injections, body metrics, mood, symptoms, and medications in local storage (Zustand persist → localStorage), enabling ADB backup means a developer with physical USB access to an unlocked device can extract a full copy of the user's health data via `adb backup`. This is a meaningful risk for a health-data application even before HIPAA coverage applies.

**Fix:** Disable ADB backup while preserving Android Auto-Backup (cloud backup, which is still useful):

```xml
<application
    android:allowBackup="false"
    android:dataExtractionRules="@xml/data_extraction_rules"
    android:fullBackupContent="false"
    ...>
```

Or if cloud sync (Auto Backup) is desired, set `android:allowBackup="true"` but add a `backup_rules.xml` that excludes the WebView localStorage directory to prevent health data from being included in Auto Backup:

```xml
<!-- res/xml/backup_rules.xml -->
<full-backup-content>
  <exclude domain="database" path="." />
  <exclude domain="sharedpref" path="." />
</full-backup-content>
```

---

## Info

### IN-01: APPLE_CERTIFICATE_BASE64 is a gating sentinel that the fastlane lane does not consume

**File:** `.github/workflows/mobile-ios.yml:76,80` and `leanshot/fastlane/Fastfile:42`

**Issue:** `APPLE_CERTIFICATE_BASE64` is listed as a required secret in the Fastfile comment and is used as a gating condition (`if: env.APPLE_CERTIFICATE_BASE64 != ''`). However, the `upload_testflight` lane does not decode or use this secret — it fetches certificates via `match()` using `MATCH_GIT_BASIC_AUTHORIZATION`. If the operator provisions only the match secrets without `APPLE_CERTIFICATE_BASE64`, the upload job will never run even though signing would otherwise succeed. The secret name implies manual certificate import but the architecture uses match for cert management.

**Fix:** Either (a) document in the Fastfile comment that `APPLE_CERTIFICATE_BASE64` is a presence gate only (not a cert to decode), or (b) replace the gate with `MATCH_GIT_BASIC_AUTHORIZATION` which is the actual signing prerequisite:

```yaml
    if: env.MATCH_GIT_BASIC_AUTHORIZATION != '' && env.FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD != ''
```

---

### IN-02: build_ios_unsigned lane has skip_codesigning: true with export_method: "development" — contradictory but harmless

**File:** `leanshot/fastlane/Fastfile:31-32`

**Issue:** `skip_codesigning: true` tells gym to skip all code signing. `export_method: "development"` is only meaningful when code signing is active. These two options are contradictory — `skip_codesigning: true` wins and the export method is ignored. This causes no runtime failure but is misleading to future maintainers.

**Fix:** Remove the `export_method` parameter from the `build_ios_unsigned` lane since it has no effect when `skip_codesigning: true`:

```ruby
lane :build_ios_unsigned do
  gym(
    workspace: "apps/ios/App/App.xcodeproj/project.xcworkspace",
    scheme: "App",
    configuration: "Release",
    skip_codesigning: true,
    output_directory: "build/ios",
    output_name: "LeanShot-unsigned.ipa"
  )
end
```

---

_Reviewed: 2026-05-25T10:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
