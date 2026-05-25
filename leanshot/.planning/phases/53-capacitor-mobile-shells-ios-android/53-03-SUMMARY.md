---
phase: 53-capacitor-mobile-shells-ios-android
plan: 03
subsystem: infra
tags: [github-actions, ios, android, capacitor, fastlane, xcodebuild, gradle, app-links]

# Dependency graph
requires:
  - phase: 53-01
    provides: fastlane lanes build_ios_unsigned, upload_testflight, build_android_unsigned, upload_play
provides:
  - iOS CI workflow (.github/workflows/mobile-ios.yml) — unsigned always-green build on macos-latest + gated TestFlight upload job
  - Android CI workflow (.github/workflows/mobile-android.yml) — unsigned always-green AAB on ubuntu-latest with Java 17 + gated Play upload job
  - AndroidManifest App Links intent-filter for https://app.leanshot.app (android:autoVerify="true")
affects: [phase-70, capacitor-mobile-shells-ios-android]

# Tech tracking
tech-stack:
  added: [github-actions-macos-latest, github-actions-ubuntu-latest, actions/setup-java@v4 temurin-17, ruby/setup-ruby@v1]
  patterns:
    - "secret→env gate pattern: map secrets to job-level env, gate job on env.X != '' (GitHub forbids secrets.* in if:)"
    - "cap sync before gradle pattern: npx cap sync android must precede gradlew to create assets dir"
    - "unsigned CI build pattern: CODE_SIGNING_ALLOWED=NO xcodebuild / empty -Pandroid.injected.signing.* props"

key-files:
  created:
    - .github/workflows/mobile-ios.yml
    - .github/workflows/mobile-android.yml
  modified:
    - leanshot/apps/android/app/src/main/AndroidManifest.xml

key-decisions:
  - "Used job-level env mapping for secrets gate (not step-level env or direct secrets.* in if:) per GitHub Actions security model"
  - "cap sync android placed BEFORE gradlew bundleRelease so assets dir is created; gradle fails silently if order reversed"
  - "No pod install step in iOS workflow — project uses SPM (CapApp-SPM/Package.swift) and cap sync handles plugin linking"
  - "App Links intent-filter added as second filter inside existing MainActivity; original LAUNCHER filter preserved"
  - "assetlinks.json SHA256 fingerprint left as placeholder — real value deferred to Phase 70 provisioning"
  - "Signing + upload lanes present but inert until APPLE_*/KEYSTORE_*/PLAY_* secrets provisioned in Phase 70"

patterns-established:
  - "secret→env gate: secrets mapped to job-level env{}, job gated with if: env.SECRET != ''"
  - "npm ci --legacy-peer-deps: mandatory for all mobile CI steps (@sentry/capacitor sibling-check blocker)"
  - "cap sync ordering: always before native build tool invocation"

requirements-completed: [MOBILE-01, MOBILE-02, MOBILE-03, MOBILE-05, MOBILE-09]

# Metrics
duration: 15min
completed: 2026-05-25
---

# Phase 53 Plan 03: CI Workflows + Android App Links Summary

**GitHub Actions iOS (macos-latest, unsigned xcodebuild) + Android (ubuntu-latest, Java 17, bundleRelease) CI pipelines with secret-gated fastlane upload jobs and android:autoVerify App Links intent-filter for app.leanshot.app**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-25T09:35:00Z
- **Completed:** 2026-05-25T09:50:43Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- iOS CI workflow: macos-latest, npm ci --legacy-peer-deps, npm run build, npx cap sync ios, unsigned xcodebuild (CODE_SIGNING_ALLOWED=NO); gated sign-and-upload-ios job invokes upload_testflight via secret→env pattern; zero pod install references
- Android CI workflow: ubuntu-latest, Java 17 temurin, npm ci --legacy-peer-deps, npm run build, npx cap sync android (ordered BEFORE gradlew), unsigned bundleRelease with empty signing props; gated sign-and-upload-android invokes upload_play via secret→env pattern
- AndroidManifest: second intent-filter with android:autoVerify="true" for https://app.leanshot.app (VIEW + DEFAULT + BROWSABLE) added inside existing MainActivity activity; original MAIN/LAUNCHER filter preserved

