# Phase 53: Capacitor Mobile Shells (iOS + Android) - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 3 grey areas accepted as recommended

<domain>
## Phase Boundary

Bundle the existing v2 web SPA (`leanshot/`) as installable native iOS + Android apps via Capacitor, with CI per-platform builds, a signing pipeline (gated on secrets), RevenueCat SDK init wired, Universal/App Links config, in-app account deletion reachable on mobile, and a store-metadata package.

**Already in place (do NOT re-scaffold):** Capacitor v8.3.4 (`@capacitor/core`, `/ios`, `/android`, `/cli`) + 13 plugins incl. `@revenuecat/purchases-capacitor@13.1.1`, `@sentry/capacitor@4`, `@capacitor/app`, `@capacitor/preferences`, `@capgo/capacitor-native-biometric`; an existing `leanshot/capacitor.config.ts`; an existing `DeleteAccountModal.tsx` + `account-delete.test.tsx` (web account deletion already shipped); a prior `.github/workflows/mobile-privacy-audit.yml`.

**Net-new this phase:** `ios/` + `android/` platform dirs; iOS + Android build CI workflows; conditional signing pipeline; deep-link association files; RevenueCat init call; ensure mobile Settings exposes account deletion; fastlane store-metadata + privacy nutrition labels scaffold.

Per milestone contract D-08: signed artifacts, TestFlight/Play upload, physical-device cold-launch UAT, and store submission all defer to the Phase 70 consolidated HUMAN-UAT gate.
</domain>

<decisions>
## Implementation Decisions

### Native platform generation & local toolchain
- Generate BOTH platforms: `npx cap add ios` + `npx cap add android`; commit the generated native projects.
- **cocoapods is NOT installed locally** (`pod` not found) — iOS `pod install` + native iOS build DEFER to CI / Phase 70. Executors scaffold dirs + config locally and verify via config validity + web build, NOT via a local iOS build. Android `cap sync` can run locally if Android SDK present; otherwise verify config + defer build to CI.
- Reuse/extend the existing `capacitor.config.ts` and the already-installed plugin set. RevenueCat SDK is already a dependency — wire its `Purchases.configure()` init (API keys `RC_API_KEY_IOS`/`RC_API_KEY_ANDROID` gated/deferred to P70).

### CI build + signing pipeline
- GitHub Actions: macOS runner for iOS, ubuntu for Android. Model on existing `.github/workflows/mobile-privacy-audit.yml` house style.
- Signing steps are **conditional on GH secrets** (Apple cert/provisioning, Play keystore/service-account). When absent → build runs UNSIGNED and green; signed artifacts deferred to P70.
- TestFlight + Play internal-track upload steps PRESENT but gated on secrets; actual upload deferred to P70.

### Deep links, account deletion, store metadata, defer posture
- Ship `apple-app-site-association` + `assetlinks.json` for `app.leanshot.app` with placeholder team/package IDs (suggested `app.leanshot.ios` / `app.leanshot.android` per PROJECT.md); document the real-ID swap as pending in the runbook.
- Reuse the existing `DeleteAccountModal`; ensure it is reachable from mobile Settings (Apple §5.1.1(v) + Play §13.7). No new mobile-only deletion screen.
- Store metadata: fastlane `metadata/` dirs (ios + android) + screenshot placeholders + privacy nutrition labels doc.
- "Done" = platform dirs committed + `cap sync` config valid + unsigned CI build green + deep-link files present + account deletion reachable + fastlane metadata/privacy-labels scaffolded. Signed artifacts / TestFlight / physical-device UAT / store submission → Phase 70.

### UI design contract
- **UI-SPEC skipped intentionally** — this phase ships native-shell infrastructure and REUSES the existing DS-compliant `DeleteAccountModal`; there is no net-new visual surface requiring a design contract. (Per autonomous orchestrator judgment; ui-phase reserved for net-new surfaces in later phases.)

### Claude's Discretion
- Exact CI workflow structure, fastlane lane definitions, capacitor.config server/deep-link settings, and native project bundle-id placeholders are at Claude's discretion within the above constraints.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `leanshot/capacitor.config.ts` — existing Capacitor config to extend.
- `leanshot/package.json` — Capacitor v8.3.4 + 13 plugins + `@revenuecat/purchases-capacitor@13.1.1` + `@sentry/capacitor@4` already installed.
- `leanshot/src/components/dashboard/settings/DeleteAccountModal.tsx` + `leanshot/src/test/account-delete.test.tsx` — account deletion already shipped (web).
- `leanshot/src/components/dashboard/settings/SettingsPage.tsx` — Settings surface that must expose deletion on mobile.
- `.github/workflows/mobile-privacy-audit.yml` — existing mobile CI house style to model build workflows on.

### Established Patterns
- `@sentry/capacitor` sibling-check breaks fresh `npm install` (see memory `reference_sentry_capacitor_npm_install_blocker`) — executors needing node_modules should use `--ignore-scripts` OR symlink main `node_modules`; surface BEFORE plans need install.
- Local-first architecture must be preserved — the webview shell loads the bundled SPA; localStorage + offline must keep working.

### Integration Points
- Native dirs at `leanshot/ios/`, `leanshot/android/` (Capacitor convention; capacitor.config webDir points at the Vite build output).
- Deep-link files: `apple-app-site-association` + `.well-known/assetlinks.json` served from `app.leanshot.app` (Vercel public/ or rewrites).
- CI under `.github/workflows/`.

</code_context>

<specifics>
## Specific Ideas

- xcodebuild IS present locally but cocoapods is NOT — do not attempt local iOS build.
- Suggested bundle/package IDs: `app.leanshot.ios` / `app.leanshot.android` (from PROJECT.md Vendor Accounts table).
- RevenueCat keys, APNs, Apple Team ID, Play service-account are all `pending-provisioning` → smoke-tracked in Phase 52 dashboard, set at Phase 70.

</specifics>

<deferred>
## Deferred Ideas

- Signed IPA/AAB artifacts, TestFlight + Play internal-testing upload, physical-device cold-launch UAT, deep-link resolution on-device, store submission + real metadata/screenshots → Phase 70 HUMAN-UAT.
- Real bundle-id / team-id / service-account substitution into native projects + association files → Phase 70.
- Push notification native wiring → Phase 54 (this phase only adds the shell).
</deferred>
