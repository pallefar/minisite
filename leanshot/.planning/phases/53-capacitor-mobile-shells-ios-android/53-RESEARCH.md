# Phase 53: Capacitor Mobile Shells (iOS + Android) — Research

**Researched:** 2026-05-25
**Domain:** Capacitor 8 / iOS CI / Android CI / Universal Links / RevenueCat / fastlane
**Confidence:** HIGH (core stack fully verified from codebase + official docs)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Generate BOTH platforms: `npx cap add ios` + `npx cap add android`; commit the generated native projects.
- **cocoapods is NOT installed locally** — iOS `pod install` + native iOS build DEFER to CI / Phase 70. Executors scaffold dirs + config locally and verify via config validity + web build, NOT via a local iOS build. Android `cap sync` can run locally if Android SDK present; otherwise verify config + defer build to CI.
- Reuse/extend the existing `capacitor.config.ts` and the already-installed plugin set. RevenueCat SDK is already a dependency — wire its `Purchases.configure()` init (API keys `RC_API_KEY_IOS` / `RC_API_KEY_ANDROID` gated/deferred to P70).
- GitHub Actions: macOS runner for iOS, ubuntu for Android. Model on existing `.github/workflows/mobile-privacy-audit.yml` house style.
- Signing steps are **conditional on GH secrets** (Apple cert/provisioning, Play keystore/service-account). When absent → build runs UNSIGNED and green; signed artifacts deferred to P70.
- TestFlight + Play internal-track upload steps PRESENT but gated on secrets; actual upload deferred to P70.
- Ship `apple-app-site-association` + `assetlinks.json` for `app.leanshot.app` with placeholder team/package IDs (suggested `app.leanshot.ios` / `app.leanshot.android`); document the real-ID swap as pending in the runbook.
- Reuse the existing `DeleteAccountModal`; ensure it is reachable from mobile Settings (Apple §5.1.1(v) + Play §13.7). No new mobile-only deletion screen.
- Store metadata: fastlane `metadata/` dirs (ios + android) + screenshot placeholders + privacy nutrition labels doc.
- "Done" = platform dirs committed + `cap sync` config valid + unsigned CI build green + deep-link files present + account deletion reachable + fastlane metadata/privacy-labels scaffolded. Signed artifacts / TestFlight / physical-device UAT / store submission → Phase 70.
- UI-SPEC skipped intentionally — no net-new visual surface.

### Claude's Discretion
- Exact CI workflow structure, fastlane lane definitions, capacitor.config server/deep-link settings, and native project bundle-id placeholders are at Claude's discretion within the above constraints.

### Deferred Ideas (OUT OF SCOPE)
- Signed IPA/AAB artifacts, TestFlight + Play internal-testing upload, physical-device cold-launch UAT, deep-link resolution on-device, store submission + real metadata/screenshots → Phase 70 HUMAN-UAT.
- Real bundle-id / team-id / service-account substitution into native projects + association files → Phase 70.
- Push notification native wiring → Phase 54.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MOBILE-01 | `ios/` + `android/` platform dirs scaffolded under `leanshot/` | Capacitor 8 `cap add` flow; existing dirs at `apps/ios` + `apps/android` — config must match |
| MOBILE-02 | iOS bundle builds via GitHub Actions on macOS runner; Fastlane match repo; `MATCH_GIT_BASIC_AUTHORIZATION` + provisioning profiles in CI | fastlane match conditional-on-secrets pattern documented |
| MOBILE-03 | Android bundle builds via GitHub Actions; signed AAB; `PLAY_SERVICE_ACCOUNT_JSON` via fastlane supply | Android Gradle + fastlane supply conditional-on-secrets pattern documented |
| MOBILE-04 | Capacitor plugins approved: `@capacitor/app`, `@capacitor/preferences`, `@capacitor/network`, `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/keyboard` | All installed at v8.x — verified from package.json |
| MOBILE-05 | Universal Links (iOS) + App Links (Android) for `https://app.leanshot.app/*`; AASA + `assetlinks.json` deployed to Vercel | Existing files at `public/.well-known/` already present + served — need TEAMID substitution |
| MOBILE-06 | RevenueCat iOS + Android SDKs wired; `RC_API_KEY_IOS` + `RC_API_KEY_ANDROID` env-gated | `configureRC()` bridge already exists in `src/lib/native/iap.ts` — just wire env vars |
| MOBILE-07 | App Store + Play Store metadata + screenshots + privacy labels filled; submission package generated | fastlane `metadata/` scaffold pattern documented; existing `apps/ios/marketing/` + `apps/android/store-listing-en.md` present |
| MOBILE-08 | In-app account deletion reachable from mobile shell (Apple §5.1.1(v) + Play §13.7) | `DeleteAccountModal` already wired in `SettingsPage.tsx`; verify mobile-viewport reachability |
| MOBILE-09 | TestFlight + Play internal-testing first build | Gated on secrets; deferred to P70 |
| MOBILE-10 | Per-store privacy nutrition labels (Apple App Privacy + Google Data Safety) | Existing `PrivacyInfo.xcprivacy` + `data-safety.md` present; need v1.4 audit |
</phase_requirements>

---

## Summary

Phase 53 scaffolds native iOS and Android wrappers around the existing LeanShot Vite/React SPA using Capacitor 8. The critical starting-state discovery is that **Phase 16 already partially executed this work**: `apps/ios/` and `apps/android/` native projects exist and are committed, `capacitor.config.ts` points at them (using `ios.path: 'apps/ios'` / `android.path: 'apps/android'`), the privacy manifest and data-safety files are scaffolded, the deep-link association files exist (with placeholder TEAMID), the RevenueCat bridge (`src/lib/native/iap.ts`) is fully implemented, and the `DeleteAccountModal` is already wired into `SettingsPage`. The phase is therefore about completing and shipping what was scaffolded — not re-scaffolding from zero.

