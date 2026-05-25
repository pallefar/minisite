# LeanShot fastlane Runbook

This directory contains the fastlane build/signing/upload toolchain for the LeanShot
iOS and Android apps. It is consumed by the GitHub Actions CI workflows defined in
`.github/workflows/mobile-ios.yml` and `.github/workflows/mobile-android.yml`.

---

## Prerequisites

### Ruby and fastlane

The CI uses `ruby/setup-ruby@v1` (bundler cache enabled). Locally you can install
fastlane via:

```bash
cd leanshot/
bundle install   # reads fastlane/Gemfile — pins fastlane ~> 2.222
```

System Ruby (2.6.10) is sufficient for `bundle install` and `ruby -c` syntax checks.
The CI runner uses a newer Ruby via `ruby/setup-ruby`.

### npm install — REQUIRED flag

All CI steps and any local npm installs MUST use `--legacy-peer-deps`:

```bash
npm ci --legacy-peer-deps
```

Reason: `@sentry/capacitor` performs a sibling-check against `@sentry/react` at install
time. Without `--legacy-peer-deps`, `npm ci` aborts with a peer dependency error. This
flag is already present in the existing `.github/workflows/mobile-privacy-audit.yml` and
in `vercel.json installCommand`.

---

## Lane Reference

All lanes are defined in `fastlane/Fastfile`. The CI workflows invoke lanes by name —
these names are a stable contract and MUST NOT be renamed.

### iOS Lanes

| Lane | When to Run | Secrets Required |
|---|---|---|
| `build_ios_unsigned` | Every CI push | None — always green |
| `upload_testflight` | When Apple secrets present | `APPLE_CERTIFICATE_BASE64`, `MATCH_GIT_BASIC_AUTHORIZATION`, `MATCH_PASSWORD`, `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD`, `FASTLANE_USER`, `FASTLANE_TEAM_ID` |

**Run unsigned build locally (syntax verification only):**

```bash
cd leanshot/
bundle exec fastlane ios build_ios_unsigned
```

Note: local iOS builds require Xcode and the web assets to be synced first:

```bash
npm run build
npx cap sync ios
```

### Android Lanes

| Lane | When to Run | Secrets Required |
|---|---|---|
| `build_android_unsigned` | Every CI push | None — always green |
| `upload_play` | When Play secrets present | `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON` |

**Run unsigned build locally (requires Android SDK):**

```bash
cd leanshot/
npm run build
npx cap sync android
bundle exec fastlane android build_android_unsigned
```

Note: the Android SDK is not available locally on this project (ANDROID_HOME unset).
Android builds run on the ubuntu CI runner only.

---

## Store Metadata

Store metadata copy is committed in `fastlane/metadata/`:

```
fastlane/metadata/
  ios/en-US/
    description.txt      — App Store long description
    keywords.txt         — App Store search keywords
    release_notes.txt    — What's New for each release
    privacy_url.txt      — https://app.leanshot.app/privacy
    support_url.txt      — https://app.leanshot.app/support
  android/en-US/
    title.txt            — Play Store title
    short_description.txt — Play Store short description (80 chars)
    full_description.txt  — Play Store full description
```

### Screenshots

Placeholder screenshots (9 PNGs across 3 device sizes) live at:
`apps/ios/marketing/screenshots/en-US/`

These placeholders satisfy the fastlane `deliver` `screenshots_path` parameter.
Real device screenshots are deferred to Phase 70 as part of the store submission
and physical-device UAT milestone.

---

## Privacy Nutrition Labels

`apps/ios/marketing/privacy-nutrition-labels.md` cross-references:

- **Apple App Privacy:** `apps/ios/App/App/PrivacyInfo.xcprivacy` (6 collected-data types,
  4 required-API-reason entries)
- **Google Data Safety:** `apps/android/data-safety.md` (Play Console submission guide +
  per-category mapping)

The CI gate `scripts/audit-privacy-manifest.mjs` + `.github/workflows/mobile-privacy-audit.yml`
enforces the iOS manifest on every PR touching the 14-plugin set or the manifest file.

---

## Phase 70 Deferral Matrix

The following items are explicitly deferred to Phase 70 and require operator action
at that point. They are documented here so the operator has a complete checklist at
Phase 70 milestone start.

| Item | Status | Required Action at Phase 70 |
|---|---|---|
| Signed iOS IPA | Not yet built | Provision `APPLE_CERTIFICATE_BASE64` + `MATCH_*` secrets in GitHub; CI `upload_testflight` lane becomes active |
| TestFlight first build | Not yet uploaded | CI `upload_testflight` lane runs automatically once Apple secrets are present |
| Signed Android AAB | Not yet built | Provision `KEYSTORE_BASE64` + `KEYSTORE_PASSWORD` + `KEY_ALIAS` + `KEY_PASSWORD` secrets in GitHub; CI `upload_play` lane becomes active |
| Play internal-track first build | Not yet uploaded | Provision `PLAY_SERVICE_ACCOUNT_JSON` secret; CI `upload_play` lane runs automatically |
| Apple Team ID substitution | Placeholder `TEAMID` in `public/.well-known/apple-app-site-association` | Replace `TEAMID` with real Apple Team ID once Developer enrollment complete; also set `FASTLANE_TEAM_ID` GitHub secret |
| Play App Signing SHA256 substitution | Placeholder in `public/.well-known/assetlinks.json` | Replace placeholder with real SHA256 fingerprint from Play Console App Signing |
| fastlane match repo provisioning | `pallefar/leanshot-fastlane-match` may not be initialised | Run `bundle exec fastlane match init` locally; create encrypted cert repo; set `MATCH_GIT_BASIC_AUTHORIZATION` + `MATCH_PASSWORD` GitHub secrets |
| Real Apple ID + Team ID | Env-only (not committed) | Set `FASTLANE_USER` (Apple ID email) + `FASTLANE_TEAM_ID` as GitHub secrets |
| App Store Privacy Questionnaire | Not yet submitted | Complete using `apps/ios/marketing/privacy-nutrition-labels.md` Apple table |
| Play Data Safety form | Not yet submitted | Complete using `apps/android/data-safety.md` §8 submission instructions |
| Real screenshots | Placeholder PNGs at `apps/ios/marketing/screenshots/en-US/` | Replace 9 placeholder PNGs with real device screenshots for all 3 size classes |
| Physical-device UAT | Deferred | Test cold-launch, deep links, RevenueCat IAP, account deletion on real hardware |

---

## Signing Architecture

Signing is handled entirely by fastlane match. The match private cert repo URL is
`https://github.com/pallefar/leanshot-fastlane-match`. The `Matchfile` sets
`readonly: true` — CI never writes new certs; a developer with repo write access
manages them locally.

For Android, the Play keystore is stored as a base64-encoded GitHub Secret
(`KEYSTORE_BASE64`) and decoded at CI build time. It is never committed to the repo.

---

## Threat Model Notes

- `Appfile`, `Matchfile`, and `fastlane/metadata/` contain **zero secrets**. No
  Apple Team IDs, no service-account JSON, no certificates are committed.
- The `TEAMID` placeholder in `apple-app-site-association` is intentional. It is
  replaced at Phase 70 only after Apple Developer enrollment.
- Upload lanes are inert in CI until the corresponding GitHub Secrets are set. They
  cannot run accidentally.
- All npm install steps in mobile CI workflows use `--legacy-peer-deps` to avoid
  the `@sentry/capacitor` sibling-check install blocker.
