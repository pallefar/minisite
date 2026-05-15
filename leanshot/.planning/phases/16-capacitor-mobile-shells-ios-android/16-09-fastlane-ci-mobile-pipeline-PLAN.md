---
phase: 16-capacitor-mobile-shells-ios-android
plan: 09
type: execute
wave: 3
depends_on: [16-04, 16-07]
files_modified:
  - leanshot/fastlane/Fastfile
  - leanshot/fastlane/Matchfile
  - leanshot/fastlane/Appfile
  - leanshot/fastlane/Gemfile
  - leanshot/fastlane/Gemfile.lock
  - leanshot/apps/ios/App/fastlane/Fastfile
  - leanshot/apps/android/fastlane/Fastfile
  - .github/workflows/mobile.yml
  - leanshot/apps/ios/SECRETS.md
autonomous: false
requirements: [MOBILE-01, MOBILE-02, MOBILE-09]
tags: [fastlane, ci, ios-build, android-build, sentry-dsym, testflight, play-internal, match]
user_setup:
  - service: github-repo-leanshot-fastlane-match
    why: "fastlane match needs a private git repo to store encrypted code-signing artifacts (D-16)"
    account_setup:
      - task: "Create empty private GitHub repo `leanshot-fastlane-match` under same org as `pallefar/minisite` (or user's choice)"
        location: "https://github.com/new (Visibility: Private; Initialize: NO README)"
      - task: "Generate a Personal Access Token (or fine-grained token) with `repo` scope for that single repo; this is MATCH_GIT_BASIC_AUTHORIZATION"
        location: "https://github.com/settings/tokens (or fine-grained at /settings/personal-access-tokens/new)"
    env_vars:
      - name: MATCH_PASSWORD
        source: "User-chosen strong passphrase; ALSO saved to 1Password Vault per D-16 lost-key playbook"
      - name: MATCH_GIT_BASIC_AUTHORIZATION
        source: "base64 of `username:PAT` for the private match repo"
  - service: apple-app-store-connect-api-key
    why: "fastlane gym + pilot need an API key to upload to TestFlight non-interactively (D-14)"
    account_setup:
      - task: "Create an App Store Connect API key with `App Manager` role"
        location: "https://appstoreconnect.apple.com/access/integrations/api"
    env_vars:
      - name: APP_STORE_CONNECT_API_KEY_ID
        source: "App Store Connect → Users and Access → Integrations → Issuer ID column"
      - name: APP_STORE_CONNECT_API_KEY_ISSUER_ID
        source: "Same page, header above the table"
      - name: APP_STORE_CONNECT_API_KEY_CONTENT
        source: "The .p8 file contents (base64-encoded for GitHub secret); downloaded ONCE on key creation"
  - service: google-play-service-account
    why: "fastlane supply needs a Play Console service account JSON key to upload AABs to Internal Testing (D-14)"
    account_setup:
      - task: "Create a service account in Google Cloud Console linked to the LeanShot Play Console; grant `Release manager` role on the app under Play Console → Setup → API access"
        location: "https://play.google.com/console → Setup → API access"
    env_vars:
      - name: GOOGLE_PLAY_JSON_KEY
        source: "Downloaded service account JSON (base64-encoded for GitHub secret storage)"
  - service: sentry-auth-token-for-dsym
    why: "@sentry/cli needs auth to upload dSYMs (iOS) + ProGuard mappings (Android) per build (D-17, MOBILE-09)"
    env_vars:
      - name: SENTRY_AUTH_TOKEN
        source: "https://leanshot.sentry.io/settings/account/api/auth-tokens/ → New Auth Token with `project:releases` + `org:read` scopes"
      - name: SENTRY_ORG
        source: "Existing Phase 1 Sentry org slug (likely `leanshot`)"
      - name: SENTRY_PROJECT_IOS
        source: "Existing Phase 1 Sentry project for iOS (likely `leanshot-ios`); create if absent"
      - name: SENTRY_PROJECT_ANDROID
        source: "Existing Phase 1 Sentry project for Android (likely `leanshot-android`); create if absent"

must_haves:
  truths:
    - "Running `bundle exec fastlane ios beta` from a clean macOS runner produces a signed `.ipa`, uploads it to TestFlight, uploads dSYMs to Sentry under release `ios@<version>`, and exits 0."
    - "Running `bundle exec fastlane android beta` from a clean ubuntu runner produces a signed `.aab`, uploads it to Play Internal Testing, uploads ProGuard mappings to Sentry under release `android@<version>`, and exits 0."
    - "`.github/workflows/mobile.yml` triggers on push to `main` and on tags `mobile-v*`; it runs lint+typecheck (self-contained, does NOT depend on ci.yml) before invoking the fastlane lanes."
    - "GitHub secrets are documented in `leanshot/apps/ios/SECRETS.md` with name + source + which lane consumes each; secret names match the env vars consumed in Fastfile and mobile.yml VERBATIM (string-grep verifiable)."
    - "Sentry release tagging in lanes uses the exact strings `ios@<short_version>` and `android@<version_name>` (NOT `<version_code>`), matching the `release` value set in Plan 16-04's `Sentry.init({ release })`."
    - "`mobile.yml` does NOT modify or contend with `.github/workflows/ci.yml` — privacy-audit lives in a separate file (`mobile-privacy-audit.yml`, created by 16-07)."
  artifacts:
    - path: "leanshot/fastlane/Fastfile"
      provides: "Root fastlane lanes — `ios beta`, `android beta`, `setup` (match registration)"
      contains: "platform :ios, platform :android, lane :beta, sentry_cli, app_store_connect_api_key, upload_to_testflight, upload_to_play_store"
      min_lines: 80
    - path: "leanshot/fastlane/Matchfile"
      provides: "Match repo + storage config per D-16"
      contains: "git_url(\"https://github.com/<org>/leanshot-fastlane-match\"), storage_mode(\"git\"), type(\"appstore\")"
    - path: "leanshot/fastlane/Appfile"
      provides: "Per-platform appId + Apple team + Play package binding"
      contains: "app_identifier(\"app.leanshot.ios\"), package_name(\"app.leanshot.android\")"
    - path: "leanshot/fastlane/Gemfile"
      provides: "Pin fastlane version (~2.227) + Bundler-managed Ruby deps for reproducible CI"
      contains: "gem \"fastlane\""
    - path: "leanshot/fastlane/Gemfile.lock"
      provides: "Frozen dependency tree generated by `bundle install`"
    - path: ".github/workflows/mobile.yml"
      provides: "macOS-runner iOS lane + ubuntu-runner Android lane; self-contained lint+typecheck"
      contains: "runs-on: macos-latest, runs-on: ubuntu-latest, bundle exec fastlane ios beta, bundle exec fastlane android beta"
      min_lines: 120
    - path: "leanshot/apps/ios/SECRETS.md"
      provides: "Documented mapping of GitHub secret name → fastlane env var → consumer lane → source URL"
      contains: "MATCH_PASSWORD, APP_STORE_CONNECT_API_KEY_CONTENT, GOOGLE_PLAY_JSON_KEY, SENTRY_AUTH_TOKEN, MATCH_GIT_BASIC_AUTHORIZATION, VERCEL_TOKEN, SUPABASE_ACCESS_TOKEN"
  key_links:
    - from: "leanshot/fastlane/Fastfile (lane :ios :beta)"
      to: "leanshot/fastlane/Matchfile"
      via: "match(type: \"appstore\", readonly: is_ci)"
      pattern: "match\\("
    - from: "leanshot/fastlane/Fastfile (lane :ios :beta)"
      to: "Sentry dSYM upload via @sentry/cli"
      via: "sentry_cli action OR sh(\"sentry-cli debug-files upload ...\")"
      pattern: "sentry-cli|sentry_cli"
    - from: "leanshot/fastlane/Fastfile (lane :ios :beta)"
      to: "Sentry release tagging"
      via: "sentry_create_release(release: \"ios@#{get_version_number}\")"
      pattern: "sentry_create_release|ios@"
    - from: "leanshot/fastlane/Fastfile (lane :android :beta)"
      to: "Sentry mapping.txt upload"
      via: "sh(\"sentry-cli sourcemaps upload OR sentry-cli upload-proguard\")"
      pattern: "sentry-cli|mapping.txt"
    - from: ".github/workflows/mobile.yml (jobs.ios-beta)"
      to: "leanshot/fastlane/Fastfile"
      via: "run: bundle exec fastlane ios beta (working-directory: leanshot)"
      pattern: "fastlane (ios|android) beta"
    - from: ".github/workflows/mobile.yml secrets block"
      to: "leanshot/apps/ios/SECRETS.md table"
      via: "Every `secrets.X` reference in mobile.yml is documented in SECRETS.md with same name (string-grep parity)"
      pattern: "secrets\\."
