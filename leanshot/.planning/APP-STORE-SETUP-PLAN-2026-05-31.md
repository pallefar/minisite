# App-Store Setup Plan — Apple Developer + Google Play Console

**Created:** 2026-05-31 · For: LeanShot first store uploads (TestFlight + Play internal-testing).

You have **both accounts** (Apple Developer + Play Console). This plan is a sequential
runbook. Each step is tagged **[YOU]** (console/credential action only you can do) or
**[ME]** (code/CI I can do in-repo, often after you hand me one value).

## What already exists (don't rebuild)
- Capacitor 8 native projects: `leanshot/apps/ios/` + `leanshot/apps/android/`.
- Bundle IDs: **`app.leanshot.ios`** (iOS) / **`app.leanshot.android`** (Android) — set in `Appfile`.
- Fastlane lanes (`leanshot/fastlane/Fastfile`): `build_ios_unsigned`, `upload_testflight`, `build_android_unsigned`, `upload_play`. Upload lanes are GATED on secrets (inert until set).
- `fastlane match` config (`Matchfile`): cert repo `pallefar/leanshot-fastlane-match`, `type appstore`, `readonly`.
- Store metadata: `leanshot/fastlane/metadata/{ios,android}/…` (descriptions, release_notes). Phase-71 sync script writes release notes into these at release time.
- Privacy/data-safety source docs: `apps/ios/marketing/privacy-nutrition-labels.md`, `apps/android/data-safety.md`.
- Phase-70 `70-01-PLAN-vendor-oauth-secrets.md` + `fastlane/README.md` §"Phase 70 Deferral Matrix" = the canonical secret/operator checklist.

## What's MISSING (gaps this plan closes)
- `.github/workflows/mobile-ios.yml` + `.github/workflows/mobile-android.yml` — the CI workflows that invoke the fastlane lanes (lanes exist; workflow YAMLs were never committed). **[ME]**
- Real values for placeholders: `TEAMID` in `public/.well-known/apple-app-site-association`; Play signing SHA-1/256 in `public/.well-known/assetlinks.json`. **[ME, once you give the values]**
- All signing secrets in GitHub repo settings. **[YOU]**

---

## Phase A — Apple Developer + App Store Connect

