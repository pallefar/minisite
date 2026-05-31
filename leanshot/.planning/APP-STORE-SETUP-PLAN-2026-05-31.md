# App-Store Setup Plan — Apple Developer + Google Play Console

**Created:** 2026-05-31 · For: LeanShot first store uploads (TestFlight + Play internal-testing).

You have **both accounts** (Apple Developer + Play Console). This plan is a sequential
runbook. Each step is tagged **[YOU]** (console/credential action only you can do) or
**[ME]** (code/CI I can do in-repo, often after you hand me one value).

> **STATUS UPDATE 2026-05-31 (correcting this plan):** The two CI items below
> (C1, C2) turned out to be ALREADY DONE — this plan's original "What's MISSING"
> was stale. `mobile-{ios,android}.yml` were shipped in **Phase 53** (`53-03`,
> commits `4d80fbd8`/`d0a4d01d` + fixes `d9ba45ba`/`588e22b7`) and the Phase-71
> release-notes sync is wired **inside the Fastfile** (`upload_testflight` +
> `upload_play`), not the workflow YAML. **A1 done** (Team ID `XCZMRC727Z`).
> **A9 done** — committed on branch `chore/app-store-config`. The only remaining
> **[ME]** substitution is **B6** (Play SHA-256 → `assetlinks.json`), which is
> blocked until a real AAB is built+processed on Play. Everything else is **[YOU]**
> console/secrets work (Apple A2–A8, Play B1–B7) + AdMob.

## What already exists (don't rebuild)
- Capacitor 8 native projects: `leanshot/apps/ios/` + `leanshot/apps/android/`.
- Bundle IDs: **`app.leanshot.ios`** (iOS) / **`app.leanshot.android`** (Android) — set in `Appfile`.
- Fastlane lanes (`leanshot/fastlane/Fastfile`): `build_ios_unsigned`, `upload_testflight`, `build_android_unsigned`, `upload_play`. Upload lanes are GATED on secrets (inert until set).
- `fastlane match` config (`Matchfile`): cert repo `pallefar/leanshot-fastlane-match`, `type appstore`, `readonly`.
- Store metadata: `leanshot/fastlane/metadata/{ios,android}/…` (descriptions, release_notes). Phase-71 sync script writes release notes into these at release time.
- Privacy/data-safety source docs: `apps/ios/marketing/privacy-nutrition-labels.md`, `apps/android/data-safety.md`.
- Phase-70 `70-01-PLAN-vendor-oauth-secrets.md` + `fastlane/README.md` §"Phase 70 Deferral Matrix" = the canonical secret/operator checklist.

## What's MISSING (gaps this plan closes)
- ~~`.github/workflows/mobile-ios.yml` + `mobile-android.yml`~~ — **ALREADY EXIST** (Phase 53, git-root `.github/workflows/`): unsigned always-green job + gated upload job. ~~**[ME]**~~ ✅ DONE.
- Placeholder substitutions:
  - `TEAMID` in `public/.well-known/apple-app-site-association` → ✅ **DONE 2026-05-31** (real Team ID `XCZMRC727Z`, branch `chore/app-store-config`).
  - Play signing SHA-256 in `public/.well-known/assetlinks.json` → ⏳ **[ME, once you give the value]** — still `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_AT_PLAN_16_09`; needs B5.
- All signing secrets in GitHub repo settings. **[YOU]**

---

## Phase A — Apple Developer + App Store Connect

A1. ✅ **DONE 2026-05-31** — Apple Developer membership active; **Team ID `XCZMRC727Z`**.
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
A9. ✅ **DONE 2026-05-31** — `TEAMID` → `XCZMRC727Z` in both AASA entries (appID + webcredentials.apps), JSON validity verified. Committed on branch `chore/app-store-config`.

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

C1. ✅ **ALREADY DONE (Phase 53, `53-03`).** `.github/workflows/mobile-ios.yml` +
    `mobile-android.yml` exist at the git root: each has an always-green **unsigned
    build** job (no secrets) + a **gated sign-and-upload** job using the secret→env
    `if:` trick, calling `upload_testflight` / `upload_play`. Lane names match the
    Fastfile contract. Hardened by `d9ba45ba`/`588e22b7` (web-asset build, keystore
    decode, FASTLANE env, job-level concurrency). **Nothing to author.**
C2. ✅ **ALREADY DONE (Phase 71, `71-02`).** `sync-store-release-notes.mjs` runs
    **inside the Fastfile** — `sh("node", "scripts/sync-store-release-notes.mjs")` in
    both `upload_testflight` and `upload_play`, BEFORE the build/upload steps — not as
    a workflow-YAML step. ⚠️ Open follow-up: the script needs `SUPABASE_URL` +
    `SUPABASE_SERVICE_ROLE` in the upload-job env (Phase-71 go-live item) and the
    `admin.product-updates.enabled` flag for published entries to exist.
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

## Immediate next actions (revised 2026-05-31)
- ✅ A1 + A9 done. C1 + C2 were already done (Phase 53 / Phase 71). The in-repo CI/config
  path is essentially complete.
- **[YOU]** The remaining path to first uploads is almost entirely console + secrets:
  - Apple: A2–A8 (App ID, ASC app record, Sign in with Apple Services ID, APNs key,
    app-specific password, `fastlane match` init, GitHub signing secrets incl.
    `FASTLANE_TEAM_ID=XCZMRC727Z`).
  - Play: B1–B7 (create app, internal track, upload keystore, service account,
    first AAB → App Signing SHA-256, Data-safety form).
- **[ME]** Only B6 left — substitute the Play SHA-256 into `assetlinks.json` once you
  hand me the value from B5.