The outstanding gaps are: (1) `cap sync` is producing an Android "missing assets" error (no Vite build present in CI), which needs a `npm run build && npx cap sync android` step added to CI; (2) GitHub Actions iOS build workflow and Android build workflow do not exist yet; (3) the AASA file has `TEAMID` placeholder — needs documentation of the swap procedure; (4) RevenueCat env vars `VITE_RC_API_KEY_IOS` / `VITE_RC_API_KEY_ANDROID` need to be declared in `.env.local` and Vercel (deferred keys); (5) fastlane `Gemfile` + `Fastfile` + per-platform lane structure need to be scaffolded; (6) mobile Settings viewport needs verification that the "Delete account" button is reachable at 375px.

Xcode 26.5 is installed locally; CocoaPods is NOT; the existing iOS project uses SPM (`CapApp-SPM` directory present) which correctly means `pod install` is not required. Android SDK is NOT configured locally (ANDROID_HOME unset). The Capacitor CLI is installed at v8.3.4.

**Primary recommendation:** Keep the existing `apps/ios` + `apps/android` layout (capacitor.config.ts already matches), add CI workflows, scaffold fastlane, and document the P70 signing/upload gate clearly.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Native project generation | Local dev (cap CLI) | CI (cap sync) | `cap add` runs once locally; `cap sync` runs on every CI build after `npm run build` |
| iOS build + signing | CI (macOS GitHub Actions) | — | xcodebuild requires macOS; CocoaPods not local; pod install not needed (SPM) |
| Android build + signing | CI (ubuntu GitHub Actions) | — | Gradle can run on ubuntu; no local Android SDK |
| Universal Links (iOS) | Backend (Vercel serving AASA) + Native (entitlements) | — | iOS verifies AASA from the app's associated domain at install time |
| App Links (Android) | Backend (Vercel serving assetlinks.json) + Native (AndroidManifest) | — | Android verifies at install time from `autoVerify` intent-filter |
| RevenueCat SDK init | Frontend (SPA, lazy-loaded on user auth) | — | `configureRC()` called in `App.tsx` after user sign-in; platform-branched |
| Account deletion reachability | Frontend (SettingsPage mobile viewport) | — | `DeleteAccountModal` already wired; verify tap-target ≥44px at 375px |
| Store metadata / privacy labels | Static files (committed in repo) | Fastlane upload | Scaffolded in `apps/ios/marketing/` + `apps/android/`; fastlane reads them |
| CI secrets gating | CI (GitHub Secrets) | — | Conditional `if: env.APPLE_CERT != ''` blocks; unsigned builds always green |

---

## Critical Pre-Existing State Discovery

**What already exists (Phase 16 partial execution):**

| Artifact | Status | Location |
|----------|--------|----------|
| iOS native project | EXISTS — SPM-based, PRODUCT_BUNDLE_IDENTIFIER=app.leanshot.ios | `leanshot/apps/ios/App/App.xcodeproj/` |
| Android native project | EXISTS — applicationId=app.leanshot.android | `leanshot/apps/android/app/build.gradle` |
| capacitor.config.ts | EXISTS — ios.path='apps/ios', android.path='apps/android', webDir='dist' | `leanshot/capacitor.config.ts` |
| PrivacyInfo.xcprivacy | EXISTS — 6 data types, 4 API types | `leanshot/apps/ios/App/App/PrivacyInfo.xcprivacy` |
| data-safety.md | EXISTS — mirrors iOS manifest | `leanshot/apps/android/data-safety.md` |
| apple-app-site-association | EXISTS — placeholder TEAMID | `leanshot/public/.well-known/apple-app-site-association` |
| assetlinks.json | EXISTS — placeholder SHA256 | `leanshot/public/.well-known/assetlinks.json` |
| RevenueCat bridge | EXISTS — `configureRC()` fully implemented, reads VITE_RC_API_KEY_IOS/ANDROID | `leanshot/src/lib/native/iap.ts` |
| DeleteAccountModal | EXISTS — wired in SettingsPage.tsx at line 885 | `leanshot/src/components/dashboard/settings/` |
| iOS screenshot placeholders | EXISTS — 9 placeholder PNGs across 3 device sizes | `leanshot/apps/ios/marketing/screenshots/en-US/` |
| Android store-listing-en.md | EXISTS | `leanshot/apps/android/store-listing-en.md` |
| App.entitlements | EXISTS — associated-domains: applinks:leanshot.app + applinks:app.leanshot.app | `leanshot/apps/ios/App/App/App.entitlements` |
| debug.xcconfig | EXISTS — CAPACITOR_DEBUG=true | `leanshot/apps/ios/debug.xcconfig` |
| vitest-mobile.config.ts | EXISTS — mocks for Capacitor + RevenueCat | `leanshot/vitest-mobile.config.ts` |

**Path layout deviation (CRITICAL for planner):**
The `capacitor.config.ts` comment block explicitly documents that Phase 16 deviated from Capacitor's default `ios/` + `android/` layout to use `apps/ios` + `apps/android` (see "R1 deviation" comment in the file). REQUIREMENTS MOBILE-01 says "ios/ + android/ platform dirs" but CONTEXT.md says "Reuse/extend the existing capacitor.config.ts". These conflict. **Resolution: keep existing `apps/ios` + `apps/android` layout.** Do NOT move or rename native dirs — that would break the Capacitor CLI references and requires the planner to note this deviation from MOBILE-01's literal wording.