A1. **[YOU]** Confirm Apple Developer membership active. Capture **Team ID** (top of
    https://developer.apple.com/account, format like `ABC1234DEF`). → hand me this value.
A2. **[YOU]** Register the App ID: Certificates, Identifiers & Profiles → Identifiers →
    `+` → App IDs → App → description "LeanShot", Bundle ID **explicit** `app.leanshot.ios`.
    Enable capabilities you ship: **Sign in with Apple**, **Push Notifications** (+ Associated Domains for the universal-link `apple-app-site-association`).
A3. **[YOU]** App Store Connect → Apps → `+` → New App: platform iOS, name "LeanShot",
    primary language, Bundle ID `app.leanshot.ios`, SKU (e.g. `leanshot-ios`).
A4. **[YOU]** Sign in with Apple (matches `70-01` S15): create a **Services ID**
    `app.leanshot.web` + return URLs (`https://leanshot.app/auth/apple/callback` + the
    Supabase callback), download the `.p8` key, note Key ID + Team ID. Generate the ES256
    client-secret JWT and set Supabase Function Secrets `APPLE_CLIENT_SECRET` /
    `APPLE_SERVICE_ID` / `APPLE_KEY_ID` (per 70-01). (Needed for OAuth, not the build.)
A5. **[YOU]** APNs: create a **Push Notifications key/cert** for `app.leanshot.ios`
    (needed for iOS push delivery UAT).
A6. **[YOU]** Apple ID **app-specific password** (https://appleid.apple.com → Sign-In &
    Security) → GitHub secret `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD`.
A7. **[YOU, local machine w/ write access]** Initialize signing via fastlane match:
    create/confirm the private repo `pallefar/leanshot-fastlane-match`, then
    `cd leanshot && bundle exec fastlane match appstore` (generates the distribution cert
    + provisioning profile, encrypts them into the match repo). Choose a match passphrase.
A8. **[YOU]** Set GitHub repo secrets (Settings → Secrets and variables → Actions):
    `FASTLANE_USER` (Apple ID email), `FASTLANE_TEAM_ID` (from A1),
    `MATCH_GIT_BASIC_AUTHORIZATION` (base64 of `username:PAT` for the match repo),
    `MATCH_PASSWORD` (A7 passphrase),
    `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD` (A6),
    `APPLE_CERTIFICATE_BASE64` (if the Fastfile imports a cert directly — confirm vs match).
A9. **[ME]** Replace `TEAMID` placeholder in `public/.well-known/apple-app-site-association`
    with your real Team ID (A1).

## Phase B — Google Play Console

B1. **[YOU]** Confirm Play Console membership. All apps → Create app: name "LeanShot",
    default language, app/game = App, free/paid. Package is set at first upload as
    **`app.leanshot.android`**.
B2. **[YOU]** Create a **Closed/Internal testing** track (Testing → Internal testing).
B3. **[YOU, local]** Generate an **upload keystore** (JKS):
    `keytool -genkey -v -keystore leanshot-upload.jks -alias leanshot -keyalg RSA -keysize 2048 -validity 10000`.
    Then `base64 -i leanshot-upload.jks` → GitHub secrets:
    `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` (`leanshot`), `KEY_PASSWORD`.
B4. **[YOU]** Play **service account** for CI publishing: Google Cloud Console → IAM →
    Service Accounts → create → grant the JSON key; in Play Console → Users & permissions
    → invite the service-account email with release permissions on the app. Set the JSON
    as GitHub secret `PLAY_SERVICE_ACCOUNT_JSON`.
B5. **[YOU]** After the first AAB is processed, Play **App Signing** page shows the app
    signing **SHA-256/SHA-1** → hand me the SHA-256.
B6. **[ME]** Replace the placeholder in `public/.well-known/assetlinks.json` with the real
    SHA-256 (B5).
B7. **[YOU]** Fill the **Data safety** form using `apps/android/data-safety.md`; complete
    the store listing (graphics, descriptions already in `fastlane/metadata/android`).

## Phase C — CI wiring (mostly [ME])

C1. **[ME]** Create `.github/workflows/mobile-ios.yml` + `mobile-android.yml`: an
    always-green **unsigned build** job (no secrets) + a **gated sign-and-upload** job
    (`if` secrets present) calling `upload_testflight` / `upload_play`. (Lanes already
    exist; per `fastlane/README.md`, this is the documented missing piece.)
C2. **[ME]** Verify the Phase-71 `sync-store-release-notes.mjs` step runs before the
    upload lanes (wired in PR #9) and that `SUPABASE_*` env is available in those jobs.
C3. **[YOU/ME]** First **local** validation (no secrets):
    `cd leanshot && npm ci && npm run build && npx cap sync ios && bundle exec fastlane ios build_ios_unsigned`
    (and the android equivalent) — confirms Xcode/Gradle wiring before secrets land.

## Phase D — First uploads
- Once A8 secrets set → CI `upload_testflight` produces the TestFlight build.
- Once B3+B4 secrets set → CI `upload_play` pushes the internal-testing AAB.
- These satisfy the Phase-70 `70-04`/`70-05` iOS/Android device-UAT signals.

## Sequencing / dependencies
- A1 (Team ID) gates A9 + A8; B5 (SHA) gates B6 — so do A1 and B1–B5 early.
- C1 can be done now (no secrets needed for the unsigned job).
- AdMob (`70-01` S18) + the VR-baseline/E2E work are SEPARATE tracks (see handoff).

## Immediate next actions
- **[YOU]** Start Phase A (A1 Team ID) + Phase B (B1 create app). Hand me the Team ID + Play SHA when you have them.
- **[ME, can start now]** C1 — author the two mobile CI workflow YAMLs (no secrets required), and A9/B6 placeholder substitutions once you provide the values.