## Task Commits

Each task was committed atomically:

1. **Task 1: iOS CI workflow** - `4d80fbd8` (feat)
2. **Task 2: Android CI workflow** - `d0a4d01d` (feat)
3. **Task 3: AndroidManifest App Links intent-filter** - `6f77b1f8` (feat)

**Plan metadata:** (see final commit below)

## Files Created/Modified

- `.github/workflows/mobile-ios.yml` — iOS CI: build-ios (unsigned, always green) + sign-and-upload-ios (gated on APPLE_CERTIFICATE_BASE64)
- `.github/workflows/mobile-android.yml` — Android CI: build-android (unsigned AAB, always green) + sign-and-upload-android (gated on KEYSTORE_BASE64)
- `leanshot/apps/android/app/src/main/AndroidManifest.xml` — Added App Links intent-filter (android:autoVerify="true", https, app.leanshot.app)

## Decisions Made

- **secret→env gate pattern:** GitHub Actions forbids `secrets.*` in `if:` expressions on jobs. Solution: map secrets to job-level `env:` block, then gate job with `if: env.X != ''`. Replicated from RESEARCH.md skeleton.
- **cap sync before gradle:** `npx cap sync android` creates `apps/android/app/src/main/assets/` which does not exist until sync runs. Placing gradle before sync causes a silent failure at build time.
- **No pod install:** iOS project uses Swift Package Manager (CapApp-SPM/Package.swift). cap sync handles Capacitor plugin linking. No CocoaPods step anywhere.
- **App Links dual intent-filter:** Added second intent-filter for App Links alongside (not replacing) the existing LAUNCHER intent-filter.

## Deviations from Plan

None — plan executed exactly as written.

## Gated Secret Names

### iOS (sign-and-upload-ios job)
- `APPLE_CERTIFICATE_BASE64` — gate trigger (job `if:`)
- `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD` — gate trigger (job `if:`)
- `MATCH_GIT_BASIC_AUTHORIZATION` — Fastlane Match auth
- `MATCH_PASSWORD` — Fastlane Match passphrase

### Android (sign-and-upload-android job)
- `KEYSTORE_BASE64` — gate trigger (job `if:`)
- `PLAY_SERVICE_ACCOUNT_JSON` — gate trigger (job `if:`)
- `KEYSTORE_PASSWORD` — keystore password
- `KEY_ALIAS` — signing key alias
- `KEY_PASSWORD` — signing key password

## Phase 70 Deferrals

- **iOS signing + TestFlight upload:** inert until APPLE_CERTIFICATE_BASE64 + FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD provisioned. Fastlane match repo (pallefat/leanshot-fastlane-match) may not be initialized yet.
- **Android signing + Play upload:** inert until KEYSTORE_BASE64 + PLAY_SERVICE_ACCOUNT_JSON provisioned.
- **assetlinks.json SHA256 fingerprint:** placeholder value in public/.well-known/assetlinks.json; real fingerprint from actual signing keystore required at Phase 70.

## Issues Encountered

None.

## User Setup Required

None for Phase 53 (unsigned builds run without any secrets). Phase 70 will require provisioning the gated secrets listed above in the GitHub repository Settings > Secrets and Variables > Actions.

## Next Phase Readiness

- iOS + Android CI pipelines are active and always-green on unsigned builds
- App Links intent-filter registered in AndroidManifest; assetlinks.json SHA256 placeholder awaits Phase 70 real fingerprint
- Fastlane lanes from 53-01 are wired and ready; gated jobs become active once provisioning secrets are set

---
*Phase: 53-capacitor-mobile-shells-ios-android*
*Completed: 2026-05-25*