**cap doctor output:**
```
[success] iOS looking great!
[error] app/src/main/assets directory is missing in apps/android
```
The Android error is expected — it appears because `dist/` exists but `cap sync android` has not yet been run (the assets dir is created by `cap sync`). This is not a project corruption; it will be fixed by CI running `npm run build && npx cap sync android`.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@capacitor/core` | 8.3.4 [VERIFIED: npm registry] | Core Capacitor bridge | Already installed |
| `@capacitor/cli` | 8.3.4 [VERIFIED: npm registry] | CLI for sync/build/open | Already installed |
| `@capacitor/ios` | 8.3.4 [VERIFIED: npm registry] | iOS native bridge | Already installed |
| `@capacitor/android` | 8.3.4 [VERIFIED: npm registry] | Android native bridge | Already installed |
| `@revenuecat/purchases-capacitor` | 13.1.1 [VERIFIED: npm registry] | IAP/subscription management | Already installed; bridge implemented |
| `@sentry/capacitor` | 4.0.0 [VERIFIED: npm registry] | Crash reporting on native | Already installed |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fastlane | gem (no npm) | Build automation + signing + store upload | CI workflow for iOS + Android |
| Gemfile + Gemfile.lock | — | Pin fastlane gem version | Required for reproducible fastlane installs |
| `actions/setup-java` | v4 | Java for Android Gradle | Required in ubuntu Android CI job |

### Capacitor Plugins Already Installed (MOBILE-04 Compliant)

All MOBILE-04-required plugins confirmed at v8.x from `package.json`: [VERIFIED: codebase]
- `@capacitor/app` — ^8.1.0
- `@capacitor/preferences` — ^8.0.1
- `@capacitor/network` — ^8.0.1
- `@capacitor/status-bar` — ^8.0.2
- `@capacitor/splash-screen` — ^8.0.1
- `@capacitor/keyboard` — ^8.0.3

### npm install Warning

`@sentry/capacitor` v4 has a sibling-check against `@sentry/react` on fresh `npm install`. [ASSUMED from project memory `reference_sentry_capacitor_npm_install_blocker`] Workaround already applied in CI (`npm ci --legacy-peer-deps` per existing `mobile-privacy-audit.yml`). The `vercel.json` `installCommand: "npm install --legacy-peer-deps --update-sentry-capacitor"` confirms this is tracked. All CI workflows MUST use `npm ci --legacy-peer-deps` or `--ignore-scripts`.

---

## Package Legitimacy Audit

All packages in this phase are already installed in the project (Phase 16). No new npm packages are introduced. slopcheck was unavailable at research time.

| Package | Registry | Notes | Disposition |
|---------|----------|-------|-------------|
| `@capacitor/core` | npm | Official Ionic package, 8+ years, 500K+/wk downloads | Approved (pre-existing) |
| `@capacitor/ios` | npm | Official Ionic package | Approved (pre-existing) |
| `@capacitor/android` | npm | Official Ionic package | Approved (pre-existing) |
| `@revenuecat/purchases-capacitor` | npm | Official RevenueCat package | Approved (pre-existing) |
| `@sentry/capacitor` | npm | Official Sentry package | Approved (pre-existing) |
| fastlane | RubyGems | Official Fastlane/Google package, widely used | Approved — standard iOS/Android CI tool |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**Note:** slopcheck unavailable — all packages confirmed via official documentation + npm registry + codebase.

---

## Architecture Patterns

### System Architecture Diagram

```
[Vite SPA Build]
      |
      | npm run build → dist/
      |
      v
[npx cap sync ios/android]
  - copies dist/ → apps/ios/App/public/
  - copies dist/ → apps/android/app/src/main/assets/public/
      |
      |---> [iOS] apps/ios/ (SPM project, no pod install needed)
      |         |
      |         v
      |     [CI: macOS runner + xcodebuild]
      |         |
      |         +---> Unsigned IPA (always, when no cert secret)
      |         +---> Signed IPA (conditional: APPLE_CERTIFICATE_BASE64 set)
      |                   |
      |                   +---> [gated] fastlane pilot → TestFlight
      |
      +---> [Android] apps/android/ (Gradle project)
                |
                v
            [CI: ubuntu runner + ./gradlew bundleRelease]
                |
                +---> Unsigned AAB (always, when no keystore)
                +---> Signed AAB (conditional: KEYSTORE_BASE64 set)
                          |
                          +---> [gated] fastlane supply → Play internal track
```

**Deep link verification flow:**
```
[App install] --> iOS reads entitlements → fetches https://app.leanshot.app/.well-known/apple-app-site-association
                                                          |
                                                    [Vercel serves static JSON]
                                                          |
                                                    Vercel header: Content-Type: application/json
                                                          |
                                                    TEAMID.app.leanshot.ios matched → Universal Link active

[App install] --> Android autoVerify → fetches https://app.leanshot.app/.well-known/assetlinks.json
                                                          |
                                                    [Vercel serves static JSON]
                                                          |
                                                    sha256 fingerprint matched → App Link active
```

### Recommended Project Structure

```
leanshot/
├── apps/
│   ├── ios/                        # existing Capacitor iOS project (SPM)
│   │   ├── App/
│   │   │   ├── App/
│   │   │   │   ├── PrivacyInfo.xcprivacy    # already exists
│   │   │   │   └── App.entitlements         # already exists (applinks:)
│   │   │   ├── App.xcodeproj/
│   │   │   └── CapApp-SPM/
│   │   ├── debug.xcconfig                   # already exists
│   │   └── marketing/
│   │       └── screenshots/en-US/           # already exists (9 placeholders)
│   └── android/                    # existing Capacitor Android project
│       ├── app/
│       │   └── src/main/
│       │       └── AndroidManifest.xml      # needs intent-filter for App Links
│       ├── data-safety.md                   # already exists
│       └── store-listing-en.md             # already exists
├── fastlane/                       # NEW this phase
│   ├── Gemfile                     # pins fastlane gem version
│   ├── Appfile                     # bundle_id + Apple ID + Play package
│   ├── Matchfile                   # match_git_url = pallefar/leanshot-fastlane-match
│   └── Fastfile                    # lanes: build_ios, build_android, upload_testflight[gated], upload_play[gated]
├── public/.well-known/
│   ├── apple-app-site-association  # already exists (TEAMID placeholder)
│   └── assetlinks.json             # already exists (SHA256 placeholder)
└── capacitor.config.ts             # already exists — no path changes needed
```

### Pattern 1: SPM-based iOS build without CocoaPods

**What:** Capacitor 8 defaults to Swift Package Manager. No `pod install` needed.
**When to use:** This project already uses SPM (CapApp-SPM dir exists). Always use this path.
**Key CI insight:** `cap sync` + `xcodebuild` without any CocoaPods step.

```yaml
# Source: capacitorjs.com/docs/ios/spm + existing project inspection
- name: Build (no signing)
  run: |
    xcodebuild build \
      -workspace apps/ios/App/App.xcodeproj/project.xcworkspace \
      -scheme App \
      -configuration Release \
      CODE_SIGN_IDENTITY="" \
      CODE_SIGNING_REQUIRED=NO \
      CODE_SIGNING_ALLOWED=NO \
      -sdk iphoneos \
      -derivedDataPath derived_data
