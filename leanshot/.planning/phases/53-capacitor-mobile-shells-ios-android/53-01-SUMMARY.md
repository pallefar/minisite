---
phase: 53-capacitor-mobile-shells-ios-android
plan: "01"
subsystem: mobile-ci
tags: [fastlane, ios, android, store-metadata, privacy-labels, ci-toolchain]
dependency_graph:
  requires: []
  provides:
    - leanshot/fastlane/Fastfile (lane contract: build_ios_unsigned, build_android_unsigned, upload_testflight, upload_play)
    - leanshot/fastlane/Gemfile (pinned fastlane ~> 2.222)
    - leanshot/fastlane/Appfile (app.leanshot.ios / app.leanshot.android bundle IDs)
    - leanshot/fastlane/Matchfile (pallefar/leanshot-fastlane-match, readonly, Phase 70 TODO)
    - leanshot/fastlane/metadata/ios/en-US/ (5 store-listing text files)
    - leanshot/fastlane/metadata/android/en-US/ (3 store-listing text files)
    - leanshot/apps/ios/marketing/privacy-nutrition-labels.md (Apple + Google nutrition-label cross-reference)
    - leanshot/fastlane/README.md (operator runbook + Phase 70 deferral matrix)
  affects:
    - .github/workflows/mobile-ios.yml (plan 53-03 consumes lane names)
    - .github/workflows/mobile-android.yml (plan 53-03 consumes lane names)
tech_stack:
  added:
    - fastlane ~> 2.222 (RubyGems, CI-only)
  patterns:
    - Fastlane lane-contract pattern (unsigned always-green / signed gated on GitHub Secrets)
    - fastlane match readonly pattern (cert repo provisioning deferred to Phase 70)
    - Store-metadata-as-committed-text-files pattern (fastlane deliver reads from metadata/ dirs)
key_files:
  created:
    - leanshot/fastlane/Gemfile
    - leanshot/fastlane/Appfile
    - leanshot/fastlane/Matchfile
    - leanshot/fastlane/Fastfile
    - leanshot/fastlane/metadata/ios/en-US/description.txt
    - leanshot/fastlane/metadata/ios/en-US/keywords.txt
    - leanshot/fastlane/metadata/ios/en-US/release_notes.txt
    - leanshot/fastlane/metadata/ios/en-US/privacy_url.txt
    - leanshot/fastlane/metadata/ios/en-US/support_url.txt
    - leanshot/fastlane/metadata/android/en-US/title.txt
    - leanshot/fastlane/metadata/android/en-US/short_description.txt
    - leanshot/fastlane/metadata/android/en-US/full_description.txt
    - leanshot/fastlane/README.md
    - leanshot/apps/ios/marketing/privacy-nutrition-labels.md
  modified: []
decisions:
  - "Fastfile comments avoid mentioning rejected dependency-manager names directly (per feedback_negation_grep_defeated_by_comment_string) — guards remain clean for CI grep-based enforcement"
  - "Matchfile uses readonly:true to prevent CI from ever writing new certs to the match repo"
  - "Metadata copy sourced verbatim from apps/android/store-listing-en.md — no new marketing copy invented"
  - "privacy-nutrition-labels.md is a cross-reference doc only — does not duplicate or replace PrivacyInfo.xcprivacy or data-safety.md"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-25T09:41:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 14
  files_modified: 0
---

# Phase 53 Plan 01: fastlane toolchain + store metadata + privacy nutrition labels — Summary

**One-liner:** Fastlane Gemfile/Appfile/Matchfile/Fastfile lane-contract scaffold with four CI-contract lanes (unsigned always-green, signed/upload gated on GitHub Secrets) plus App Store + Play Store metadata text files and an Apple/Google privacy nutrition-label cross-reference doc.

---

## What Was Built

### Task 1: fastlane core scaffold (commit a5815443)

Four fastlane configuration files implementing the lane contract that plan 53-03 CI workflows will consume:

- **Gemfile** — pins `fastlane ~> 2.222` from rubygems.org for reproducible CI installs
- **Appfile** — `app_identifier("app.leanshot.ios")` + `package_name("app.leanshot.android")`; apple_id/team_id delegated to ENV (never hardcoded, Phase 70 TODO)
- **Matchfile** — git_url `pallefar/leanshot-fastlane-match`, type `appstore`, storage_mode `git`, readonly `true`; Phase 70 TODO comment explaining inert-until-provisioned status
- **Fastfile** — four contract lanes:
  - `platform :ios / lane :build_ios_unsigned` — gym with `skip_codesigning:true`, workspace `apps/ios/App/App.xcodeproj/project.xcworkspace`, scheme App, configuration Release; always-runnable
  - `platform :ios / lane :upload_testflight` — match(appstore, readonly) + gym(app-store export) + pilot(skip_waiting_for_build_processing:true); gated, CI caller responsible for secret presence
  - `platform :android / lane :build_android_unsigned` — gradle(bundle, Release, project_dir:apps/android/) with empty injected signing properties; always-runnable
  - `platform :android / lane :upload_play` — supply(internal, json_key_data: ENV["PLAY_SERVICE_ACCOUNT_JSON"]); gated

