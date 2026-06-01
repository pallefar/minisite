# Push the FIRST TEST build to Play Console (internal testing) + Apple TestFlight

**Created:** 2026-06-01 · **Goal:** get ONE signed build onto each store's test track —
Android **Play internal testing**, iOS **TestFlight**.

This runbook BUILDS ON the prior `APP-STORE-SETUP-PLAN-2026-05-31.md` (which is still
accurate as a credential map) — it does **not** restate Sign-in-with-Apple OAuth, APNs,
or AdMob, which are separate tracks. Read that file for the broader checklist; this one
is the focused "first test build" path with the exact command/click sequence per platform.

## Legend
- **[ME]** = in-repo code/CI change I (Claude) can make, sometimes after you hand me one value.
- **[YOU]** = console / credential action only the operator can do (Apple Developer, App Store
  Connect, Play Console, Google Cloud, GitHub repo Secrets).
- **DONE-in-repo** = already committed, no action.

> **Branch note:** this is verified against the **current checkout** (`chore/launch-readiness`).
> MEMORY claims the Apple Team ID `XCZMRC727Z` and several fixes landed on
> `chore/app-store-config` / PR #11 — **they are NOT on this branch.** Every `[ME]` item
> below was confirmed *not present* by reading the actual files today (see §6). Treat the
> Team ID `XCZMRC727Z` as the value to write, not as already-written.

---

## 1. Prereqs / accounts

| Prereq | Status | Notes |
|---|---|---|
| Apple Developer Program membership | ✓ **available** | Team ID **`XCZMRC727Z`** (operator-confirmed). |
| Apple Paid-Apps / free-app agreement active in App Store Connect | **[YOU] verify** | TestFlight upload is blocked until the **latest** Program License Agreement is accepted (App Store Connect → Business / Agreements). |
| Google Play Console membership | ✓ **available** | $25 one-time reg already paid (account exists). |
| A macOS machine with Xcode (for the one-time `match` seeding) | **[YOU]** | Needed once to create the iOS distribution cert/profile (CI is `readonly`). |
| `keytool` + `base64` (JDK + coreutils, on any machine) | **[YOU]** | Needed once to mint the Android upload keystore. |
| GitHub repo admin (to set Actions Secrets) | **[YOU]** | All signing creds are consumed as GitHub Secrets by the two workflows. |

**Native scaffolding that already exists (DONE-in-repo — do not rebuild):**
- Capacitor projects: `leanshot/apps/ios/`, `leanshot/apps/android/` (non-default paths,
  wired via `leanshot/capacitor.config.ts` `ios.path`/`android.path`).
- Bundle IDs: iOS `app.leanshot.ios` (+ watch `app.leanshot.ios.watchkitapp` + widget
  `…watchkitapp.widget`), Android `app.leanshot.android`.
- Fastlane lanes `leanshot/fastlane/Fastfile`: `build_*_unsigned` (CI-green) + gated
  `upload_testflight` / `upload_play`.
- CI workflows `.github/workflows/mobile-ios.yml` + `mobile-android.yml` (unsigned job
  always green; signed job secret-gated).
- Store metadata `leanshot/fastlane/metadata/{ios,android}/en-US/`.
- Deep-link files `leanshot/public/.well-known/apple-app-site-association` + `assetlinks.json`
  (both still carry **placeholders** — see §6).

---

## 2. Credentials to mint (and the exact CI Secret name each maps to)

These are the GitHub Actions Secrets the two workflows + the `Fastfile` read. Set them at
**GitHub → repo → Settings → Secrets and variables → Actions → New repository secret.**
Until the **gate** secrets exist the signed jobs are skipped (the workflows gate via
`if: env.<SECRET> != ''`), so the build jobs stay green and the upload jobs simply don't run.