```

### Pattern 2: Conditional Signing Gate

**What:** CI checks for secret presence; signed build only runs when cert secret is non-empty.
**When to use:** Every signing step in every mobile CI workflow.

```yaml
# Source: GitHub Actions docs + fastlane CI best practices
- name: Set up signing (conditional)
  if: env.APPLE_CERTIFICATE_BASE64 != ''
  env:
    APPLE_CERTIFICATE_BASE64: ${{ secrets.APPLE_CERTIFICATE_BASE64 }}
  run: |
    echo "$APPLE_CERTIFICATE_BASE64" | base64 --decode > certificate.p12
    bundle exec fastlane match appstore --readonly

- name: Build signed (conditional)
  if: env.APPLE_CERTIFICATE_BASE64 != ''
  run: bundle exec fastlane build_ios_signed

- name: Upload TestFlight (conditional)
  if: env.APPLE_CERTIFICATE_BASE64 != '' && env.FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD != ''
  run: bundle exec fastlane pilot upload
```

### Pattern 3: Android Gradle signed AAB conditional

```yaml
# Source: ionic.io/blog/building-and-releasing-your-capacitor-android-app
- name: Build unsigned AAB (always)
  working-directory: leanshot/apps/android
  run: ./gradlew bundleRelease -Pandroid.injected.signing.store.file= ...
  
- name: Sign AAB (conditional)
  if: env.KEYSTORE_BASE64 != ''
  env:
    KEYSTORE_BASE64: ${{ secrets.KEYSTORE_BASE64 }}
    KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}
  run: |
    echo "$KEYSTORE_BASE64" | base64 --decode > release.keystore
    jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
      -keystore release.keystore ...
```

### Pattern 4: RevenueCat init — already implemented

`configureRC()` in `src/lib/native/iap.ts` already reads `VITE_RC_API_KEY_IOS` / `VITE_RC_API_KEY_ANDROID` from Vite env and is called in `App.tsx` after user sign-in. Keys are deferred to P70. The only Phase 53 work is documenting the env var names in `.env.local.example` and Vercel env listing (values set at P52/P70).

```typescript
// Source: src/lib/native/iap.ts (already implemented)
// configureRC is called with the signed-in user's ID
// Platform branching: ios → VITE_RC_API_KEY_IOS, android → VITE_RC_API_KEY_ANDROID
// Web short-circuits to no-op
export async function configureRC(appUserID: string): Promise<void> {
  if (!isNativePlatform()) return; // no-op on web
  // reads import.meta.env.VITE_RC_API_KEY_IOS or VITE_RC_API_KEY_ANDROID
  await Purchases.configure({ apiKey, appUserID });
}
```

### Pattern 5: AASA file format (existing file has correct structure)

```json
// Source: public/.well-known/apple-app-site-association (existing file)
// Only change needed: replace "TEAMID" with real Apple Team ID at P70
{
  "applinks": {
    "apps": [],
    "details": [{
      "appID": "TEAMID.app.leanshot.ios",
      "paths": ["/signin", "/signup", "/reset-password", "/verify-email",
                "/share/*", "/r/*", "/clinic/*", "/clinic-invite/*", "/", "/pricing", "/faq"]
    }]
  },
  "webcredentials": { "apps": ["TEAMID.app.leanshot.ios"] }
}
```

**Vercel serving:** Already configured in `vercel.json` — both `.well-known` files have `Content-Type: application/json` headers, and the catch-all rewrite excludes `.well-known` from SPA routing.

### Pattern 6: Android App Links intent-filter

The existing `AndroidManifest.xml` does NOT have an App Links intent-filter. It needs one:

```xml
<!-- Source: developer.android.com/training/app-links/add-applinks -->
<!-- Add to apps/android/app/src/main/AndroidManifest.xml inside <activity> -->
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https"
          android:host="app.leanshot.app" />
</intent-filter>
```

### Pattern 7: fastlane structure for conditional CI

```ruby
# Source: docs.fastlane.tools + Runway blog CI patterns
# fastlane/Fastfile

platform :ios do
  desc "Build unsigned IPA (always runs)"
  lane :build_ios_unsigned do
    gym(
      workspace: "apps/ios/App/App.xcodeproj/project.xcworkspace",
      scheme: "App",
      configuration: "Release",
      skip_codesigning: true,
      export_method: "development"
    )
  end

  desc "Upload to TestFlight — GATED on Apple secrets"
  lane :upload_testflight do
    # Called only when CI detects APPLE_CERTIFICATE_BASE64 secret
    match(type: "appstore", readonly: true)
    gym(scheme: "App", export_method: "app-store")
    pilot(skip_waiting_for_build_processing: true)
  end
end