SPM project — no native package-manager install steps of any kind.

### Task 2: store metadata + privacy nutrition labels + runbook (commit dbc34163)

**iOS metadata** (`fastlane/metadata/ios/en-US/`):
- `description.txt` — full App Store description (sourced from `apps/android/store-listing-en.md`)
- `keywords.txt` — GLP-1 / semaglutide / tirzepatide / injection-tracker keyword set
- `release_notes.txt` — initial release notes
- `privacy_url.txt` — `https://app.leanshot.app/privacy`
- `support_url.txt` — `https://app.leanshot.app/support`

**Android metadata** (`fastlane/metadata/android/en-US/`):
- `title.txt` — "LeanShot: GLP-1 Tracker"
- `short_description.txt` — sourced from `apps/android/store-listing-en.md` short description
- `full_description.txt` — sourced verbatim from `apps/android/store-listing-en.md`

**Privacy nutrition labels** (`apps/ios/marketing/privacy-nutrition-labels.md`):
- Cross-reference table mapping all 6 `NSPrivacyCollectedDataType` entries from `PrivacyInfo.xcprivacy` to their Apple App Privacy label categories and "Linked to Identity" + "Tracking" values
- Cross-reference table mapping each Play Data Safety row (from `data-safety.md`) to its iOS counterpart, including which third-party processor receives the data
- 4 NSPrivacyAccessedAPIType entries with reason codes
- Phase 70 deferral notes for TEAMID + SHA256 substitution and form submission steps

**Runbook** (`fastlane/README.md`):
- `npm ci --legacy-peer-deps` requirement and why (sentry/capacitor sibling-check)
- Screenshot placeholders location (`apps/ios/marketing/screenshots/en-US/`, 9 PNGs)
- Phase 70 deferral matrix — 11 gated items listed with current state and required Phase 70 action

---

## Phase 70 Deferral List

The following items are explicitly Phase-70-gated (NOT simplified, NOT deferred as "placeholder-for-now"):

| Item | Gating Secret(s) |
|---|---|
| Signed iOS IPA | `APPLE_CERTIFICATE_BASE64` |
| TestFlight first build | `APPLE_CERTIFICATE_BASE64` + `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD` |
| Signed Android AAB | `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` |
| Play internal-track first build | `PLAY_SERVICE_ACCOUNT_JSON` |
| Apple Team ID substitution in AASA | Developer enrollment → `FASTLANE_TEAM_ID` secret |
| Play App Signing SHA256 substitution in assetlinks.json | Play Console App Signing fingerprint |
| fastlane match repo provisioning | `MATCH_GIT_BASIC_AUTHORIZATION` + `MATCH_PASSWORD` |
| Real Apple ID + Team ID in CI | `FASTLANE_USER` + `FASTLANE_TEAM_ID` |
| App Store Privacy Questionnaire submission | Manual at submission time |
| Play Data Safety form submission | Manual at submission time |
| Real screenshots | Replace 9 placeholder PNGs |

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed "cocoapods" keyword from Fastfile comment**
- **Found during:** Task 1 verification
- **Issue:** The plan's `<verify>` automated check uses `! grep -riq 'pod install\|cocoapods' fastlane/` to assert no pod-install references exist. The initial Fastfile comment included the word "CocoaPods" as a warning (which is the correct project-safety intent), but the case-insensitive negation grep matched the word in the comment, causing the verification to fail. This is the known `feedback_negation_grep_defeated_by_comment_string` pattern.
- **Fix:** Rewrote the comment to explain the SPM requirement without using the rejected-alternative package manager name. The safety intent is preserved in the README runbook where the restriction is documented in prose.
- **Files modified:** `leanshot/fastlane/Fastfile`
- **Commit:** a5815443 (included in Task 1 commit, fixed before staging)

---

## Known Stubs

None — all files contain substantive content. The `metadata/` text files contain real product copy sourced from `apps/android/store-listing-en.md`. No hardcoded empty values or placeholder text exists that would prevent the plan's goal from being achieved.

---

## Threat Flags

No new threat surface introduced. All files contain zero secrets. Committed files follow the T-53-01 / T-53-02 mitigations from the plan threat model: no real Apple Team ID, no service-account JSON, no cert material; upload lanes are inert until CI secrets are set.

---

## Self-Check: PASSED

All 14 created files verified present on disk. Both task commits (a5815443, dbc34163) verified in git log.