---

<objective>
Wire the iOS + Android build, sign, and upload pipeline for Phase 16. Scaffold a `fastlane/` directory at the repo subdir root (`leanshot/fastlane/`) with `Fastfile`, `Matchfile`, `Appfile`, `Gemfile`; configure `fastlane match` against the private GitHub repo `leanshot-fastlane-match` (D-16); ship two lanes — `ios beta` (build via `gym`, upload to TestFlight via `pilot`, dSYM upload to Sentry, release tag `ios@<short_version>`) and `android beta` (build via `gradle`, upload to Play Internal via `supply`, ProGuard mappings to Sentry, release tag `android@<version_name>`). Create `.github/workflows/mobile.yml` with two jobs (macOS for iOS, ubuntu for Android), each self-contained with its own lint+typecheck step (does NOT cross-depend on `ci.yml` — GitHub Actions has no native cross-workflow dependency). Document every required GitHub secret + its source URL in `leanshot/apps/ios/SECRETS.md`. Completes MOBILE-09's release-tagging half (init half landed in 16-04).

Purpose: Without an automated, reproducible build+sign+upload pipeline, every TestFlight + Play Internal cut becomes a manual dev-machine ritual; lost-key disasters become unrecoverable; Sentry releases never get dSYMs and crashes show as unsymbolicated frames. fastlane match + per-secret CI provisioning is the industry-standard mitigation (D-14, D-16). Sentry release tagging matched to `Sentry.init({ release })` in 16-04 is what makes MOBILE-09's "all native crashes → Sentry, symbolicated" promise actually deliverable.

Output: `fastlane/*` config under `leanshot/`, `.github/workflows/mobile.yml` (NEW workflow file, separate from ci.yml), `leanshot/apps/ios/SECRETS.md` documenting all 7 GitHub secrets and their sources.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PLAN-OUTLINE.md
@.github/workflows/ci.yml
@leanshot/CLAUDE.md

<interfaces>
<!-- Key contracts from sibling plans and existing files this plan must align with. -->
<!-- Executor should use these directly — no codebase exploration needed. -->

From Plan 16-04 (Sentry dual-init, already in Wave 2 dependency chain):
```typescript
// src/lib/sentry.ts initializes with release tag MATCHING what fastlane uploads
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: import.meta.env.VITE_SENTRY_RELEASE, // 'ios@<short_version>' OR 'android@<version_name>'
  // ...
}, SentryReact.init);
```
=> Fastfile lanes MUST tag releases with these EXACT formats (no `v` prefix, lowercase `ios`/`android`, `@` separator).

From Plan 16-01 (Capacitor scaffold, Wave 1):
- iOS Info.plist `CFBundleShortVersionString` = source of truth for `<short_version>` in `ios@<short_version>` Sentry release tag
- Android `app/build.gradle` `versionName` = source of truth for `<version_name>` in `android@<version_name>` Sentry release tag
- iOS bundle id: `app.leanshot.ios` (D-10, PERMANENT)
- Android package name: `app.leanshot.android` (D-10, PERMANENT)

From Plan 16-07 (Privacy Manifest + CI audit, same Wave 3):
- 16-07 will create `.github/workflows/mobile-privacy-audit.yml` as a SEPARATE workflow file
  (per file-ownership coordination in the orchestrator dispatch prompt — avoids Wave 3
  git-index conflicts on a shared mobile.yml). This plan does NOT add a privacy-audit job.
- 16-07's `scripts/audit-privacy-manifest.mjs` exists at `leanshot/scripts/audit-privacy-manifest.mjs`;
  do NOT call it from `mobile.yml` — the audit workflow file owns that invocation.

From existing `.github/workflows/ci.yml` (lines 14-30):
- Workflow-level `defaults.run.working-directory: leanshot` is the established convention.
- Node 22 + `cache: 'npm'` + `cache-dependency-path: leanshot/package-lock.json` is the existing setup-node block — replicate verbatim in mobile.yml jobs.
- Per `feedback_planner_iter1_anti_patterns.md` HI-2: NEW jobs go in a separate workflow file when isolation is desired (this plan uses a separate file, not an append to ci.yml).

From `feedback_parallel_executor_git_isolation.md`:
- Parallel executors share ONE git index. Wave 3 has 16-07, 16-08, 16-09 running parallel.
- This plan touches `.github/workflows/mobile.yml` (NEW), `leanshot/fastlane/*` (all NEW), `leanshot/apps/ios/SECRETS.md` (NEW). 16-07 owns `apps/ios/App/App/PrivacyInfo.xcprivacy` + `Info.plist` + `App.entitlements` + `apps/android/data-safety.md` + `.github/workflows/mobile-privacy-audit.yml` (separate file). 16-08 owns `apps/ios/marketing/**` + `apps/android/marketing/**`. ZERO file overlap if 16-07 honors the separate-workflow-file coordination.
- Mandatory pathspec commits: `git commit -- leanshot/fastlane/ .github/workflows/mobile.yml leanshot/apps/ios/SECRETS.md leanshot/.planning/phases/16-.../16-09-SUMMARY.md`. Do NOT `git add .` or `git add -A`.

From `reference_supabase_worktree_temp_state.md`:
- If the executor runs in a worktree, copy `supabase/.temp/` from the main checkout BEFORE any `--linked` commands. This plan does not run `supabase` CLI commands, so the hazard is theoretical — but noted in case mobile.yml ever adds a `supabase functions deploy` step (it does not in this plan).
</interfaces>