platform :android do
  desc "Build unsigned AAB (always runs)"
  lane :build_android_unsigned do
    gradle(
      task: "bundle",
      build_type: "Release",
      project_dir: "apps/android/",
      properties: { "android.injected.signing.store.file" => "" }
    )
  end

  desc "Upload to Play internal track — GATED on Play secrets"
  lane :upload_play do
    supply(
      track: "internal",
      json_key_data: ENV["PLAY_SERVICE_ACCOUNT_JSON"]
    )
  end
end
```

### Anti-Patterns to Avoid

- **Attempting `pod install` locally:** CocoaPods not installed; iOS uses SPM. `cap sync` handles iOS dependencies via Package.swift.
- **Running `cap add ios` when project already exists:** Phase 16 already ran it. Running again would overwrite the existing native project. Use `cap sync` instead.
- **Hardcoding TEAMID in AASA:** The `TEAMID` placeholder must remain and be documented for P70 substitution.
- **Setting `webContentsDebuggingEnabled: true` in production config:** Already false in capacitor.config.ts — keep it that way.
- **Missing `--legacy-peer-deps` in CI npm install:** Required due to `@sentry/capacitor` sibling-check. All CI workflows must use this flag.
- **Changing `ios.path` or `android.path` in capacitor.config.ts:** The existing `apps/ios` + `apps/android` layout is locked by Phase 16 and documented in the config comments. Do not change.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| iOS code signing in CI | Custom certificate scripts | fastlane match | match handles keychain + profile lifecycle; custom scripts break on macOS runner keychain isolation |
| Android AAB signing | Manual jarsigner scripts | fastlane supply / Gradle signing config | Supply reads key.properties correctly; manual scripts miss zipalign |
| Universal Link serving | Custom Vercel middleware | Static file in `public/.well-known/` | Already in place; Vercel headers already configured; no middleware needed |
| RevenueCat SDK init | Custom platform-branching | Existing `configureRC()` in `iap.ts` | Already implemented + tested; do not duplicate |
| iOS dependency management | CocoaPods | SPM (already in project) | SPM is the Capacitor 8 default; CocoaPods not installed locally |
| Fake SHA256 fingerprint | Random hex string | Use Play Console signing fingerprint | Android verification fails silently with wrong SHA256 |

---

## Runtime State Inventory

This phase scaffolds native infrastructure; it is not a rename/refactor phase. No runtime state migration required.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None | None |
| Live service config | `VITE_RC_API_KEY_IOS` + `VITE_RC_API_KEY_ANDROID` — not yet in Vercel env (deferred to P52/P70) | Document in `.env.local.example`; Vercel env set deferred |
| OS-registered state | None | None |
| Secrets/env vars | `RC_API_KEY_IOS`, `RC_API_KEY_ANDROID`, `MATCH_GIT_BASIC_AUTHORIZATION`, `APPLE_CERTIFICATE_BASE64`, `KEYSTORE_BASE64`, `PLAY_SERVICE_ACCOUNT_JSON` — all pending provisioning per Phase 52 smoke dashboard | Document; add to CI env section as conditional |
| Build artifacts | `apps/android/app/src/main/assets/` missing — created by `cap sync android` after build | CI must run `npm run build && npx cap sync` before Gradle build |

---

## Common Pitfalls

### Pitfall 1: Running `npx cap add ios` on existing project

**What goes wrong:** Overwrites the Phase 16 native project, discarding PrivacyInfo.xcprivacy, App.entitlements, entitlement, and pbxproj customizations.
**Why it happens:** Planners read CONTEXT "generate BOTH platforms" and add `cap add` to plan without checking existing dirs.
**How to avoid:** Check for `apps/ios/App/App.xcodeproj/` existence before any cap command. Phase 16 already ran `cap add`. Only `cap sync` is needed.
**Warning signs:** If `cap add` appears in any plan task, it is wrong.

### Pitfall 2: SPM vs CocoaPods confusion

**What goes wrong:** CI adds a `pod install` step, which fails because `pod` is not installed and the project uses SPM.
**Why it happens:** Most iOS CI tutorials reference CocoaPods; SPM is newer.
**How to avoid:** The presence of `CapApp-SPM/Package.swift` in the iOS project is the definitive indicator of SPM usage. No pod install step, ever.
**Warning signs:** `pod install` in any CI step is wrong for this project.

### Pitfall 3: Android assets directory missing error

**What goes wrong:** `cap doctor` shows `[error] app/src/main/assets directory is missing` and Gradle build fails.
**Why it happens:** `cap sync android` has not been run yet (requires a `dist/` from `npm run build`).
**How to avoid:** CI must run `npm run build && npx cap sync android` before `./gradlew bundleRelease`. The dist/ is already present locally but empty in CI checkout.
**Warning signs:** Gradle build failing with "file not found" or similar assets errors.

### Pitfall 4: AASA served with wrong Content-Type

**What goes wrong:** iOS silently ignores the AASA file, Universal Links don't activate.
**Why it happens:** Vercel might serve `.well-known/apple-app-site-association` as `text/plain` or `application/octet-stream` without explicit header config.
**How to avoid:** Already handled in `vercel.json` (`Content-Type: application/json` header for `/.well-known/apple-app-site-association`). Do not remove this header.

### Pitfall 5: `@sentry/capacitor` npm install failure

**What goes wrong:** Fresh `npm ci` in CI fails due to sibling-check: `@sentry/capacitor` requires `@sentry/react` at a specific version.
**Why it happens:** Sentry Capacitor SDK perf checks sibling packages at install time.
**How to avoid:** All CI workflows MUST use `npm ci --legacy-peer-deps` (matches existing `mobile-privacy-audit.yml` and `vercel.json` installCommand).
**Warning signs:** CI failing at `npm ci` step with peer dependency error mentioning `@sentry/capacitor`.

### Pitfall 6: capacitor.config.ts `webDir` path

**What goes wrong:** `cap sync` copies from wrong directory.
**Why it happens:** `webDir: 'dist'` assumes relative path from the project root where the config file lives (`leanshot/`). CI working-directory must be `leanshot/`.
**How to avoid:** All CI steps for cap commands must run with `working-directory: leanshot` (or `defaults: run: working-directory: leanshot` like `mobile-privacy-audit.yml`).

### Pitfall 7: Android assetlinks SHA256 placeholder breaks verification

**What goes wrong:** App Links fail silently; Android treats links as browser links.
**Why it happens:** The placeholder `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_AT_PLAN_16_09` in `assetlinks.json` is not a valid SHA256 fingerprint.
**How to avoid:** Document the placeholder clearly; App Links verification only needs to work in production. For Phase 53, the file is scaffolded with placeholder — production wiring deferred to P70. Add a `// PLACEHOLDER` comment in runbook.