### Apple (→ TestFlight)
| Mint where | Secret name | Notes |
|---|---|---|
| **App Store Connect → Users and Access → Integrations → App Store Connect API → +** | (see below) | Create a **Team key** with role **App Manager** (or Admin). Download the `.p8` **once** (one-time download). Record **Issuer ID** + **Key ID**. |
| Apple ID email | `FASTLANE_USER` | The Apple ID used for App Store Connect. |
| Team ID | `FASTLANE_TEAM_ID` | = **`XCZMRC727Z`**. Read at runtime by `fastlane/Appfile` (intentionally not committed). |
| `match` git repo PAT | `MATCH_GIT_BASIC_AUTHORIZATION` | base64 of `username:PAT` for the private cert repo `pallefar/leanshot-fastlane-match`. `echo -n 'user:PAT' \| base64`. |
| `match` passphrase | `MATCH_PASSWORD` | Chosen during the one-time `fastlane match appstore` seeding (§4 step iOS-2). |
| appleid.apple.com → Sign-In and Security → App-Specific Passwords | `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD` | Used by `pilot` (TestFlight upload) to auth the Apple ID. |
| (optional, only if you sign via a raw cert instead of `match`) | `APPLE_CERTIFICATE_BASE64` | This is the **gate-trigger** secret for the iOS job (`if: env.APPLE_CERTIFICATE_BASE64 != ''`). **You must set it even when using `match`** — set it to the base64 of the distribution `.p12`, OR see §5 note: the simplest path is to set it as the gate flag while letting `match` do the real signing. |

> **App Store Connect API key vs `FASTLANE_USER`/app-specific-password:** the `Fastfile`
> currently auths `pilot` via the Apple-ID + app-specific-password path (`FASTLANE_USER` +
> `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD`). The App Store Connect API `.p8` key is the
> more robust route and is recommended; if you go that way, set `APP_STORE_CONNECT_API_KEY_*`
> env (issuer/key-id/key-content) and I will wire `app_store_connect_api_key(...)` into the
> lane — flag me to do it ([ME]).

### Google Play (→ internal testing)
| Mint where | Secret name | Notes |
|---|---|---|
| Local machine: `keytool` (§3 step A-3) | `KEYSTORE_BASE64` | base64 of the upload keystore `leanshot-release.jks`. **Gate-trigger** for the Android job. |
| keystore store password | `KEYSTORE_PASSWORD` | chosen during keystore creation. |
| key alias | `KEY_ALIAS` | use `leanshot`. |
| key password | `KEY_PASSWORD` | chosen during keystore creation. |
| **Google Cloud Console → IAM and Admin → Service Accounts** → create → **Keys → Add key → JSON** | `PLAY_SERVICE_ACCOUNT_JSON` | paste the whole JSON file content. **Gate-trigger** for upload. Then in **Play Console → Users and permissions → Invite** that service-account email and grant **Release apps to testing tracks** (account-level or app-level). |

> **Play service account — exact path:** Google Cloud project → enable **Google Play Android
> Developer API** → Service Accounts → create (no GCP IAM role needed) → Keys → JSON. Then
> grant *Play Console* permissions to that SA email **inside Play Console** (not GCP IAM).

### Release-notes sync (both platforms, optional but recommended)
| Mint where | Secret name | Notes |
|---|---|---|
| Supabase project settings | `SUPABASE_URL` (or `VITE_SUPABASE_URL`) | `leanshot/scripts/sync-store-release-notes.mjs` runs at the top of BOTH upload lanes. |
| Supabase project settings → API | `SUPABASE_SERVICE_ROLE_KEY` | reads `changelog_entries`. **Fail-soft:** if unset OR no matching published entry exists, the script exits 0 and leaves committed metadata untouched (see §6 version-mismatch risk). |

---

## 3. Android → Play internal track

Ordered. The single biggest blocker is **A-5 → A-6 (Play App Signing SHA-256 →
`assetlinks.json`)**, which is a chicken-and-egg: you can't get the SHA until the first AAB
is uploaded, and App Links won't verify until the SHA is in the served file.