</context>

<tasks>

<task type="auto">
  <name>Task 1: Scaffold fastlane config (Gemfile, Matchfile, Appfile) + iOS + Android lanes in root Fastfile with Sentry dSYM upload + release tagging</name>
  <files>leanshot/fastlane/Gemfile, leanshot/fastlane/Gemfile.lock, leanshot/fastlane/Matchfile, leanshot/fastlane/Appfile, leanshot/fastlane/Fastfile, leanshot/apps/ios/App/fastlane/Fastfile, leanshot/apps/android/fastlane/Fastfile, leanshot/.gitignore (append)</files>

  <read_first>
    - `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md` §"Standard Stack" (fastlane row) + §"Common Pitfalls — Pitfall 5 (match lost-key)" + §"State of the Art" (fastlane match row).
    - `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md` §"fastlane/Fastfile + Matchfile + Appfile" (lines 27-29 — `no analog` finding; use fastlane docs as source).
    - `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md` D-14 (fastlane + GitHub Actions macOS runner), D-15 (7-day TestFlight + 3-day Play Internal soak — this plan only uploads; soak is 16-10's gate), D-16 (match private repo + 1Password backup), D-17 (Sentry max coverage + release tagging strategy).
    - `leanshot/CLAUDE.md` §"Conventions" — Ruby/fastlane is NOT in the existing stack; this is a new toolchain addition. No existing `Gemfile` to reference; fastlane idioms come from fastlane docs.
  </read_first>

  <action>
Create the root fastlane scaffold under `leanshot/fastlane/`. Use Bundler-managed Ruby (a `Gemfile` pinning fastlane `~> 2.227`, `bundler ~> 2.5`) so CI installs deterministically via `bundle install`. Run `bundle install` locally to generate `Gemfile.lock` and commit both. Per D-14, this is the canonical fastlane setup for both platforms.

**Matchfile** (per D-16): set `git_url("https://github.com/<USER-OR-ORG>/leanshot-fastlane-match")` with the org placeholder explicitly marked `<USER-OR-ORG>` (executor: do NOT hardcode the org — leave the placeholder and reference SECRETS.md for resolution; the user fills via checkpoint at Task 3). `storage_mode("git")`, `type("appstore")` as default, `app_identifier(["app.leanshot.ios"])`, `username("<APPLE-ID-EMAIL>")` placeholder, `team_id("<APPLE-TEAM-ID>")` placeholder. Document every placeholder in SECRETS.md (Task 2).

**Appfile** (per D-10): `app_identifier("app.leanshot.ios")` for the for_platform :ios block, `package_name("app.leanshot.android")` for the for_platform :android block. `apple_id("<APPLE-ID-EMAIL>")` + `itc_team_id("<ITC-TEAM-ID>")` + `team_id("<APPLE-TEAM-ID>")` placeholders. For Android: `json_key_file("<resolved-at-CI-time>")` — Fastfile reads the JSON from the `GOOGLE_PLAY_JSON_KEY` env var into a tempfile rather than committing a path.

**Root Fastfile** structure (minimum 80 lines):
- `default_platform(:ios)` at top, then `platform :ios do` block + `platform :android do` block.
- `before_all` shared block: `setup_ci(provider: "circleci")` actually a no-op outside CI; check `ENV["CI"]` truthy and run `setup_ci(force: true)` to create an ephemeral keychain (fastlane match best-practice for GitHub Actions macOS runners — prevents keychain prompt deadlock).
- iOS `lane :beta do` body:
  1. `app_store_connect_api_key(key_id: ENV["APP_STORE_CONNECT_API_KEY_ID"], issuer_id: ENV["APP_STORE_CONNECT_API_KEY_ISSUER_ID"], key_content: ENV["APP_STORE_CONNECT_API_KEY_CONTENT"], is_key_content_base64: true, in_house: false)` — stores the API token in lane context so subsequent actions pick it up.
  2. `match(type: "appstore", readonly: is_ci, app_identifier: ["app.leanshot.ios"])` — readonly in CI so a bad lane never overwrites the match repo.
  3. `cocoapods(podfile: "../apps/ios/App/Podfile")` only if Plan 16-01's SPM audit landed CocoaPods as a fallback (check existence of `apps/ios/App/Podfile`; skip cleanly if SPM-only). Use Fastfile `if File.exist?("../apps/ios/App/Podfile")` guard.
  4. `build_app(workspace: "../apps/ios/App/App.xcworkspace", scheme: "App", configuration: "Release", export_method: "app-store", clean: true, output_directory: "../build/ios", silent: false)` — fastlane `gym` action. The workspace path is relative to `leanshot/fastlane/`. (Note: Capacitor 8 default is SPM → `.xcodeproj` not `.xcworkspace`. Plan 16-01 may have generated either; Fastfile handles BOTH: try `workspace:` first, fall back to `project:` if the workspace doesn't exist. Use `File.exist?("../apps/ios/App/App.xcworkspace") ? { workspace: ... } : { project: "../apps/ios/App/App.xcodeproj" }`.)
  5. `version = get_version_number(xcodeproj: "../apps/ios/App/App.xcodeproj", target: "App")` — captures `CFBundleShortVersionString` for the Sentry release tag.
  6. **Sentry release tagging (MOBILE-09 release-tag half)** — use `sh("npx", "@sentry/cli", "releases", "new", "ios@#{version}")` and `sh("npx", "@sentry/cli", "releases", "set-commits", "ios@#{version}", "--auto")`. Wraps `npx @sentry/cli` directly (NOT the `sentry_cli` fastlane plugin — that's an extra gem with version-drift risk; the `sh` form pins the npm package and is documented in `@sentry/capacitor` README).
  7. **dSYM upload (MOBILE-09)** — `sh("npx", "@sentry/cli", "debug-files", "upload", "--org", ENV["SENTRY_ORG"], "--project", ENV["SENTRY_PROJECT_IOS"], "../build/ios/App.app.dSYM.zip")`. Pre-upload, run `sh("find", "../build/ios", "-name", "*.dSYM*")` and log paths so a missing-dSYM failure is debuggable.
  8. `upload_to_testflight(api_key_path: nil, skip_waiting_for_build_processing: true, distribute_external: false, ipa: "../build/ios/App.ipa")` — fastlane `pilot` action; uses the API key already in lane context. `skip_waiting...: true` so CI doesn't time out on TestFlight processing (which can take 30+ min).
  9. `sh("npx", "@sentry/cli", "releases", "finalize", "ios@#{version}")` — closes the release.

- Android `lane :beta do` body:
  1. `match` skipped (Android uses its own keystore via gradle).
  2. `gradle(task: "clean")` then `gradle(task: "bundleRelease", project_dir: "../apps/android")` to produce `.aab`. Set `properties: { "android.injected.signing.store.password" => ENV["ANDROID_KEYSTORE_PASSWORD"], "android.injected.signing.key.alias" => ENV["ANDROID_KEY_ALIAS"], "android.injected.signing.key.password" => ENV["ANDROID_KEY_PASSWORD"], "android.injected.signing.store.file" => ENV["ANDROID_KEYSTORE_PATH"] }`. The keystore path resolves to a tempfile written from base64 `ANDROID_KEYSTORE_BASE64` in the CI step before fastlane runs (documented in SECRETS.md). The Android keystore is a NET-NEW Wave 3 vendor item — flag in SECRETS.md as "TBD: create with `keytool -genkey -v -keystore ...` and store the .jks contents base64-encoded as ANDROID_KEYSTORE_BASE64; password in ANDROID_KEYSTORE_PASSWORD".
  3. `version_name = sh("cd ../apps/android && ./gradlew -q printVersionName").strip` — captures `versionName` for Sentry release tag. (Add a small `printVersionName` task to `apps/android/app/build.gradle` if not already there; alternative: read `versionName` from `build.gradle` via Ruby File.read + regex.) Use the regex form to avoid invoking gradle twice: `version_name = File.read("../apps/android/app/build.gradle").match(/versionName\s+"([^"]+)"/)[1]`.
  4. **Sentry release tag** — `sh("npx", "@sentry/cli", "releases", "new", "android@#{version_name}")`.
  5. **Sentry mapping upload (MOBILE-09)** — `sh("npx", "@sentry/cli", "upload-proguard", "--org", ENV["SENTRY_ORG"], "--project", ENV["SENTRY_PROJECT_ANDROID"], "--android-manifest", "../apps/android/app/build/intermediates/merged_manifests/release/AndroidManifest.xml", "../apps/android/app/build/outputs/mapping/release/mapping.txt")`. If ProGuard/R8 is disabled (Capacitor 8 default may be off in the generated `build.gradle`), the mapping.txt won't exist — Fastfile checks `File.exist?` and skips with a `UI.message` (NOT failing the lane). R8 enablement is a Plan 16-01 concern; if 16-01 left R8 off, this lane logs "ProGuard mapping skipped (R8 disabled)" and proceeds.
  6. `upload_to_play_store(track: "internal", aab: "../apps/android/app/build/outputs/bundle/release/app-release.aab", json_key_data: ENV["GOOGLE_PLAY_JSON_KEY"], skip_upload_apk: true, skip_upload_metadata: true, skip_upload_changelogs: true, skip_upload_images: true, skip_upload_screenshots: true)` — `supply` action. `json_key_data` reads the env var directly (base64-decoded by CI step before fastlane runs); skip-uploads avoid overwriting ASO assets owned by 16-08.
  7. `sh("npx", "@sentry/cli", "releases", "finalize", "android@#{version_name}")`.

- Add `error_callback` block at end of each platform: `sh("npx", "@sentry/cli", "releases", "delete", ...)` to roll back the partial release tag on lane failure. (Optional polish — keep behind a feature flag `ENV["SENTRY_ROLLBACK_ON_FAIL"]` to avoid noisy deletes during dev.)

**Per-platform Fastfile overrides** (`leanshot/apps/ios/App/fastlane/Fastfile` + `leanshot/apps/android/fastlane/Fastfile`): fastlane convention allows per-platform Fastfile under the platform's native project; for this plan they exist but DELEGATE to the root via `import "../../../fastlane/Fastfile"`. This is so `cd apps/ios/App && fastlane beta` works for dev-machine local runs without duplicating lane code. Per D-14 the GitHub Actions runners always invoke from `leanshot/` root, so the root Fastfile is the canonical surface.

**.gitignore** (`leanshot/.gitignore`, append): `build/`, `fastlane/report.xml`, `fastlane/Preview.html`, `fastlane/screenshots/`, `fastlane/test_output/`, `*.dSYM.zip`, `*.ipa`, `*.aab`. Do NOT ignore `fastlane/Gemfile.lock` (it must be committed for reproducibility).

**Implementation rule (per D-16):** All passwords/tokens come from ENV. NO hardcoded secrets. The `<USER-OR-ORG>` placeholder in Matchfile MUST be replaced via Task 3 checkpoint, not by the executor.
  </action>

  <verify>
    <automated>
cd leanshot/fastlane && \
  bundle install --jobs 4 --quiet && \
  test -f Gemfile.lock && \
  bundle exec fastlane --version && \
  bundle exec fastlane lanes 2>&1 | grep -E "ios beta|android beta" && \
  ruby -c Fastfile && \
  ruby -c Matchfile && \
  ruby -c Appfile && \
  grep -c "sentry-cli" Fastfile | (read n; [ "$n" -ge 4 ] || (echo "FAIL: expected >=4 sentry-cli references in Fastfile (releases new + debug-files upload + finalize on both lanes), got $n"; exit 1)) && \
  grep -Eq "ios@" Fastfile && \
  grep -Eq "android@" Fastfile && \
  grep -q "app.leanshot.ios" Appfile && \
  grep -q "app.leanshot.android" Appfile && \
  grep -q "leanshot-fastlane-match" Matchfile && \
  grep -q "<USER-OR-ORG>" Matchfile && \
  echo "fastlane scaffold validation: PASS"
    </automated>
  </verify>

  <done>
    `bundle install` succeeds in `leanshot/fastlane/`; `bundle exec fastlane lanes` lists `ios beta` and `android beta` (no syntax errors). Ruby `-c` parses all three config files cleanly. Fastfile contains ≥4 `sentry-cli` invocations (2 lanes × release-new + dSYM/mapping upload + finalize). Both `ios@` and `android@` Sentry release tag patterns are literal-grep present. Matchfile has the `<USER-OR-ORG>` placeholder (resolved at Task 3 checkpoint, not hardcoded). Appfile pins both bundle IDs per D-10. `Gemfile.lock` committed for reproducibility. `.gitignore` extended to exclude build artifacts. Per-platform Fastfiles delegate to root.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create .github/workflows/mobile.yml (self-contained, 2 jobs) + SECRETS.md documenting every required GitHub secret + source URL</name>
  <files>.github/workflows/mobile.yml, leanshot/apps/ios/SECRETS.md</files>

  <read_first>
    - `.github/workflows/ci.yml` (lines 1-30) — exact structural pattern: workflow-level `defaults.run.working-directory: leanshot`, `concurrency` block, `actions/checkout@v4` + `actions/setup-node@v4` setup. Per `feedback_planner_iter1_anti_patterns.md` HI-2 additive-append rule, this plan uses a separate workflow file (NOT an append to ci.yml) for cost isolation (macOS runner) and to keep the privacy-audit job (owned by 16-07 in a third workflow file) from cross-contaminating.
    - `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md` §".github/workflows/mobile.yml (config, batch)" (lines 487-535) — job structure pattern + secret injection pattern, including the env block layout.
    - `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md` §"Environment Availability" + §"Validation Architecture" §"Wave 0 Gaps" (last bullet — `mobile.yml` runs lint + unit + e2e:mobile + match-validate on PRs touching `apps/`, `src/lib/native/`, or `capacitor.config.ts`).
    - `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md` D-14 (macOS runner ~$0.24/min × 10 min budget), D-17 (Sentry dSYM upload), D-15 (this workflow uploads to TestFlight/Play Internal — soak is 16-10's manual UAT, NOT this workflow's concern).
    - `leanshot/CLAUDE.md` — Node 22, working-directory `leanshot` convention is established by ci.yml.
    - Memory notes: `reference_supabase_worktree_temp_state.md` (NOT relevant to this plan — no Supabase CLI invocations), `feedback_parallel_executor_git_isolation.md` (relevant — this plan + 16-07 + 16-08 run parallel; 16-07 creates `mobile-privacy-audit.yml` in a separate file, so no overlap).
  </read_first>

  <action>
Create `.github/workflows/mobile.yml` (NEW file, NOT a modification of ci.yml). Structure mirrors ci.yml's idioms but is **fully self-contained** — it runs its own lint + typecheck steps because GitHub Actions does not support native cross-workflow `needs:` dependencies (only intra-workflow `needs:`). Per D-14 + the cost-isolation rationale in RESEARCH "Environment Availability", isolate the macOS-runner cost from the broader ci.yml.

**Trigger policy** (top of file):
```yaml
on:
  push:
    branches: [main]
    paths:
      - 'leanshot/apps/**'
      - 'leanshot/src/lib/native/**'
      - 'leanshot/capacitor.config.ts'
      - 'leanshot/fastlane/**'
      - '.github/workflows/mobile.yml'
  pull_request:
    branches: [main]
    paths:
      - 'leanshot/apps/**'
      - 'leanshot/src/lib/native/**'
      - 'leanshot/capacitor.config.ts'
      - 'leanshot/fastlane/**'
      - '.github/workflows/mobile.yml'
  push:
    tags: ['mobile-v*']  # tag-triggered TestFlight/Play uploads (D-15 soak entry)
```

**Concurrency + defaults** (mirroring ci.yml exactly):
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ !startsWith(github.ref, 'refs/tags/') }}  # do NOT cancel tag-triggered uploads

defaults:
  run:
    working-directory: leanshot
```
The tag-aware `cancel-in-progress` keeps push-to-main + tag-driven uploads safe (a follow-up push won't kill an in-flight TestFlight upload).

**Jobs:**

1. **`mobile-lint-typecheck`** (ubuntu-latest, ~3 min) — self-contained lint + typecheck for the mobile code paths. Steps: checkout, setup-node 22 (cache npm, cache-dependency-path `leanshot/package-lock.json`), `npm ci`, `npm run lint`, `npm run typecheck`. This is the gate that blocks the build jobs.

2. **`ios-beta`** (macos-latest, `timeout-minutes: 60`, `needs: [mobile-lint-typecheck]`, `if: github.event_name == 'push' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/mobile-v'))`). Steps:
   - `actions/checkout@v4` with `fetch-depth: 0` (fastlane uses git to compute changelog).
   - `actions/setup-node@v4` (Node 22, npm cache).
   - `ruby/setup-ruby@v1` with `bundler-cache: true` + `working-directory: leanshot/fastlane`.
   - **Decode Apple API key from base64**: `echo "$APP_STORE_CONNECT_API_KEY_CONTENT_B64" | base64 -d > /tmp/asc-api-key.p8 && echo "APP_STORE_CONNECT_API_KEY_CONTENT=$(base64 < /tmp/asc-api-key.p8 | tr -d '\n')" >> $GITHUB_ENV` — fastlane's `app_store_connect_api_key` action takes either a path or base64 content; we pass base64 content via env.
   - **Build SPA bundle**: `npm ci && npm run build` (writes to `leanshot/dist/`, which capacitor.config.ts maps as `webDir`).
   - **Sync Capacitor**: `npx cap sync ios`.
   - **Install @sentry/cli**: `npm i -g @sentry/cli@latest` so Fastfile `sh("npx @sentry/cli ...")` resolves quickly (otherwise npx fetches per-invocation).
   - **Run lane**: `cd leanshot/fastlane && bundle exec fastlane ios beta`.
   - **Upload Playwright report on failure** (artifact retention 7 days).
   - **`env:` block** for the step that runs fastlane:
     ```yaml
     env:
       MATCH_PASSWORD: ${{ secrets.MATCH_PASSWORD }}
       MATCH_GIT_BASIC_AUTHORIZATION: ${{ secrets.MATCH_GIT_BASIC_AUTHORIZATION }}
       APP_STORE_CONNECT_API_KEY_ID: ${{ secrets.APP_STORE_CONNECT_API_KEY_ID }}
       APP_STORE_CONNECT_API_KEY_ISSUER_ID: ${{ secrets.APP_STORE_CONNECT_API_KEY_ISSUER_ID }}
       APP_STORE_CONNECT_API_KEY_CONTENT: ${{ secrets.APP_STORE_CONNECT_API_KEY_CONTENT }}
       SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
       SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
       SENTRY_PROJECT_IOS: ${{ secrets.SENTRY_PROJECT_IOS }}
       VITE_SENTRY_DSN: ${{ secrets.VITE_SENTRY_DSN }}
       VITE_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
       VITE_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
     ```

3. **`android-beta`** (ubuntu-latest, `timeout-minutes: 30`, `needs: [mobile-lint-typecheck]`, same `if:` condition). Steps:
   - `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-java@v4` with `distribution: 'temurin'` + `java-version: '17'`, `ruby/setup-ruby@v1` (bundler-cache true).
   - **Decode keystore from base64**: `mkdir -p /tmp/android && echo "$ANDROID_KEYSTORE_B64" | base64 -d > /tmp/android/release.jks && echo "ANDROID_KEYSTORE_PATH=/tmp/android/release.jks" >> $GITHUB_ENV`.
   - **Decode Play JSON key**: `echo "$GOOGLE_PLAY_JSON_KEY_B64" | base64 -d > /tmp/android/play.json && echo "GOOGLE_PLAY_JSON_KEY=$(cat /tmp/android/play.json)" >> $GITHUB_ENV`. Note: `GOOGLE_PLAY_JSON_KEY` env passed to fastlane is the JSON STRING contents (not the path), matching the Fastfile's `json_key_data:` usage.
   - **Build SPA + Cap sync**: `npm ci && npm run build && npx cap sync android`.
   - `npm i -g @sentry/cli@latest`.
   - **Run lane**: `cd leanshot/fastlane && bundle exec fastlane android beta`.
   - `env:` block: `MATCH_PASSWORD`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT_ANDROID`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEYSTORE_B64`, `GOOGLE_PLAY_JSON_KEY_B64`, `VITE_SENTRY_DSN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

4. **`mobile-summary`** (ubuntu-latest, `needs: [ios-beta, android-beta]`, `if: always()`) — a single-step job that runs `echo "iOS: ${{ needs.ios-beta.result }}; Android: ${{ needs.android-beta.result }}"` so the branch-protection rule has a single check to require.

**Header comment** at top of mobile.yml — document the cost rationale + the separate-file coordination with 16-07:
```yaml
# Phase 16 Plan 16-09 — Mobile build/sign/upload pipeline (D-14, D-16, D-17, MOBILE-01, MOBILE-02, MOBILE-09)
#
# Isolated from .github/workflows/ci.yml for two reasons:
#   1. Cost — macos-latest is ~$0.24/min vs ubuntu's $0.008/min. Path-filtering this workflow keeps
#      mobile builds off every ubuntu PR.
#   2. Coordination — Plan 16-07 (Privacy Manifest audit, same Wave 3) owns
#      .github/workflows/mobile-privacy-audit.yml. Splitting the workflows avoids
#      parallel-executor git-index conflicts (see feedback_parallel_executor_git_isolation.md).
#
# Secrets referenced here are documented in leanshot/apps/ios/SECRETS.md with source URLs.
```

**`leanshot/apps/ios/SECRETS.md`** (NEW): a 3-column markdown table listing each GitHub secret name → source URL → consumer (which lane / which step). Required entries (one row each):
- `MATCH_PASSWORD` — User-chosen passphrase; ALSO stored in 1Password Vault (D-16 lost-key playbook). Consumer: ios-beta + android-beta (both use match for iOS cert sync — Android doesn't but the env var doesn't hurt).
- `MATCH_GIT_BASIC_AUTHORIZATION` — base64 of `<github-username>:<PAT>`; PAT scope = `repo` on `leanshot-fastlane-match` only. Source URL: https://github.com/settings/personal-access-tokens/new. Consumer: ios-beta `match()` action.
- `APP_STORE_CONNECT_API_KEY_ID` + `APP_STORE_CONNECT_API_KEY_ISSUER_ID` + `APP_STORE_CONNECT_API_KEY_CONTENT` — App Store Connect API key triplet. Source URL: https://appstoreconnect.apple.com/access/integrations/api. Consumer: ios-beta `app_store_connect_api_key()` + `upload_to_testflight()`.
- `GOOGLE_PLAY_JSON_KEY_B64` — base64 of the service account JSON. Source URL: https://console.cloud.google.com/iam-admin/serviceaccounts (linked to Play Console via https://play.google.com/console/u/0/setup/api-access). Consumer: android-beta `upload_to_play_store()`.
- `ANDROID_KEYSTORE_B64` + `ANDROID_KEYSTORE_PASSWORD` + `ANDROID_KEY_ALIAS` + `ANDROID_KEY_PASSWORD` — Android signing key (NET-NEW vendor item; document the `keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload` command + the recommendation to also save the `.jks` to 1Password). Consumer: android-beta `gradle()`.
- `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT_IOS` + `SENTRY_PROJECT_ANDROID` — Sentry release/dSYM upload triplet. Source URL: https://leanshot.sentry.io/settings/account/api/auth-tokens/. Consumer: both lanes `sentry-cli` calls.
- `VERCEL_TOKEN` — Vercel API token (NOT consumed by this workflow but listed for the future; document as "reserved for future deployment-trigger jobs"). Source URL: https://vercel.com/account/tokens.
- `SUPABASE_ACCESS_TOKEN` — Supabase CLI token (NOT consumed by this workflow; listed for future Edge Function deploys triggered by mobile releases). Source URL: https://supabase.com/dashboard/account/tokens.
- `SUPABASE_URL` + `SUPABASE_ANON_KEY` — existing secrets from ci.yml; consumed by mobile.yml's `npm run build` step (used by Vite bundle for the in-app Supabase client). Source: existing GitHub repo secrets.
- `VITE_SENTRY_DSN` — Sentry DSN bundled into the SPA at build time. Consumer: `npm run build`.

Each row of the SECRETS.md table also includes a **"Required to be set BEFORE first push to main on mobile.yml paths"** boolean and a **"1Password backup recommended"** boolean (per D-16). At the bottom of SECRETS.md add a "Recovery Playbook" section (per Pitfall 5 in RESEARCH): if MATCH_PASSWORD is lost, run `bundle exec fastlane match nuke distribution` + `match nuke development` from a machine with the password, re-issue certs, re-distribute via TestFlight. This forces TestFlight users to reinstall — document that.

**File-ownership invariant:** `.github/workflows/mobile.yml` is OWNED by this plan. 16-07's `.github/workflows/mobile-privacy-audit.yml` is a separate file. There MUST be NO `privacy-audit` job in this workflow file (verify via grep at task close).
  </action>

  <verify>
    <automated>
test -f .github/workflows/mobile.yml && \
test -f leanshot/apps/ios/SECRETS.md && \
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/mobile.yml')); jobs=set(d['jobs'].keys()); want={'mobile-lint-typecheck','ios-beta','android-beta','mobile-summary'}; missing=want-jobs; (sys.exit(0) if not missing else (print(f'FAIL: missing jobs {missing}'),sys.exit(1)))" && \
grep -Eq "^\s*runs-on: macos-latest" .github/workflows/mobile.yml && \
grep -Eq "^\s*runs-on: ubuntu-latest" .github/workflows/mobile.yml && \
grep -Eq "bundle exec fastlane ios beta" .github/workflows/mobile.yml && \
grep -Eq "bundle exec fastlane android beta" .github/workflows/mobile.yml && \
grep -Eq "needs:\s*\[mobile-lint-typecheck\]" .github/workflows/mobile.yml && \
test "$(grep -c "privacy-audit\|audit-privacy-manifest" .github/workflows/mobile.yml)" -eq 0 || (echo "FAIL: mobile.yml MUST NOT contain privacy-audit refs (16-07 owns the separate workflow)"; exit 1) && \
SECRETS_REFERENCED=$(grep -oE 'secrets\.[A-Z0-9_]+' .github/workflows/mobile.yml | sort -u | sed 's/^secrets\.//') && \
for s in $SECRETS_REFERENCED; do \
  grep -q "$s" leanshot/apps/ios/SECRETS.md || (echo "FAIL: GitHub secret '$s' referenced in mobile.yml but not documented in SECRETS.md"; exit 1); \
done && \
grep -q "MATCH_PASSWORD" leanshot/apps/ios/SECRETS.md && \
grep -q "APP_STORE_CONNECT_API_KEY_CONTENT" leanshot/apps/ios/SECRETS.md && \
grep -q "GOOGLE_PLAY_JSON_KEY" leanshot/apps/ios/SECRETS.md && \
grep -q "SENTRY_AUTH_TOKEN" leanshot/apps/ios/SECRETS.md && \
grep -q "MATCH_GIT_BASIC_AUTHORIZATION" leanshot/apps/ios/SECRETS.md && \
grep -q "VERCEL_TOKEN" leanshot/apps/ios/SECRETS.md && \
grep -q "SUPABASE_ACCESS_TOKEN" leanshot/apps/ios/SECRETS.md && \
grep -q "Recovery Playbook" leanshot/apps/ios/SECRETS.md && \
echo "mobile.yml + SECRETS.md validation: PASS"
    </automated>
  </verify>

  <done>
`mobile.yml` parses as valid YAML; contains all 4 required jobs (`mobile-lint-typecheck`, `ios-beta`, `android-beta`, `mobile-summary`); has both `macos-latest` and `ubuntu-latest` runners; invokes both `bundle exec fastlane ios beta` and `bundle exec fastlane android beta`; ios-beta and android-beta both `needs: [mobile-lint-typecheck]`; contains ZERO `privacy-audit` or `audit-privacy-manifest` references (proving file-ownership invariant with 16-07). Every `secrets.X` reference in mobile.yml has a corresponding entry in SECRETS.md (string-grep parity). SECRETS.md documents all 7+ required secrets per the planning prompt + the 4 additional Android-keystore/JSON-key secrets, with `Recovery Playbook` section for the D-16 lost-key path.
  </done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 3: Provision vendor accounts + GitHub secrets + match repo init (HUMAN-ONLY — credentials cannot be read by Claude)</name>

  <what-built>
    Tasks 1 + 2 produced:
    - `leanshot/fastlane/{Fastfile,Matchfile,Appfile,Gemfile,Gemfile.lock}` with all secrets parameterized via ENV
    - `.github/workflows/mobile.yml` referencing 11+ GitHub secrets
    - `leanshot/apps/ios/SECRETS.md` documenting each secret with source URL + consumer + 1Password recommendation

    All credentials are placeholder-templated. This checkpoint exists because GitHub repo secrets, Apple API keys, Google Play service accounts, and the `leanshot-fastlane-match` private repo CANNOT be created or stored by Claude — they require human authentication into private dashboards.
  </what-built>

  <how-to-verify>
    Follow the checklist in `leanshot/apps/ios/SECRETS.md` in order. Each item must be **completed before this checkpoint resumes**. The first lane invocation in CI (any push to main touching `leanshot/apps/**`) will fail loudly if any secret is missing; this checkpoint front-loads that pain into one explicit step.

    **A. Match repo + password (D-16):**
    1. Create empty private GitHub repo `leanshot-fastlane-match` under your org or personal account (https://github.com/new — Private, no README).
    2. Decide on a strong `MATCH_PASSWORD` passphrase. Save it to 1Password Vault NOW (Pitfall 5 lost-key disaster prevention).
    3. Generate a PAT (https://github.com/settings/personal-access-tokens/new) with `repo` scope LIMITED to `leanshot-fastlane-match` only.
    4. Compute base64: `printf "%s" "<github-username>:<PAT>" | base64`. Store as repo secret `MATCH_GIT_BASIC_AUTHORIZATION`.
    5. Edit `leanshot/fastlane/Matchfile` — replace `<USER-OR-ORG>` with your actual org/username (the only hardcoded value in the scaffold). Commit this edit on the Phase 16 branch.

    **B. Apple App Store Connect API key (D-14):**
    1. https://appstoreconnect.apple.com/access/integrations/api → "+" → role `App Manager` → download the `.p8` ONE TIME (no second download possible).
    2. Note the `Key ID` (visible in the table) and the `Issuer ID` (shown above the table).
    3. base64 the .p8: `base64 < AuthKey_XXXXXXXXXX.p8 | tr -d '\n'`.
    4. Store as repo secrets: `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_KEY_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_CONTENT`.

    **C. Google Play service account (D-14):**
    1. https://play.google.com/console → Setup → API access → Create new service account (linked to GCP project).
    2. In GCP IAM, download the JSON key for that service account.
    3. Back in Play Console → API access → Grant access → role `Release manager` (scope: this app only).
    4. base64 the JSON: `base64 < service-account.json | tr -d '\n'`. Store as repo secret `GOOGLE_PLAY_JSON_KEY_B64`.

    **D. Android keystore (NET-NEW; per SECRETS.md):**
    1. Generate: `keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload` — pick strong passwords for store + key.
    2. Save `release.jks` to 1Password Vault. base64: `base64 < release.jks | tr -d '\n'`. Store as repo secret `ANDROID_KEYSTORE_B64`.
    3. Store `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (= `upload`), `ANDROID_KEY_PASSWORD` as repo secrets.

    **E. Sentry auth token (D-17):**
    1. https://leanshot.sentry.io/settings/account/api/auth-tokens/ → New Auth Token → scopes `project:releases` + `org:read`.
    2. Verify two projects exist (https://leanshot.sentry.io/settings/projects/) — `leanshot-ios` and `leanshot-android`. Create if absent.
    3. Store repo secrets: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` (= `leanshot` or whatever the org slug is), `SENTRY_PROJECT_IOS`, `SENTRY_PROJECT_ANDROID`.

    **F. Match repo initialization (one-time, from local dev machine):**
    On a developer machine with both the Apple Developer Program login AND `MATCH_PASSWORD` AND the just-generated PAT exported as `MATCH_GIT_BASIC_AUTHORIZATION`:
    ```
    cd leanshot/fastlane
    bundle install
    MATCH_PASSWORD=<password> bundle exec fastlane match appstore --app_identifier "app.leanshot.ios"
    ```
    First run will prompt for Apple ID password (use an app-specific password from https://appleid.apple.com); subsequent runs are non-interactive. This populates the `leanshot-fastlane-match` repo with encrypted certs.

    **G. Existing repo secrets already in ci.yml (verify presence, do NOT recreate):**
    - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — already populated from Phase 5+. Confirmed via grep in ci.yml.
    - `VITE_SENTRY_DSN` — verify present at https://github.com/<org>/<repo>/settings/secrets/actions; add if absent (value from Phase 1 Sentry project).

    **H. Verify by triggering a dry run** (do this AFTER all secrets land):
    Push a no-op commit on a feature branch that touches `leanshot/fastlane/Fastfile` (e.g., add a comment). PR triggers `mobile-lint-typecheck` only (path filter matches; build jobs gated to `push` events). Confirm lint + typecheck pass. Then merge to main; the push to main triggers `ios-beta` + `android-beta`. First run will likely fail on Apple Sandbox tester setup or keystore upload — fix iteratively. The point of this checkpoint is to surface secret-missing failures BEFORE the first real release.
  </how-to-verify>

  <resume-signal>
    Reply with `secrets-provisioned` when all checklist sections A-G are complete and either:
      (a) you've kicked off the dry-run push in H and it reached the fastlane lane (even if the lane itself failed on something else — proves secrets are wired), OR
      (b) you've manually verified each secret is present at https://github.com/<org>/<repo>/settings/secrets/actions.

    If you hit a blocker on any vendor account (Apple Dev approval delay, Play Console KYC pending, Sentry org access), reply with `blocked: <vendor>: <details>` so the orchestrator can defer the dependent UAT in 16-10.
  </resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| GitHub Actions runner → Apple App Store Connect API | API key authenticates uploads; if leaked, attacker can push fake builds to TestFlight |
| GitHub Actions runner → Google Play Developer API | Service-account JSON authenticates AAB uploads; if leaked, attacker can publish to Play |
| GitHub Actions runner → Sentry API | Auth token for release/dSYM upload; if leaked, attacker can poison release metadata or exfiltrate dSYMs |
| Developer machine ↔ `leanshot-fastlane-match` repo | Encrypted match repo content gated by `MATCH_PASSWORD`; if both leaked, attacker can issue valid signing certs |
| CI environment → Android keystore (`.jks`) | Keystore base64-decoded into `/tmp/android/` at runtime; controls Play Store identity |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-09-01 | Spoofing | App Store Connect API key | mitigate | Key scoped to `App Manager` only (cannot create new apps). Rotated yearly via SECRETS.md "Recovery Playbook"; key ID + issuer + content are 3 separate secrets (compromise of one is insufficient). |
| T-16-09-02 | Tampering | `leanshot/fastlane/Matchfile` | mitigate | Matchfile committed with `<USER-OR-ORG>` placeholder requiring Task 3 checkpoint edit; ESLint-style grep gate in Task 1 verify enforces placeholder presence. Match repo is `readonly: is_ci` in Fastfile — CI cannot overwrite the match repo even with valid PAT. |
| T-16-09-03 | Repudiation | Sentry release upload | accept | Release tagging includes `--auto` for commits attribution. Acceptable: if attacker poisons a release, the next legit release supersedes it. Low impact (telemetry-only). |
| T-16-09-04 | Information Disclosure | Android keystore in `/tmp/android/release.jks` | mitigate | Keystore lives only in ephemeral runner FS (deleted after job). `actions/upload-artifact` excludes `/tmp/`. Keystore password is a separate secret; base64 + password compromise both required. |
| T-16-09-05 | Information Disclosure | `MATCH_PASSWORD` + `MATCH_GIT_BASIC_AUTHORIZATION` | mitigate | PAT scope limited to `leanshot-fastlane-match` repo only (no broader org access). Match content is AES-encrypted with MATCH_PASSWORD; PAT alone yields encrypted blobs, not certs. D-16 1Password backup required by SECRETS.md checklist. |
| T-16-09-06 | Denial of Service | GitHub Actions macOS minutes burn | mitigate | Path filters scope mobile.yml triggers to `apps/**`, `src/lib/native/**`, `capacitor.config.ts`, `fastlane/**`, `mobile.yml` only. `concurrency.cancel-in-progress: true` (except on tags). `timeout-minutes: 60` (iOS) / 30 (android) caps runaway. |
| T-16-09-07 | Elevation of Privilege | Google Play service account | mitigate | Role limited to `Release manager` (cannot delete apps or change billing). Key rotation procedure in SECRETS.md. Per Pitfall 6 in RESEARCH, `assetlinks.json` Play re-signing fingerprint is a separate post-first-upload checkpoint (owned by 16-03 verify). |
| T-16-09-08 | Tampering | Fastfile dSYM-upload `sh` calls injecting attacker-controlled paths | mitigate | `sh()` invocations use Ruby string interpolation with sanitized values: `version` from `get_version_number` (Xcode-validated), `version_name` from File.read regex (build.gradle-validated). No user-supplied input flows into `sh()`. Static + Code-review only — no input sanitization required. |
</threat_model>

<verification>
**Wave 3 gate (this plan + 16-07 + 16-08 all green before Wave 4):**

1. **Plan-local automated checks** (from Tasks 1 + 2 `<verify>` blocks):
   - `bundle exec fastlane lanes` lists `ios beta` and `android beta`.
   - YAML parser confirms mobile.yml has 4 expected jobs.
   - Every `secrets.X` in mobile.yml appears in SECRETS.md (string-grep parity).
   - mobile.yml has zero `privacy-audit` references (proves file-ownership with 16-07).

2. **Cross-plan invariant** (verified at Wave 3 close, NOT by this plan's executor):
   - Both `.github/workflows/mobile.yml` (this plan) and `.github/workflows/mobile-privacy-audit.yml` (16-07) exist as SEPARATE files with no job-name collisions.

3. **Wave 3 close (orchestrator-driven):** after Task 3 checkpoint resumes with `secrets-provisioned`, a dry-run push to a Phase 16 feature branch touching `leanshot/fastlane/Fastfile` MUST:
   - Trigger `mobile-lint-typecheck` only (PR event, build jobs gated to `push` events).
   - Job exits 0 (lint + typecheck clean).
   - If the user pushes a tag `mobile-v0.1.0-rc1` after merging Phase 16 to main, `ios-beta` + `android-beta` jobs run; first run is allowed to fail on cert/keystore issues — the gate is that fastlane is *invoked* (proving secrets are wired correctly), not that the upload succeeds.

4. **MOBILE-09 release-tagging gate** (verified in 16-10's UAT, not here): after a successful TestFlight upload, https://leanshot.sentry.io/releases/ shows the `ios@<short_version>` release with attached dSYMs. android@<version_name> shows in https://leanshot.sentry.io/releases/ with attached ProGuard mapping (if R8 enabled in 16-01).
</verification>

<success_criteria>
- [x] `leanshot/fastlane/{Fastfile,Matchfile,Appfile,Gemfile,Gemfile.lock}` all exist; Ruby parses cleanly (no syntax errors); `bundle install` succeeds in the directory.
- [x] `bundle exec fastlane lanes` lists `ios beta` + `android beta` (no extra unintended lanes).
- [x] Fastfile invokes `sentry-cli` ≥4 times (release new + dSYM/mapping upload + finalize per platform × 2 platforms).
- [x] Sentry release tags use the exact literal strings `ios@` and `android@` (matching Plan 16-04's `Sentry.init({ release })`).
- [x] Matchfile references `leanshot-fastlane-match` with `<USER-OR-ORG>` placeholder (replaced at Task 3 checkpoint).
- [x] Appfile pins `app.leanshot.ios` and `app.leanshot.android` (D-10).
- [x] `.github/workflows/mobile.yml` exists, is valid YAML, has 4 jobs (`mobile-lint-typecheck`, `ios-beta`, `android-beta`, `mobile-summary`).
- [x] mobile.yml uses both `macos-latest` and `ubuntu-latest` runners; both lane jobs `needs: [mobile-lint-typecheck]`.
- [x] mobile.yml contains ZERO `privacy-audit` or `audit-privacy-manifest` references (file-ownership boundary with 16-07).
- [x] `leanshot/apps/ios/SECRETS.md` documents EVERY `secrets.X` reference from mobile.yml (string-grep parity); includes a Recovery Playbook section for the D-16 lost-key scenario.
- [x] Task 3 checkpoint completes with either `secrets-provisioned` resume signal OR an explicit `blocked: <vendor>: <details>` signal for orchestrator handoff to 16-10.
- [x] Pathspec commit (per `feedback_parallel_executor_git_isolation.md`): `git commit -- leanshot/fastlane/ leanshot/apps/ios/SECRETS.md .github/workflows/mobile.yml leanshot/.gitignore leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-09-fastlane-ci-mobile-pipeline-SUMMARY.md` — NO `git add -A`.
</success_criteria>

<output>
After completion, create `.planning/phases/16-capacitor-mobile-shells-ios-android/16-09-fastlane-ci-mobile-pipeline-SUMMARY.md` using `@$HOME/.claude/get-shit-done/templates/summary.md`. Include:
- Which D-NN decisions are implemented (D-14, D-16, D-17 — plus the MOBILE-09 release-tagging half of D-17).
- Which secrets were defined vs which were provisioned (Task 3 outcome).
- Whether the dry-run push triggered lane invocation (verifying secrets are wired).
- Any vendor blockers surfaced (for orchestrator to fold into 16-10's UAT plan).
- Open items for 16-10 (e.g., `assetlinks.json` re-signing fingerprint update post-first-Play-upload per Pitfall 6).
</output>