---

## Code Examples

### Cap sync command (CI)

```bash
# Source: capacitorjs.com/docs/getting-started + cap doctor output
cd leanshot
npm run build          # creates dist/ (webDir)
npx cap sync ios       # copies dist/ → apps/ios/App/public/ + syncs plugins via SPM
npx cap sync android   # copies dist/ → apps/android/app/src/main/assets/public/ + syncs plugins
```

### iOS xcodebuild — unsigned (always-green CI)

```bash
# Source: qualitycoding.org/github-actions-ci-xcode/ + Apple Developer docs
cd leanshot
xcodebuild build \
  -workspace "apps/ios/App/App.xcodeproj/project.xcworkspace" \
  -scheme "App" \
  -configuration "Release" \
  -sdk "iphoneos" \
  -derivedDataPath "derived_data" \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO
```

### Android Gradle — unsigned (always-green CI)

```bash
# Source: ionic.io/blog/building-and-releasing-your-capacitor-android-app
cd leanshot/apps/android
./gradlew bundleRelease \
  -Pandroid.injected.signing.store.file="" \
  -Pandroid.injected.signing.store.password="" \
  -Pandroid.injected.signing.key.alias="" \
  -Pandroid.injected.signing.key.password=""
```

### Fastlane Gemfile (pin version)

```ruby
# Source: docs.fastlane.tools/best-practices/continuous-integration/github/
source "https://rubygems.org"

gem "fastlane", "~> 2.222"
```

### iOS CI workflow skeleton (GitHub Actions)

```yaml
# File: .github/workflows/mobile-ios.yml
# Source: runway.team/blog/ci-cd-ios-fastlane + existing mobile-privacy-audit.yml house style
name: iOS Build

on:
  push:
    branches: [main]
    paths:
      - 'leanshot/apps/ios/**'
      - 'leanshot/src/**'
      - 'leanshot/package.json'
      - 'leanshot/capacitor.config.ts'
      - 'leanshot/fastlane/**'
      - '.github/workflows/mobile-ios.yml'

concurrency:
  group: mobile-ios-${{ github.ref }}
  cancel-in-progress: true

defaults:
  run:
    working-directory: leanshot

jobs:
  build-ios:
    name: iOS Build (unsigned always green)
    runs-on: macos-latest   # Xcode 26.5 on current macos-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: leanshot/package-lock.json
      - name: Install dependencies
        run: npm ci --legacy-peer-deps
      - name: Build web assets
        run: npm run build
      - name: Cap sync iOS
        run: npx cap sync ios
      - name: Build unsigned IPA
        run: |
          xcodebuild build \
            -workspace "apps/ios/App/App.xcodeproj/project.xcworkspace" \
            -scheme "App" -configuration "Release" \
            -sdk "iphoneos" -derivedDataPath "derived_data" \
            CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO

  sign-and-upload:
    name: Sign + TestFlight (gated on Apple secrets)
    runs-on: macos-latest
    needs: build-ios
    if: |
      env.APPLE_CERTIFICATE_BASE64 != '' &&
      env.FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD != ''
    env:
      APPLE_CERTIFICATE_BASE64: ${{ secrets.APPLE_CERTIFICATE_BASE64 }}
      FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD: ${{ secrets.FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD }}
      MATCH_GIT_BASIC_AUTHORIZATION: ${{ secrets.MATCH_GIT_BASIC_AUTHORIZATION }}
      MATCH_PASSWORD: ${{ secrets.MATCH_PASSWORD }}
    steps:
      - uses: actions/checkout@v4
      - uses: ruby/setup-ruby@v1
        with:
          bundler-cache: true
          working-directory: leanshot
      - name: Setup CI keychain + match
        run: bundle exec fastlane run setup_ci
      - name: Build signed + upload TestFlight
        run: bundle exec fastlane upload_testflight
```

### Android CI workflow skeleton