| Step | Who | Action |
|---|---|---|
| **A-1** | **[YOU]** | **Create the app** in Play Console → All apps → **Create app**. Name "LeanShot", default language en-US, type **App**, **Free**. The package name `app.leanshot.android` is bound at first upload (from `leanshot/apps/android/app/build.gradle` `applicationId`). |
| **A-2** | **[YOU]** | **Create the Internal testing track:** Play Console → Testing → **Internal testing** → create a release (you'll attach the AAB in A-4). |
| **A-3** | **[YOU]** | **Mint the upload keystore** (local, once): `keytool -genkey -v -keystore leanshot-release.jks -alias leanshot -keyalg RSA -keysize 2048 -validity 10000`. Then `base64 -i leanshot-release.jks \| pbcopy`. Set GitHub Secrets `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS=leanshot`, `KEY_PASSWORD`. **Keep `leanshot-release.jks` safe** — losing it locks you out of upload-key rotation. |
| **A-3b** | **[ME]** | **Bump the Android version BEFORE building** — `versionCode` is still `1` / `versionName "1.0"` in `apps/android/app/build.gradle` (confirmed today). Every upload to Play needs a unique `versionCode`. I'll set `versionCode 2` (or higher) + `versionName "2.0.0"` to match `package.json` (see §6 version-mismatch). **Tell me to bump it.** |
| **A-4** | **[YOU]** / CI | **Build the signed AAB + upload.** Two routes — pick one: <br>• **CI (preferred, once secrets in A-3 + `PLAY_SERVICE_ACCOUNT_JSON` are set):** push any commit touching `leanshot/apps/android/**` (or the workflow) to `main` → `.github/workflows/mobile-android.yml` runs `upload_play` → uploads to the **internal** track automatically. <br>• **Local manual:** `cd leanshot && npm ci --legacy-peer-deps && npm run build && npx cap sync android`, then either `BUNDLE_GEMFILE=fastlane/Gemfile bundle exec fastlane upload_play` (needs the §6 Gemfile fix + env vars) **or** the no-fastlane fallback: `cd leanshot/apps/android && ./gradlew bundleRelease -Pandroid.injected.signing.store.file=$PWD/app/leanshot-release.jks -Pandroid.injected.signing.store.password=… -Pandroid.injected.signing.key.alias=leanshot -Pandroid.injected.signing.key.password=…` → upload `app/build/outputs/bundle/release/app-release.aab` **by hand** in the Play Console internal-testing release. |
| **A-5** | **[YOU]** | **Enroll Play App Signing** (offered automatically at first upload — accept it) → after the AAB is processed, **Play Console → Test and release → Setup → App signing** shows the **App signing key SHA-256**. **Copy that SHA-256 and hand it to me.** |
| **A-6** | **[ME]** | **Paste the SHA-256 into `leanshot/public/.well-known/assetlinks.json`**, replacing the literal `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_AT_PLAN_16_09` (confirmed still present today). Then **[YOU]** redeploy the web app so the served `.well-known/assetlinks.json` updates (Vercel). Android App Links won't verify until this ships. |
| **A-7** | **[YOU]** | **Add testers:** Internal testing track → **Testers** → create/select an email list (up to 100). Share the opt-in URL. Roll out the release. |
| **A-8** | **[YOU]** | **Data safety form** — required before the track is usable to testers in some cases and before any production promotion. Copy-paste from `leanshot/apps/android/data-safety.md` (complete, v1.2). |

---

## 4. iOS → TestFlight

Ordered. The single biggest blocker is **signing**: the Xcode project has **no
`DEVELOPMENT_TEAM`** and uses `CODE_SIGN_STYLE=Automatic` + a *development* identity, which
is **incompatible** with the `match(type:appstore, readonly:true)` flow the `upload_testflight`
lane uses (see §6). You must seed `match` once and reconcile signing.

| Step | Who | Action |
|---|---|---|
| **I-1** | **[YOU]** | **Register the App ID** (if not done): Apple Developer → Certificates, Identifiers and Profiles → Identifiers → **+** → App IDs → App → **explicit** `app.leanshot.ios`. (The watch app `app.leanshot.ios.watchkitapp` + widget `…watchkitapp.widget` also need App IDs **if** you ship those targets in the archive — for a first TestFlight build you can leave the watch targets out, but the archive currently includes them, so register all three or have me strip the watch/widget from the archived scheme: **[ME]** if needed.) Enable Associated Domains (for the universal links). |
| **I-2** | **[YOU]** | **Create the App Store Connect app record:** App Store Connect → Apps → **+** → New App → platform iOS, name "LeanShot", primary language, Bundle ID `app.leanshot.ios`, SKU `leanshot-ios`. |
| **I-3** | **[YOU, mac]** | **Seed `fastlane match`** (one-time, CI is read-only): create the private repo `pallefar/leanshot-fastlane-match` (verify the org spelling — `Matchfile` says **`pallefar`**, MEMORY notes a `pallefat` PostHog org; they differ). Then `cd leanshot && BUNDLE_GEMFILE=fastlane/Gemfile bundle exec fastlane match appstore` with `FASTLANE_USER`/`FASTLANE_TEAM_ID=XCZMRC727Z` set. This generates the **Apple Distribution** cert + **App Store** provisioning profile and encrypts them into the match repo. Choose the `match` passphrase → `MATCH_PASSWORD`. |
| **I-4** | **[ME]** | **Fix the Xcode signing config** so CI archiving works with `match`. The project has no `DEVELOPMENT_TEAM` and `CODE_SIGN_IDENTITY='iPhone Developer'` (development). I'll add `DEVELOPMENT_TEAM = XCZMRC727Z`, switch to **manual** signing with the match-provisioned **App Store** profile + `CODE_SIGN_IDENTITY='Apple Distribution'` (or have `gym` override via `export_options`/`xcargs`). **Tell me to do this** — it's the load-bearing iOS code fix. |
| **I-5** | **[ME]** | **Fill the AASA Team ID:** replace `TEAMID` with `XCZMRC727Z` in `leanshot/public/.well-known/apple-app-site-association` (both `appID` and `webcredentials`, confirmed still `TEAMID` today). Then **[YOU]** redeploy the web app (Vercel) so the served file updates — Universal Links + passkeys won't validate until then. |
| **I-6** | **[YOU]** | **Set the GitHub Secrets** from §2 (Apple block), including the gate-trigger `APPLE_CERTIFICATE_BASE64` and `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD`. |
| **I-7** | **[YOU]** / CI | **Archive + upload.** Routes: <br>• **CI (preferred):** push a commit touching `leanshot/apps/ios/**` (or the workflow) to `main` → `mobile-ios.yml` runs `setup_ci` then `upload_testflight` → `match` (fetch) → `gym` (app-store archive) → `pilot` (TestFlight). Requires §6 Gemfile fix + I-4 signing fix. <br>• **Local manual:** `cd leanshot && npm ci --legacy-peer-deps && npm run build && npx cap sync ios && BUNDLE_GEMFILE=fastlane/Gemfile bundle exec fastlane upload_testflight`. <br>• **Transporter fallback (no fastlane):** open `apps/ios/App/App.xcworkspace` in Xcode → set team `XCZMRC727Z` → Product → Archive → Distribute App → App Store Connect → Upload (or export the `.ipa` and drag into **Transporter.app**). |
| **I-8** | **[YOU]** | **Export compliance:** first TestFlight build prompts the encryption question. LeanShot uses only standard HTTPS/TLS → answer **"uses encryption" = standard exemption** (or, to avoid the per-build prompt, **[ME]** add `ITSAppUsesNonExemptEncryption = false` to `apps/ios/App/App/Info.plist`). |
| **I-9** | **[YOU]** | **Add internal testers:** App Store Connect → TestFlight → Internal Testing → add yourself/team to a group. Internal testers get the build immediately after processing (no Beta App Review). External testers require Beta App Review. |

---

## 5. Fastest path (minimal sequence to ONE build on each test track)

Assumes you do the smallest thing that gets a green upload. The fastest route **avoids CI
signing pitfalls by uploading manually** for the very first build, then switches to CI.

### Android — fastest (manual upload, ~30 min)
1. **[YOU]** A-1 create app + A-2 internal track in Play Console.
2. **[ME]** A-3b bump `versionCode`/`versionName` (one-line edit) — ask me.
3. **[YOU]** A-3 mint keystore locally.
4. **[YOU]** Local build with the **gradlew fallback** in A-4 (no fastlane, no service
   account needed for a manual upload) → drag the `.aab` into the Play Console release.
5. **[YOU]** A-5 accept Play App Signing → copy the SHA-256 → hand to me → **[ME]** A-6.
6. **[YOU]** A-7 add testers, A-8 data-safety form, roll out.

> **Biggest Android blocker:** the **SHA-256 → `assetlinks.json`** loop (A-5/A-6). It does
> NOT block the AAB upload or testers installing — it only blocks Android App Link
> verification (deep links opening the app instead of the browser). So you can ship the
> first internal build *before* fixing it; just don't forget to circle back + redeploy web.

### iOS — fastest (Xcode/Transporter, ~45 min)
1. **[YOU]** I-1 App ID + I-2 App Store Connect record + accept the latest Program License
   Agreement (TestFlight is silently blocked otherwise).
2. **[ME]** I-4 add `DEVELOPMENT_TEAM=XCZMRC727Z` + I-5 AASA + I-8 `Info.plist` encryption
   flag — ask me (these are all in-repo edits).
3. **[YOU]** Open `apps/ios/App/App.xcworkspace` in Xcode → select team `XCZMRC727Z` →
   Archive → Distribute → App Store Connect → Upload. (This uses Xcode automatic signing for
   the FIRST build — you can defer the whole `match`/CI setup, §2 Apple secrets + I-3, to
   *after* you've proven a build flows.)
4. **[YOU]** I-9 add yourself as an internal tester → install via TestFlight app.

> **Biggest iOS blocker:** **signing**. For CI it's `match` seeding (I-3) + the
> Automatic→manual/Distribution pbxproj reconciliation (I-4). For a one-off first build,
> **sidestep both** by archiving in Xcode with automatic signing — Apple mints the cert for
> you. Move to `match`+CI only once you want repeatable uploads.

### Then switch to CI (repeatable)
Once a manual build proves the pipeline, set ALL §2 secrets, do the §6 Gemfile fix + I-4,
seed `match` (I-3), and let `mobile-ios.yml` / `mobile-android.yml` do every subsequent
upload on push to `main`.

---

## 6. Gaps / risks (placeholders + blockers found in the repo today)

Verified by reading the actual files on `chore/launch-readiness` (not trusting MEMORY).

### Hard blockers for a CI signed upload
1. **Gemfile path mismatch — [ME], blocks BOTH CI upload jobs.** The only Gemfile is
   `leanshot/fastlane/Gemfile`; there is **no `leanshot/Gemfile`**. But `mobile-ios.yml`
   and `mobile-android.yml` run `ruby/setup-ruby@v1` with `bundler-cache: true` +
   `working-directory: leanshot`, then `bundle exec fastlane …` from `leanshot/`. Bundler
   will fail with **"Could not locate Gemfile"**. Fix (one of): add a `leanshot/Gemfile`
   (or symlink), OR set `BUNDLE_GEMFILE: leanshot/fastlane/Gemfile` env in the jobs, OR
   point setup-ruby `working-directory: leanshot/fastlane`. **The unsigned jobs don't use
   bundler, so this stays hidden until the signed job first runs.** Ask me to fix.
2. **iOS signing config — [ME], blocks iOS archive.** `apps/ios/App/App.xcodeproj/project.pbxproj`
   has **no `DEVELOPMENT_TEAM`** (grep = 0) and `CODE_SIGN_STYLE=Automatic` +
   `CODE_SIGN_IDENTITY='iPhone Developer'` (a *development* identity) — incompatible with
   `match(type:appstore)`. Needs `DEVELOPMENT_TEAM=XCZMRC727Z` + manual signing/Distribution,
   or a `gym` export-options override. (I-4.)
3. **`match` repo not seeded — [YOU], blocks iOS CI.** `Matchfile` is `readonly:true`; CI
   can't *create* certs. A developer must run `fastlane match appstore` once to seed
   `pallefar/leanshot-fastlane-match`. Verify the org name (`pallefar` vs `pallefat`).
4. **Android versionCode=1 — [ME], blocks 2nd+ Play upload.** `build.gradle` `versionCode 1`
   is never auto-bumped; every release collides on the same code. Bump before building. (A-3b.)

### Placeholders that must be filled (won't block upload, will break features)
5. **AASA Team ID — [ME].** `public/.well-known/apple-app-site-association` still literally
   `TEAMID.app.leanshot.ios`. → `XCZMRC727Z`. Universal Links/passkeys broken until fixed +
   web redeployed. (I-5.)
6. **assetlinks SHA-256 — [ME], blocked on A-5.** `public/.well-known/assetlinks.json` still
   `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_AT_PLAN_16_09`. Android App Links broken until the
   real Play App Signing SHA-256 is pasted + web redeployed. (A-6.)
7. **Release-notes version mismatch — [ME]/[YOU].** `scripts/sync-store-release-notes.mjs`
   matches `changelog_entries` on `package.json` version **`2.0.0`**, but `build.gradle` is
   `versionName "1.0"`/`versionCode 1`. The lookup will find **nothing** and the sync
   **silently no-ops** (fail-soft, exit 0) → iOS ships the generic `release_notes.txt`
   ("Initial release.") and Android writes/ships **no** `changelogs/<code>.txt` (the dir has
   only `.gitkeep`). To get real notes: reconcile versions (A-3b) AND **[YOU]** publish a
   `changelog_entry` whose `version` matches. Not a release blocker — placeholder notes ship.

### Operator console forms / questionnaires (not in repo)
8. **Apple Program License Agreement** — accept the latest in App Store Connect or TestFlight
   upload silently fails. **[YOU]**
9. **iOS export compliance** — answered per-build, or set `ITSAppUsesNonExemptEncryption`
   in `Info.plist`. **[YOU]/[ME]** (I-8.)
10. **Play Data Safety form** — copy from `apps/android/data-safety.md`. **[YOU]** (A-8.)
11. **App Privacy (iOS)** — `apps/ios/App/App/PrivacyInfo.xcprivacy` exists + CI-audited, but
    the App Store Connect **App Privacy** questionnaire is a separate console form. **[YOU]**

### Out of scope for "first test build" (separate tracks — do NOT block on these)
12. **Screenshots** — real PNGs exist at `apps/{ios,android}/marketing/screenshots/en-US/`
    but under a path `fastlane deliver`/`supply` does **not** read by default; they won't
    auto-upload. Not needed for TestFlight or Play **internal testing** (only for store
    *review*/production). Defer; upload manually in the consoles when promoting to production.
13. **RevenueCat IAP keys** — `VITE_RC_API_KEY_IOS`/`_ANDROID` declared-but-empty in
    `.env.example`; RC dashboard greenfield. IAP no-ops without them but the app/build is
    fine. See `REVENUECAT-READINESS-2026-05-31.md`. Defer.
14. **AdMob** — `VITE_ADMOB_*` referenced in `src/lib/native/ads.ts` /
    `src/components/ads/PlatformAdSlot.tsx` but **undeclared** in `.env.example` and **no**
    native `GADApplicationIdentifier` / Android `ads.APPLICATION_ID` wiring. Least-ready
    surface; explicitly a separate track. Defer.
15. **Firebase/push** — no `google-services.json` / `GoogleService-Info.plist`; build
    succeeds, FCM push no-ops. Not a store-submission blocker. Defer.

---

## What I (Claude) can do right now in-repo, on your word
- §6.1 Gemfile path fix (both CI jobs). · §6.2/I-4 iOS `DEVELOPMENT_TEAM`+signing.
- §6.4/A-3b Android version bump. · I-5 AASA `TEAMID→XCZMRC727Z`. · I-8 `Info.plist`
  encryption flag. · A-6 assetlinks SHA-256 (after you hand me the value from A-5).
- (Optional) wire App Store Connect API key auth into `upload_testflight` if you prefer the
  `.p8` route over app-specific-password.

## What only YOU can do (consoles/creds)
- All §2 GitHub Secrets. · A-1/A-2 Play app+track. · A-3 keystore mint. · A-5 SHA capture.
- A-7 testers. · A-8 data-safety. · I-1/I-2 Apple App ID + ASC record. · I-3 `match` seeding.
- I-6 secrets. · I-7 upload trigger. · I-8 export-compliance answer. · I-9 TestFlight testers.
- Apple Program License Agreement; iOS App Privacy questionnaire.