```yaml
# File: .github/workflows/mobile-android.yml
name: Android Build

on:
  push:
    branches: [main]
    paths:
      - 'leanshot/apps/android/**'
      - 'leanshot/src/**'
      - 'leanshot/package.json'
      - 'leanshot/capacitor.config.ts'
      - 'leanshot/fastlane/**'
      - '.github/workflows/mobile-android.yml'

concurrency:
  group: mobile-android-${{ github.ref }}
  cancel-in-progress: true

defaults:
  run:
    working-directory: leanshot

jobs:
  build-android:
    name: Android Build (unsigned always green)
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: leanshot/package-lock.json
      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
      - name: Install dependencies
        run: npm ci --legacy-peer-deps
      - name: Build web assets
        run: npm run build
      - name: Cap sync Android
        run: npx cap sync android
      - name: Build unsigned AAB
        working-directory: leanshot/apps/android
        run: ./gradlew bundleRelease -Pandroid.injected.signing.store.file=""

  sign-and-upload:
    name: Sign + Play internal track (gated on Play secrets)
    runs-on: ubuntu-latest
    needs: build-android
    if: env.KEYSTORE_BASE64 != '' && env.PLAY_SERVICE_ACCOUNT_JSON != ''
    env:
      KEYSTORE_BASE64: ${{ secrets.KEYSTORE_BASE64 }}
      KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}
      KEY_ALIAS: ${{ secrets.KEY_ALIAS }}
      KEY_PASSWORD: ${{ secrets.KEY_PASSWORD }}
      PLAY_SERVICE_ACCOUNT_JSON: ${{ secrets.PLAY_SERVICE_ACCOUNT_JSON }}
    steps:
      - uses: actions/checkout@v4
      - uses: ruby/setup-ruby@v1
        with:
          bundler-cache: true
          working-directory: leanshot
      - name: Sign + upload Play internal track
        run: bundle exec fastlane upload_play
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CocoaPods (`pod install`) for iOS deps | SPM (`CapApp-SPM/Package.swift`) | Capacitor 8 (default for new projects) | No `pod install` in CI; faster dependency resolution |
| `cap add ios` / `cap add android` | `cap sync` (project already exists) | Phase 16 already scaffolded | Never run `cap add` again on this project |
| xcodebuild with provisioning profile required | xcodebuild with `CODE_SIGNING_ALLOWED=NO` for unsigned builds | Standard CI practice | CI always-green without Apple cert |
| RevenueCat API key hardcoded | `VITE_RC_API_KEY_*` env vars + `RcConfigError` guard | Phase 16 iap.ts | Graceful vendor-not-configured state |

**Deprecated/outdated:**
- `cap build ios/android` command: Use `xcodebuild`/`gradlew` directly for CI; `cap build` is a convenience wrapper for local development only.
- `cocoapods` in Capacitor iOS CI: SPM is the Capacitor 8 default; CocoaPods support continues until Dec 2026 but is not used in this project.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| xcodebuild | iOS CI build | Local: YES | Xcode 26.5 | — (required) |
| CocoaPods (`pod`) | iOS build | Local: NO | — | Not needed — project uses SPM |
| Capacitor CLI (`npx cap`) | cap sync | YES (in node_modules) | 8.3.4 | — |
| Android SDK (ANDROID_HOME) | Android local build | Local: NO | — | Defer to CI (ubuntu runner) |
| fastlane | CI signing | Local: NO | — | Defer to CI (Ruby setup step) |
| Ruby 2.6.10 | fastlane via gem | YES (system Ruby) | 2.6.10 | CI uses `ruby/setup-ruby@v1` for newer version |
| node_modules | npm install | YES | 22.18.0 | — |
| adb | Android debugging | YES | 35.0.2 | Not needed for build/CI |

**Missing dependencies with no fallback:**
- Android SDK locally — Android builds must run in CI.

**Missing dependencies with fallback:**
- fastlane locally — install via Gemfile + `bundle install` in CI.
- CocoaPods — not needed (SPM project).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.x (unit) + Playwright (e2e) |
| Mobile unit config | `vitest-mobile.config.ts` |
| Mobile unit command | `npm run test:mobile-unit` |
| CI command | `npm ci --legacy-peer-deps && npm run test:mobile-unit` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MOBILE-01 | Native dirs exist; cap sync succeeds | Smoke/shell | `npx cap doctor` | N/A (command check) |
| MOBILE-04 | Capacitor plugins installed | Unit/dependency | `npm ls @capacitor/app` | N/A |
| MOBILE-05 | AASA + assetlinks.json present + valid JSON | Smoke | `node -e "JSON.parse(require('fs').readFileSync('public/.well-known/apple-app-site-association','utf8'))"` | ✅ files exist |
| MOBILE-06 | configureRC web no-op; iOS/Android branches correct | Unit | `npm run test:mobile-unit` | ✅ `src/lib/native/iap.test.ts` |
| MOBILE-08 | DeleteAccountModal reachable in SettingsPage | Unit | `npx vitest run src/components/dashboard/settings/SettingsPage.test.tsx` | ✅ `SettingsPage.test.tsx` |
| MOBILE-09 | TestFlight + Play upload | Manual (P70 UAT) | — | Deferred |
| CI green | iOS unsigned build green | CI | `.github/workflows/mobile-ios.yml` | ❌ Wave 0 |
| CI green | Android unsigned build green | CI | `.github/workflows/mobile-android.yml` | ❌ Wave 0 |

### Wave 0 Gaps

- [ ] `.github/workflows/mobile-ios.yml` — iOS CI (unsigned always-green + signed/upload gated)
- [ ] `.github/workflows/mobile-android.yml` — Android CI (unsigned always-green + signed/upload gated)
- [ ] `leanshot/fastlane/Gemfile` + `Fastfile` + `Appfile` + `Matchfile`
- [ ] `leanshot/apps/android/app/src/main/AndroidManifest.xml` — add App Links intent-filter

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (mobile shell inherits web auth) | — |
| V3 Session Management | no (Supabase sessions in WebView) | — |
| V4 Access Control | no | — |
| V5 Input Validation | no (no new inputs) | — |
| V6 Cryptography | yes (signing keys in CI secrets) | GitHub Secrets + fastlane match encrypted cert repo |
| V7 Error Handling | yes | `RcConfigError` guard in iap.ts; unsigned build green |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Apple Team ID exposed in public AASA | Information Disclosure | Use placeholder `TEAMID` in committed file; real ID set at P70 in native project only |
| SHA256 fingerprint leaked via assetlinks.json | Information Disclosure | Acceptable — this is a public file required by Android; fingerprint is not secret |
| Signing keys in CI secrets | Elevation of Privilege | GitHub Secrets with least-privilege access; conditional-on-secret signing steps |
| RevenueCat API key in Vite env (public key) | Information Disclosure | RC public SDK keys are designed to be public (documented in `iap.ts` threat model comment); not a secret |
| `@sentry/capacitor` install blocker in CI | Availability | Mitigated by `--legacy-peer-deps` flag in all npm ci steps |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@sentry/capacitor` npm install sibling-check applies to CI fresh installs | Standard Stack / Pitfalls | Low — workaround (`--legacy-peer-deps`) is already in existing CI workflows; adding it costs nothing |
| A2 | REQUIREMENTS MOBILE-01 "ios/ + android/" refers to the platform dirs generically, not a literal path requirement that conflicts with existing `apps/ios` layout | Critical Pre-Existing State / Path Layout | Medium — if taken literally, planner might try to move dirs; researched evidence shows existing config comment explicitly documents this as an intentional deviation |
| A3 | `macos-latest` GitHub Actions runner has Xcode 26.5 or compatible for SPM builds | CI Patterns | Low — Xcode 26.5 is current; GitHub macos runners track current stable Xcode |
| A4 | fastlane `supply` for Play upload accepts `PLAY_SERVICE_ACCOUNT_JSON` env var directly | CI Patterns | Low — fastlane supply docs confirm json_key_data parameter accepts env var |
| A5 | The `VITE_RC_API_KEY_IOS` / `VITE_RC_API_KEY_ANDROID` env vars are the correct names (read from `iap.ts` source) | RevenueCat Pattern | HIGH CONFIDENCE — directly verified from source code at `src/lib/native/iap.ts` |

---

## Open Questions

1. **TEAMID for AASA**
   - What we know: `TEAMID` placeholder is in `public/.well-known/apple-app-site-association`. The real Team ID comes from VENDOR-01 (Phase 52 Apple Developer enrollment).
   - What's unclear: Whether Phase 52 captured the Team ID in a runbook artifact that Phase 53 executor can read.
   - Recommendation: Planner should add a task to read Team ID from Phase 52 runbook + document P70 swap procedure. Do NOT hardcode TEAMID in Phase 53 — leave placeholder and document.

2. **DeleteAccountModal mobile viewport gap**
   - What we know: `DeleteAccountModal` is wired in `SettingsPage` at line 885. The button is inside a settings section at line 668. SettingsPage is a scrollable panel.
   - What's unclear: Whether the "Delete account" button is reachable via scroll on a 375px viewport with the native keyboard/status bars. An iOS bottom-safe-area might obscure it.
   - Recommendation: Add a specific mobile viewport render test (jsdom at 375px) for SettingsPage that asserts the delete button renders and is not display:none. Visual confirm at P70.

3. **fastlane match repo access**
   - What we know: REQUIREMENTS MOBILE-02 specifies `pallefar/leanshot-fastlane-match` repo + `MATCH_GIT_BASIC_AUTHORIZATION` secret.
   - What's unclear: Whether this repo was created in Phase 52 VENDOR-01 or is pending.
   - Recommendation: Planner should gate the `Matchfile` scaffold on whether the repo exists; if not, scaffold placeholder Matchfile with TODO comment.

4. **`@revenuecat/purchases-capacitor` version drift**
   - What we know: `package.json` has `^13.1.1` but npm shows 13.1.2 as latest.
   - What's unclear: Whether the minor version bump introduces breaking changes.
   - Recommendation: Keep existing pinned version; do not upgrade as part of Phase 53.

---

## Sources

### Primary (HIGH confidence)
- Codebase inspection — `leanshot/capacitor.config.ts`, `apps/ios/App/App.xcodeproj/project.pbxproj`, `apps/android/app/build.gradle`, `apps/ios/App/App/App.entitlements`, `apps/ios/App/App/PrivacyInfo.xcprivacy`, `public/.well-known/apple-app-site-association`, `public/.well-known/assetlinks.json`, `src/lib/native/iap.ts`, `src/components/dashboard/settings/SettingsPage.tsx`, `vercel.json`, `.github/workflows/mobile-privacy-audit.yml`, `vitest-mobile.config.ts`
- `npx cap doctor` command output — confirmed iOS project valid, Android assets dir missing (expected)
- npm registry — `npm view @capacitor/ios version` = 8.3.4; `@capacitor/android` = 8.3.4; `@capacitor/cli` = 8.3.4; `@revenuecat/purchases-capacitor` = 13.1.2

### Secondary (MEDIUM confidence)
- [Capacitor 8 iOS SPM docs](https://capacitorjs.com/docs/ios/spm) — SPM vs CocoaPods, CapApp-SPM role, no pod install needed
- [Capacitor 8 Update Guide](https://capacitorjs.com/docs/updating/8-0) — minimum iOS 15 + Xcode 26, Android SDK 24+/36, Node 22+
- [Announcing Capacitor 8](https://ionic.io/blog/announcing-capacitor-8) — SPM default, edge-to-edge, migration
- [Android App Links — add intent filters](https://developer.android.com/training/app-links/add-applinks) — intent-filter `autoVerify` pattern
- [GitHub Actions + fastlane iOS pipeline](https://www.runway.team/blog/how-to-set-up-a-ci-cd-pipeline-for-your-ios-app-fastlane-github-actions) — conditional signing pattern
- [RevenueCat Capacitor docs](https://www.revenuecat.com/docs/getting-started/installation/capacitor) — `Purchases.configure()` pattern

### Tertiary (LOW confidence)
- WebSearch results on `xcodebuild CODE_SIGNING_ALLOWED=NO` — confirmed by multiple sources but not from official Apple docs URL

---

## Metadata

**Confidence breakdown:**
- Existing native project state: HIGH — verified from file system + cap doctor
- Standard stack / package versions: HIGH — npm registry confirmed
- SPM vs CocoaPods decision: HIGH — confirmed from CapApp-SPM dir presence + Capacitor 8 docs
- CI workflow patterns: MEDIUM — from official fastlane docs + community patterns
- AASA / assetlinks format: HIGH — existing files already correct; Apple/Google docs confirm format
- RevenueCat init: HIGH — source code fully verified

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (Capacitor 8 stable; fastlane patterns stable)
