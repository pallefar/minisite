---
phase: 16-capacitor-mobile-shells-ios-android
plan: "00"
type: execute
wave: 0
depends_on: []
files_modified:
  - leanshot/vitest-mobile.config.ts
  - leanshot/src/lib/native/__mocks__/capacitor-core.ts
  - leanshot/src/lib/native/__mocks__/capacitor-app.ts
  - leanshot/src/lib/native/__mocks__/capacitor-share.ts
  - leanshot/src/lib/native/__mocks__/revenuecat-purchases-capacitor.ts
  - leanshot/src/lib/native/__mocks__/capgo-native-biometric.ts
  - leanshot/scripts/audit-privacy-manifest.mjs
  - leanshot/scripts/sentry-test-crash.mjs
  - leanshot/scripts/seed-photo-soak-fixture.mjs
  - leanshot/playwright.config.ts
  - leanshot/package.json
  - leanshot/.planning/PROJECT.md
autonomous: false
requirements:
  - MOBILE-01
  - MOBILE-02
  - MOBILE-03
  - MOBILE-04
  - MOBILE-05
  - MOBILE-06
  - MOBILE-07
  - MOBILE-08
  - MOBILE-09
  - MOBILE-10
  - MONEY-06
user_setup:
  - service: apple-developer
    why: "TestFlight upload + App Store submission (MOBILE-01); enrolment required before fastlane match can request distribution certs"
    env_vars:
      - name: APPLE_TEAM_ID
        source: "App Store Connect → Membership → Team ID"
      - name: FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD
        source: "appleid.apple.com → Sign-In and Security → App-Specific Passwords"
    dashboard_config:
      - task: "Enrol in Apple Developer Program ($99/yr) and confirm membership active"
        location: "developer.apple.com/programs/enroll"
      - task: "Register bundle ID app.leanshot.ios under Identifiers; enable Associated Domains + Sign In with Apple capabilities"
        location: "developer.apple.com/account/resources/identifiers"
  - service: google-play
    why: "Play Internal upload + Play Store submission (MOBILE-02)"
    env_vars:
      - name: PLAY_JSON_KEY
        source: "Google Cloud Console → Service accounts → Create key (JSON) for Play Console publisher account"
    dashboard_config:
      - task: "Pay one-time $25 Play Console developer registration; create app shell with package name app.leanshot.android"
        location: "play.google.com/console"
  - service: revenuecat
    why: "IAP entitlement provisioning (MONEY-06)"
    env_vars:
      - name: RC_API_KEY_IOS
        source: "RevenueCat dashboard → Project Settings → API keys → iOS public key (prefix appl_)"
      - name: RC_API_KEY_ANDROID
        source: "RevenueCat dashboard → Project Settings → API keys → Android public key (prefix goog_)"
      - name: REVENUECAT_WEBHOOK_SECRET
        source: "RevenueCat dashboard → Integrations → Webhooks → Authorization header value"
    dashboard_config:
      - task: "Create RevenueCat project; add iOS app (bundle app.leanshot.ios) + Android app (package app.leanshot.android)"
        location: "app.revenuecat.com"
      - task: "Create entitlement plus; create products app.leanshot.plus.monthly + app.leanshot.plus.yearly attached to plus entitlement (D-01)"
        location: "app.revenuecat.com → Products"
  - service: supabase-pro
    why: "Storage image transforms (Pro-only) required for D-08 200-photo OOM mitigation BEFORE App Store submission"
    env_vars: []
    dashboard_config:
      - task: "Upgrade project ytnsipxxmzgaebkqmokp from Free → Pro tier ($25/mo); verify Storage → Image Transformations panel becomes visible"
        location: "supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp/settings/billing"
  - service: github-private-repo
    why: "fastlane match certificate sync repo (D-16)"
    env_vars:
      - name: MATCH_GIT_BASIC_AUTHORIZATION
        source: "github.com/settings/tokens → Fine-grained PAT scoped to leanshot-fastlane-match repo with Contents:read+write"
    dashboard_config:
      - task: "Create EMPTY private repo pallefar/leanshot-fastlane-match (5min); do NOT add README/license — match needs empty repo"
        location: "github.com/new"
  - service: dns-leanshot-app
    why: "Universal Links AASA + assetlinks must resolve on leanshot.app AND app.leanshot.app (D-09); Plan 16-03 depends on this"
    env_vars: []
    dashboard_config:
      - task: "Confirm leanshot.app A/CNAME points to Vercel prod (cname.vercel-dns.com) and /.well-known/ paths return 200 for any test file"
        location: "Vercel → Domains panel for leanshot project"

must_haves:
  truths:
    - "All 5 vendor accounts confirmed live with credentials retrievable via CLI/API"
    - "leanshot.app/.well-known/ path reachable and returns 200 from production Vercel deployment"
    - "Capacitor plugin mocks can be imported by future Wave 1 unit tests without invoking native APIs"
    - "Privacy manifest audit script exits non-zero when required-reason entries are absent"
    - "Sentry test-crash script can post a fingerprint via Sentry HTTP store endpoint and confirm receipt via Sentry API"
    - "200-photo Storage seed fixture writes exactly 200 photo rows + signed URLs reachable from a Playwright test"
    - "playwright.config.ts exposes a mobile project that filters to e2e/mobile/**/*.spec.ts"
    - "npm run test:mobile-unit executes vitest-mobile.config.ts in isolation"
  artifacts:
    - path: "leanshot/vitest-mobile.config.ts"
      provides: "Vitest config restricted to src/lib/native/**/*.test.ts with jsdom env + Capacitor auto-mocks"
      contains: "include: ['src/lib/native/**/*.test.ts']"
    - path: "leanshot/src/lib/native/__mocks__/capacitor-core.ts"
      provides: "Vi-mockable replacement for @capacitor/core exporting Capacitor.getPlatform + isNativePlatform"
      exports: ["Capacitor"]
    - path: "leanshot/src/lib/native/__mocks__/capacitor-app.ts"
      provides: "Vi-mockable replacement for @capacitor/app exporting App.addListener + URLOpenListenerEvent type"
      exports: ["App"]
    - path: "leanshot/src/lib/native/__mocks__/capacitor-share.ts"
      provides: "Vi-mockable replacement for @capacitor/share exporting Share.share"
      exports: ["Share"]
    - path: "leanshot/src/lib/native/__mocks__/revenuecat-purchases-capacitor.ts"
      provides: "Vi-mockable replacement for @revenuecat/purchases-capacitor exporting Purchases.configure/getOfferings/purchasePackage/checkTrialOrIntroductoryPriceEligibility"
      exports: ["Purchases", "INTRO_ELIGIBILITY_STATUS"]
    - path: "leanshot/src/lib/native/__mocks__/capgo-native-biometric.ts"
      provides: "Vi-mockable replacement for @capgo/capacitor-native-biometric exporting NativeBiometric.isAvailable + verifyIdentity"
      exports: ["NativeBiometric"]
    - path: "leanshot/scripts/audit-privacy-manifest.mjs"
      provides: "Node CLI that diffs apps/ios/App/App/PrivacyInfo.xcprivacy against the canonical 14-plugin required-reason list; exits 1 on missing entries; emits ::error:: annotations"
      min_lines: 60
    - path: "leanshot/scripts/sentry-test-crash.mjs"
      provides: "Node CLI that POSTs a known crash payload to Sentry store endpoint and polls /api/0/projects/.../events/ for the fingerprint within 60s"
      min_lines: 40
    - path: "leanshot/scripts/seed-photo-soak-fixture.mjs"
      provides: "Service-role admin-client seeder that creates a test user, inserts 200 photo rows into the photos table, uploads 200 distinct PNG blobs to Storage, prints userId + cleanup hint"
      min_lines: 50
    - path: "leanshot/playwright.config.ts"
      provides: "Mobile Playwright project entry (testMatch e2e/mobile/**/*.spec.ts) added alongside existing chromium project"
      contains: "name: 'mobile'"
    - path: "leanshot/package.json"
      provides: "Three new npm scripts: test:mobile-unit, test:mobile-e2e, audit:privacy-manifest"
      contains: "test:mobile-unit"
  key_links:
    - from: "leanshot/vitest-mobile.config.ts"
      to: "leanshot/src/lib/native/__mocks__/*.ts"
      via: "resolve.alias entries that map @capacitor/core, @capacitor/app, @capacitor/share, @revenuecat/purchases-capacitor, @capgo/capacitor-native-biometric to the corresponding __mocks__ files"
      pattern: "alias.*__mocks__"
    - from: "leanshot/playwright.config.ts"
      to: "leanshot/e2e/mobile/"
      via: "projects[].testMatch glob"
      pattern: "e2e/mobile.*spec\\.ts"
    - from: "leanshot/package.json"
      to: "leanshot/vitest-mobile.config.ts"
      via: "test:mobile-unit script invocation"
      pattern: "vitest run --config vitest-mobile.config.ts"
    - from: "leanshot/scripts/audit-privacy-manifest.mjs"
      to: "leanshot/apps/ios/App/App/PrivacyInfo.xcprivacy"
      via: "readFileSync path resolution"
      pattern: "PrivacyInfo\\.xcprivacy"
---

<objective>
Stand up Wave-0 prerequisites for Phase 16 — five external vendor accounts and the test-infrastructure harness that every downstream plan (16-01..16-10) depends on. Without this plan complete, Wave 1 cannot import Capacitor mocks in unit tests, Wave 2 cannot deploy revenuecat-webhook against a Pro-tier Supabase, Wave 3 cannot CI-gate the privacy manifest, and Wave 4 cannot run the 200-photo soak.

Purpose: Eliminate vendor-account circular dependencies (per `feedback_vendor_account_circular_dependency.md`) BEFORE any code change touches `capacitor.config.ts` or `apps/`. Build the test harness FIRST so Wave 1 fills (`platform.ts`, `deeplink.ts`, `share.ts`, `biometric.ts`) can ship with passing unit tests on the same commit.

Output: 5 vendor accounts confirmed via CLI/API where possible; mobile-only vitest config + Capacitor `__mocks__/` folder; audit-privacy-manifest.mjs + sentry-test-crash.mjs + seed-photo-soak-fixture.mjs scripts; mobile Playwright project; 3 new package.json scripts; PROJECT.md vendor-accounts table appended.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@leanshot/.planning/PROJECT.md
@leanshot/.planning/ROADMAP.md
@leanshot/.planning/STATE.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md
@leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-VALIDATION.md
@leanshot/vitest-e2e.config.ts
@leanshot/playwright.config.ts
@leanshot/scripts/assert-bundle-budget.sh
@leanshot/e2e/checkout-trial-flow.spec.ts

<interfaces>
<!-- Key references the executor will mirror — extracted from the codebase. -->

From `leanshot/vitest-e2e.config.ts` (precedent for a sibling vitest config):
- `defineConfig({ resolve: { alias: { '@': fileURLToPath(...) } }, test: { environment, globals, include, testTimeout } })`
- Environment value is `'node'`; for `vitest-mobile.config.ts` use `'jsdom'` because BiometricGate.tsx tests need a DOM in Wave 1.

From `leanshot/playwright.config.ts` (lines 16-21 — existing `projects` array):
- Single `chromium` project today. Phase 16 ADDS a second `mobile` project that filters via `testMatch: /e2e\/mobile\/.*\.spec\.ts$/` and reuses `Desktop Chrome` device for ASO viewport capture + IAP/soak mock runs.
- Top-level `testMatch: /.*\.spec\.ts$/` (line 9) stays; mobile project's `testMatch` narrows further per project.

From `leanshot/scripts/assert-bundle-budget.sh` (CI-gate convention):
- Shebang `#!/usr/bin/env bash` + `set -euo pipefail`
- On failure: `echo "::error::<message>"` then `exit 1`
- On success: `echo "<script-name>: PASS"`
- The .mjs scripts in this plan mirror that contract (write to stderr, exit code, GitHub Actions annotation).

From `leanshot/e2e/checkout-trial-flow.spec.ts` (service-role admin-client pattern reused by seed-photo-soak-fixture.mjs):
- `createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })`
- User creation via `admin.auth.admin.createUser({ email, password, email_confirm: true })`
- Cleanup via `admin.auth.admin.deleteUser(userId)`

From CONTEXT D-01 / D-03 (RevenueCat product IDs — PERMANENT, lock at vendor checkpoint):
- Entitlement: `plus`
- Products: `app.leanshot.plus.monthly`, `app.leanshot.plus.yearly`

From CONTEXT D-10 (bundle IDs — PERMANENT, lock at vendor checkpoint):
- iOS: `app.leanshot.ios`
- Android: `app.leanshot.android`

From RESEARCH §"Standard Stack" — 14-plugin inventory the audit-privacy-manifest.mjs script validates against:
- `@capacitor/core`, `/cli`, `/ios`, `/android`, `/app`, `/preferences`, `/share`, `/splash-screen`, `/status-bar`, `/haptics`, `/browser`, `/keyboard`, `/network`, `/filesystem`, `/clipboard`, `@revenuecat/purchases-capacitor`, `@capgo/capacitor-native-biometric`, `@sentry/capacitor`
- Each entry has a privacy-manifest section in its GitHub README; audit script reads from a static `REQUIRED_REASON_APIS` constant inline.

From VALIDATION.md (Wave 0 requirements list — this plan's exact deliverables):
- `vitest-mobile.config.ts` with Capacitor mocks
- `e2e/mobile/` Playwright project
- `src/lib/native/__mocks__/` for App, Purchases, NativeBiometric, Share
- `scripts/audit-privacy-manifest.mjs`
- `scripts/sentry-test-crash.mjs`
- 200-photo Storage seed fixture
- (`.github/workflows/mobile.yml` is OWNED by Plan 16-09, NOT this plan — do not create it here)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Stand up vitest-mobile config + Capacitor __mocks__ folder + mobile Playwright project + npm scripts</name>
  <files>leanshot/vitest-mobile.config.ts, leanshot/src/lib/native/__mocks__/capacitor-core.ts, leanshot/src/lib/native/__mocks__/capacitor-app.ts, leanshot/src/lib/native/__mocks__/capacitor-share.ts, leanshot/src/lib/native/__mocks__/revenuecat-purchases-capacitor.ts, leanshot/src/lib/native/__mocks__/capgo-native-biometric.ts, leanshot/playwright.config.ts, leanshot/package.json</files>
  <read_first>leanshot/vitest-e2e.config.ts (full file — pattern for sibling vitest config); leanshot/playwright.config.ts lines 1-67 (full — additive append to projects array); leanshot/package.json scripts block (existing "test:unit", "test:e2e", "lint" entries — slot new scripts next to them); leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md §"vitest-mobile.config.ts" (mock pattern reference)</read_first>
  <action>
    Create `vitest-mobile.config.ts` at `leanshot/` root mirroring `vitest-e2e.config.ts` shape with these deltas: `test.environment: 'jsdom'` (BiometricGate.tsx + future component tests need DOM); `test.include: ['src/lib/native/**/*.test.ts', 'src/lib/native/**/*.test.tsx']`; `test.globals: true`; `test.testTimeout: 30000`; `resolve.alias` adds 5 entries beyond `@`: `'@capacitor/core' → ./src/lib/native/__mocks__/capacitor-core.ts`, `'@capacitor/app' → .../capacitor-app.ts`, `'@capacitor/share' → .../capacitor-share.ts`, `'@revenuecat/purchases-capacitor' → .../revenuecat-purchases-capacitor.ts`, `'@capgo/capacitor-native-biometric' → .../capgo-native-biometric.ts`. Each alias resolves via `fileURLToPath(new URL('./src/lib/native/__mocks__/<file>.ts', import.meta.url))`.

    Create the 5 `__mocks__` files. Each file is a vi-mockable manual mock — it exports the SAME-NAMED symbol shape the real plugin exports so Wave 1 production code can `import { Capacitor } from '@capacitor/core'` and the alias resolves to our mock under test. Each mock exports vi-spy-compatible default behavior (return `'web'` from getPlatform, `false` from isNativePlatform, etc.) AND a `__mock` helper object to let individual tests override per-call. Specifically:
    - `capacitor-core.ts`: export `const Capacitor = { getPlatform: vi.fn(() => 'web'), isNativePlatform: vi.fn(() => false) }` + `export const __mock = { reset() { Capacitor.getPlatform.mockReturnValue('web'); Capacitor.isNativePlatform.mockReturnValue(false); } }`. Import `vi` from `'vitest'`.
    - `capacitor-app.ts`: export `App = { addListener: vi.fn(async (event, handler) => ({ remove: vi.fn() })) }` + `export type URLOpenListenerEvent = { url: string }` + `__mock` reset.
    - `capacitor-share.ts`: export `Share = { share: vi.fn(async (_opts) => ({ activityType: 'mock' })) }` + `__mock` reset.
    - `revenuecat-purchases-capacitor.ts`: export `Purchases = { configure: vi.fn(async () => undefined), getOfferings: vi.fn(async () => ({ current: null })), purchasePackage: vi.fn(async () => ({ customerInfo: { entitlements: { active: {} } } })), checkTrialOrIntroductoryPriceEligibility: vi.fn(async () => ({})) }` + `export const INTRO_ELIGIBILITY_STATUS = { INTRO_ELIGIBILITY_STATUS_UNKNOWN: 0, INTRO_ELIGIBILITY_STATUS_INELIGIBLE: 1, INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 2, INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS: 3 }` + `__mock` reset.
    - `capgo-native-biometric.ts`: export `NativeBiometric = { isAvailable: vi.fn(async () => ({ isAvailable: true, biometryType: 'FACE_ID' })), verifyIdentity: vi.fn(async () => undefined) }` + `__mock` reset.

    Modify `leanshot/playwright.config.ts` `projects` array: APPEND a second project after the existing `chromium` entry: `{ name: 'mobile', testMatch: /e2e\/mobile\/.*\.spec\.ts$/, use: { ...devices['Desktop Chrome'], viewport: { width: 430, height: 932 } } }`. Do NOT change the existing `chromium` project. Add a header comment above the new project block: `// Phase 16 16-00: mobile-only Playwright project for IAP flow + 200-photo soak + ASO viewport capture. Filters by e2e/mobile/** so it never picks up chromium specs.`

    Modify `leanshot/package.json` scripts block: APPEND three new scripts immediately after the existing `test:e2e` entry:
    - `"test:mobile-unit": "vitest run --config vitest-mobile.config.ts"`
    - `"test:mobile-e2e": "playwright test --project=mobile"`
    - `"audit:privacy-manifest": "node scripts/audit-privacy-manifest.mjs"`

    NO fenced code in this action — refer to `<read_first>` files for exact shape. Use real `vi.fn()` (not type stubs). Do NOT add `vi` mocks of `@sentry/capacitor` — Wave 2 / Plan 16-04 owns Sentry mock surfaces.
  </action>
  <acceptance_criteria>
    - `cat leanshot/vitest-mobile.config.ts | grep -c "environment: 'jsdom'"` returns `1`
    - `cat leanshot/vitest-mobile.config.ts | grep -c "src/lib/native/__mocks__"` returns at least `5` (one alias per mocked package)
    - `ls leanshot/src/lib/native/__mocks__/ | wc -l` returns `5`
    - Each of the 5 mock files contains an `import { vi } from 'vitest'` line and exports the named symbol from the table above (grep one symbol per file: `grep -l "export const Capacitor" leanshot/src/lib/native/__mocks__/capacitor-core.ts`, `grep -l "export const App" leanshot/src/lib/native/__mocks__/capacitor-app.ts`, `grep -l "export const Share" leanshot/src/lib/native/__mocks__/capacitor-share.ts`, `grep -l "export const Purchases" leanshot/src/lib/native/__mocks__/revenuecat-purchases-capacitor.ts`, `grep -l "export const NativeBiometric" leanshot/src/lib/native/__mocks__/capgo-native-biometric.ts`)
    - `grep -c "name: 'mobile'" leanshot/playwright.config.ts` returns `1`
    - `grep -c "e2e/mobile" leanshot/playwright.config.ts` returns at least `1`
    - `grep -c '"test:mobile-unit"' leanshot/package.json` returns `1`
    - `grep -c '"test:mobile-e2e"' leanshot/package.json` returns `1`
    - `grep -c '"audit:privacy-manifest"' leanshot/package.json` returns `1`
    - `cd leanshot && npx vitest run --config vitest-mobile.config.ts --reporter=basic` exits 0 with `No test files found` (no tests yet — Wave 1 adds them; the config must LOAD without error)
    - `cd leanshot && npx playwright test --project=mobile --list` exits 0 with `Total: 0 tests` (no specs yet — Wave 2/4 adds them)
  </acceptance_criteria>
  <verify>
    <automated>cd leanshot && grep -c "environment: 'jsdom'" vitest-mobile.config.ts && grep -c "name: 'mobile'" playwright.config.ts && grep -c '"test:mobile-unit"' package.json && ls src/lib/native/__mocks__/ | wc -l | xargs -I{} test {} = 5 && npx vitest run --config vitest-mobile.config.ts --reporter=basic 2>&1 | grep -E "No test files found|0 passed" && npx playwright test --project=mobile --list 2>&1 | grep -E "Total: 0 tests|listed 0"</automated>
  </verify>
  <done>vitest-mobile.config.ts loads without error; mobile Playwright project lists 0 specs cleanly; all 5 `__mocks__/*.ts` exist with vitest-mockable symbol exports; 3 new npm scripts added.</done>
</task>

<task type="auto">
  <name>Task 2: Author audit-privacy-manifest.mjs + sentry-test-crash.mjs + seed-photo-soak-fixture.mjs harness scripts</name>
  <files>leanshot/scripts/audit-privacy-manifest.mjs, leanshot/scripts/sentry-test-crash.mjs, leanshot/scripts/seed-photo-soak-fixture.mjs</files>
  <read_first>leanshot/scripts/assert-bundle-budget.sh (CI-gate convention — shebang, set -euo pipefail, ::error:: annotation, exit codes); leanshot/e2e/checkout-trial-flow.spec.ts lines 24-50 + 130-144 (service-role admin client pattern + createUser + deleteUser cleanup); leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md §"Standard Stack" (14-plugin inventory for REQUIRED_REASON_APIS table); leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md §"scripts/audit-privacy-manifest.mjs" (Node .mjs pattern)</read_first>
  <action>
    Create three Node ESM CLI scripts. Each script has shebang `#!/usr/bin/env node`, uses native `node:fs/promises` + `node:path` + global `fetch` (Node 22+ per CONTEXT D-05 correction), emits `::error::<message>` on failure with exit code 1, emits `<script-name>: PASS` on success with exit code 0.

    `scripts/audit-privacy-manifest.mjs`: Reads `apps/ios/App/App/PrivacyInfo.xcprivacy` from the leanshot project root resolved via `path.resolve(import.meta.dirname, '..', 'apps/ios/App/App/PrivacyInfo.xcprivacy')`. The xcprivacy file is XML plist format, not JSON — use a minimal regex-based scanner OR `JSON.parse`-fallback that documents itself as XML-tolerant (script comment must say `// PrivacyInfo.xcprivacy is XML plist; we scan via regex against required-reason API keys — sufficient for CI gate, full XML parse is overkill`). Hard-code the canonical required-reason API list as a top-level `const REQUIRED_APIS = ['NSPrivacyAccessedAPICategoryUserDefaults', 'NSPrivacyAccessedAPICategoryFileTimestamp', 'NSPrivacyAccessedAPICategorySystemBootTime', 'NSPrivacyAccessedAPICategoryDiskSpace', 'NSPrivacyAccessedAPICategoryActiveKeyboards']` (per Apple's canonical 5 + future plugin-specific entries appended by Plan 16-07). Script also hard-codes the 14-plugin inventory as `const PLUGIN_INVENTORY = ['@capacitor/core', '@capacitor/app', '@capacitor/preferences', '@capacitor/share', '@capacitor/splash-screen', '@capacitor/status-bar', '@capacitor/haptics', '@capacitor/browser', '@capacitor/keyboard', '@capacitor/network', '@capacitor/filesystem', '@capacitor/clipboard', '@revenuecat/purchases-capacitor', '@capgo/capacitor-native-biometric']` (14 entries). If the xcprivacy file does NOT yet exist (Wave 0 — Plan 16-07 hasn't filled it), the script must exit 0 with `audit-privacy-manifest: SKIPPED (xcprivacy not yet created — pre-Wave-3)` so CI can wire this script BEFORE Plan 16-07 ships. Once xcprivacy exists: for each REQUIRED_API string, verify presence in file content; for any miss, emit `::error::Privacy manifest missing required-reason: <API>` and exit 1.

    `scripts/sentry-test-crash.mjs`: Reads `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` from `process.env`. If either is absent, exit 0 with `sentry-test-crash: SKIPPED (SENTRY_DSN or SENTRY_AUTH_TOKEN not set)`. Generates a unique fingerprint via `crypto.randomUUID()`; constructs a Sentry envelope payload with `event_id`, `tags.test-crash`, `message: 'phase-16-wave-0-harness-test-crash <fingerprint>'`; POSTs to the DSN's store endpoint derived from parsing the DSN URL (`https://<key>@<host>/<projectId>` → POST `https://<host>/api/<projectId>/store/`); then polls the Sentry API at `https://sentry.io/api/0/projects/<org>/<project>/events/?query=<fingerprint>` with `Authorization: Bearer ${SENTRY_AUTH_TOKEN}` every 5s up to 60s. On match, emit `sentry-test-crash: PASS (fingerprint=<uuid> matched)` and exit 0. On timeout, emit `::error::Sentry did not ingest the fingerprint within 60s — DSN/auth token may be wrong` exit 1. The Sentry organization slug + project slug must be read from `SENTRY_ORG` + `SENTRY_PROJECT` env vars (also skip if absent — Wave 0 doesn't strictly need this to pass; Plan 16-04 will populate the env at CI time).

    `scripts/seed-photo-soak-fixture.mjs`: Reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `process.env`. If either absent, exit 1 with `::error::seed-photo-soak-fixture requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY`. Imports `createClient` from `'@supabase/supabase-js'` (already installed). Creates admin client with `{ auth: { autoRefreshToken: false, persistSession: false } }`. Accepts optional `--count <N>` CLI arg defaulting to `200`. Creates a test user via `admin.auth.admin.createUser({ email: \`photo-soak-${Date.now()}@leanshot.test\`, password: crypto.randomUUID(), email_confirm: true })`. Generates N 1x1 PNG byte blobs (use a constant 67-byte PNG header — `Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')`); for each blob: upload to Storage bucket `photos` under path `${userId}/soak-${i}.png` via `admin.storage.from('photos').upload(path, buffer, { contentType: 'image/png' })`, then insert a row in `public.photos` table with columns matching the existing schema (script must `SELECT column_name FROM information_schema.columns WHERE table_name='photos'` first to introspect — do NOT hard-code columns). Print `{ userId, fixturePrefix: 'photo-soak-<timestamp>', count }` as JSON to stdout on success; print the cleanup command on stderr: `node scripts/seed-photo-soak-fixture.mjs --cleanup <userId>`. Support a `--cleanup <userId>` flag that calls `admin.auth.admin.deleteUser(userId)` (cascade-deletes photos via FK ON DELETE CASCADE assumed; if photos table has no cascade, also DELETE FROM public.photos WHERE user_id=userId BEFORE deleteUser).

    All three scripts: ESM (.mjs), no transpile step, use top-level await, exit codes 0/1, `console.log` for success and `console.error('::error::...')` for failure. NEVER inline secrets. NEVER use `process.env.<X>!` (TypeScript bang) — these are `.mjs` so use `if (!process.env.X) { ... }` early-exit guards.
  </action>
  <acceptance_criteria>
    - `ls leanshot/scripts/audit-privacy-manifest.mjs leanshot/scripts/sentry-test-crash.mjs leanshot/scripts/seed-photo-soak-fixture.mjs` returns all 3 paths
    - Each script starts with `#!/usr/bin/env node` (`head -1 leanshot/scripts/audit-privacy-manifest.mjs | grep -c '^#!/usr/bin/env node'` returns `1`, same for the other 2)
    - `node leanshot/scripts/audit-privacy-manifest.mjs` exits 0 with `audit-privacy-manifest: SKIPPED` (xcprivacy not yet created — Plan 16-07 fills later)
    - `SENTRY_DSN= SENTRY_AUTH_TOKEN= node leanshot/scripts/sentry-test-crash.mjs` exits 0 with `sentry-test-crash: SKIPPED (SENTRY_DSN or SENTRY_AUTH_TOKEN not set)`
    - `node leanshot/scripts/seed-photo-soak-fixture.mjs` (no env) exits 1 with `::error::seed-photo-soak-fixture requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY`
    - `grep -c "REQUIRED_APIS" leanshot/scripts/audit-privacy-manifest.mjs` returns at least `1`
    - `grep -c "PLUGIN_INVENTORY" leanshot/scripts/audit-privacy-manifest.mjs` returns at least `1`
    - `grep -E "@capacitor/(core|app|preferences|share|splash-screen|status-bar|haptics|browser|keyboard|network|filesystem|clipboard)|@revenuecat/purchases-capacitor|@capgo/capacitor-native-biometric" leanshot/scripts/audit-privacy-manifest.mjs | grep -v '^//' | wc -l` returns at least `14` (one entry per plugin in PLUGIN_INVENTORY array, with comment lines filtered out per grep-gate-hygiene rule)
    - `grep -c "crypto.randomUUID" leanshot/scripts/sentry-test-crash.mjs` returns at least `1`
    - `grep -c "admin.auth.admin.createUser" leanshot/scripts/seed-photo-soak-fixture.mjs` returns at least `1`
    - `grep -c "admin.auth.admin.deleteUser" leanshot/scripts/seed-photo-soak-fixture.mjs` returns at least `1` (cleanup path)
    - `grep -c "::error::" leanshot/scripts/audit-privacy-manifest.mjs leanshot/scripts/sentry-test-crash.mjs leanshot/scripts/seed-photo-soak-fixture.mjs` returns at least `3` (one per script)
  </acceptance_criteria>
  <verify>
    <automated>cd leanshot && node scripts/audit-privacy-manifest.mjs 2>&1 | grep -E "audit-privacy-manifest: (SKIPPED|PASS)" && SENTRY_DSN= SENTRY_AUTH_TOKEN= node scripts/sentry-test-crash.mjs 2>&1 | grep -E "sentry-test-crash: SKIPPED" && (node scripts/seed-photo-soak-fixture.mjs 2>&1; test $? -eq 1) | grep -E "::error::seed-photo-soak-fixture requires" && grep -c "REQUIRED_APIS\|PLUGIN_INVENTORY" scripts/audit-privacy-manifest.mjs | xargs -I{} test {} -ge 2</automated>
  </verify>
  <done>3 harness scripts authored; each follows the assert-bundle-budget.sh CI-gate convention (shebang, ::error:: annotation, exit codes 0/1); each gracefully SKIPs when its prerequisites (xcprivacy file, Sentry env, Supabase env) are absent, allowing the scripts to be wired into CI in Plan 16-09 BEFORE the prerequisites land.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 3: Vendor checkpoint — Apple Developer Program enrolment + bundle ID app.leanshot.ios + Associated Domains/Sign In with Apple capabilities</name>
  <what-built>None (vendor account is the deliverable). This checkpoint records that Apple Developer membership is active and bundle ID `app.leanshot.ios` is reserved under Identifiers with Associated Domains + Sign In with Apple capabilities enabled (D-10 PERMANENT lock).</what-built>
  <how-to-verify>
    Claude has already attempted CLI verification before reaching this checkpoint:

    1. If `xcrun simctl list` returns simulators, Xcode CLI tools are installed (precondition).
    2. Once you (the user) report enrolment is active, Claude can verify Team ID via App Store Connect API IF you provide an API key (Issuer ID + Key ID + .p8 file), but most users find the dashboard quicker.

    User-side steps:
    1. Open https://developer.apple.com/programs/enroll/ and confirm membership status shows "Active" (this requires the $99 annual fee already paid — if not paid yet, halt here and complete payment first).
    2. Open https://developer.apple.com/account/resources/identifiers/list and click "+" → App IDs → App → Continue.
    3. Description: "LeanShot iOS"; Bundle ID: Explicit → `app.leanshot.ios` (per CONTEXT D-10 — PERMANENT).
    4. Enable capabilities: ☑ Associated Domains, ☑ Sign In with Apple, ☑ Push Notifications (Phase 17 will need it; enable now).
    5. Save.
    6. Capture your Team ID from https://developer.apple.com/account → Membership → Team ID (10-char alphanumeric).
    7. Generate an App-Specific Password at https://appleid.apple.com → Sign-In and Security → App-Specific Passwords → "fastlane-leanshot" (16-char dashed).
    8. Report back with:
       - `Team ID: <10-char value>`
       - `App-Specific Password: <16-char value>` (will be stored in repo Secrets, not committed)
       - Confirmation of "bundle ID app.leanshot.ios reserved with Associated Domains + Sign In with Apple enabled"
  </how-to-verify>
  <resume-signal>Reply `apple-done <TEAM_ID> <ASP>` (e.g., `apple-done ABCD123456 abcd-efgh-ijkl-mnop`) — Claude will store both in the repo's GitHub Secrets via `gh secret set APPLE_TEAM_ID -b <value>` + `gh secret set FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD -b <value>` (will request `gh auth login` if not authenticated).</resume-signal>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 4: Vendor checkpoint — Google Play Console registration + app shell with package app.leanshot.android + service-account JSON</name>
  <what-built>None (vendor account is the deliverable). This checkpoint records that Play Console developer registration ($25 one-time) is complete, app shell `app.leanshot.android` is created in Play Console, and a Google Cloud service-account JSON key for fastlane Play upload exists.</what-built>
  <how-to-verify>
    Claude has already attempted CLI verification:

    1. Claude tried `gcloud auth list` to detect if a Google Cloud project + service account already exists — if you have `gcloud` installed and authenticated to a project linked to Play Console, Claude can run `gcloud iam service-accounts list --filter='displayName:fastlane-play-leanshot'` to confirm.
    2. If `gcloud` is not configured or no fastlane SA exists, this becomes a human checkpoint.

    User-side steps:
    1. Open https://play.google.com/console/signup and complete developer registration ($25 one-time, ~24-48h account verification).
    2. Once verified: Play Console → All apps → Create app → "LeanShot" → default language EN-US → Free → declarations checked → Create app.
    3. App → Setup → App integrity → SHA-1 will be requested by fastlane in Plan 16-09 (skip for now); for now, the app shell with package name `app.leanshot.android` (per CONTEXT D-10 — PERMANENT) is the deliverable.
    4. Open https://console.cloud.google.com/iam-admin/serviceaccounts → Create service account → name `fastlane-play-leanshot` → Grant role `Service Account User` → Create.
    5. Click the new SA → Keys → Add key → JSON → download the .json file.
    6. Back in Play Console → Setup → API access → Link Google Cloud project → grant the SA `Admin (all permissions)` access to your apps.
    7. Report back with:
       - Confirmation of "Play Console registration verified + app app.leanshot.android shell created"
       - Path to downloaded service-account JSON file (e.g., `~/Downloads/leanshot-play-svcacct-abc123.json`) — Claude will base64-encode it and store as `PLAY_JSON_KEY` GitHub Secret without committing.
  </how-to-verify>
  <resume-signal>Reply `play-done <path-to-json-key>` — Claude will run `base64 -i <path> | gh secret set PLAY_JSON_KEY` then move the JSON file to `~/.leanshot-secrets/` (gitignored) and delete from Downloads.</resume-signal>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 5: Vendor checkpoint — RevenueCat project + iOS+Android apps + plus entitlement + 2 products (monthly+yearly)</name>
  <what-built>None (vendor account is the deliverable). This checkpoint records that RevenueCat is fully configured per D-01 + D-03: 1 entitlement `plus`, 2 products `app.leanshot.plus.monthly` + `app.leanshot.plus.yearly` (PERMANENT names), iOS app linked to bundle `app.leanshot.ios`, Android app linked to package `app.leanshot.android`, and 3 API keys retrievable.</what-built>
  <how-to-verify>
    Claude can verify via the RevenueCat REST API if you provide a temporary secret key, but RC's public+secret keys must come from the dashboard initially.

    CLI verification (after you complete dashboard steps and report the keys back):
    1. `curl -sS -H "Authorization: Bearer <RC_SECRET_API_KEY>" https://api.revenuecat.com/v2/projects` → confirms the project exists.
    2. `curl -sS -H "Authorization: Bearer <RC_SECRET_API_KEY>" https://api.revenuecat.com/v2/projects/<projectId>/products` → confirms 2 products present.

    User-side steps:
    1. Open https://app.revenuecat.com/signup and create account (free tier is sufficient until first paid sub).
    2. Create project "LeanShot" → Add iOS app → name "LeanShot iOS", bundle ID `app.leanshot.ios` (must MATCH Apple bundle ID from Task 3) → connect App Store Connect via shared-secret OR App Store Server API key (App Store Server API key recommended — paste the .p8 from Apple Developer → Users and Access → Keys → "App Store Server API" → "+" → "App Store Server API" key).
    3. Add Android app → name "LeanShot Android", package `app.leanshot.android` (must MATCH Play package from Task 4) → connect via Play Service Account JSON (same JSON from Task 4).
    4. Project → Entitlements → "+" → identifier `plus` → save.
    5. Project → Products → "+" → identifier `app.leanshot.plus.monthly` → Type: Subscription → attach to entitlement `plus` → save. Repeat for `app.leanshot.plus.yearly`.
    6. Project Settings → API keys → copy:
       - Public iOS key (prefix `appl_`)
       - Public Android key (prefix `goog_`)
       - Project's V2 Secret API key (prefix `sk_`)
    7. Integrations → Webhooks → "+" → URL: leave blank for now (Plan 16-06 fills it after revenuecat-webhook Edge Function is deployed) → Authorization header: generate a random 32-byte hex string (you can use `openssl rand -hex 32`) → save the authorization value as `REVENUECAT_WEBHOOK_SECRET`.
    8. Report back with all 4 values.
  </how-to-verify>
  <resume-signal>Reply `revenuecat-done` and provide the 4 values inline (Claude will not log them to stdout). Claude will run 4 `gh secret set` invocations (`RC_API_KEY_IOS`, `RC_API_KEY_ANDROID`, `RC_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`) AND `supabase secrets set REVENUECAT_WEBHOOK_SECRET=<value>` (since Plan 16-06's Edge Function needs it server-side).</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 6: Vendor checkpoint — Supabase project ytnsipxxmzgaebkqmokp upgraded Free → Pro tier + Storage transforms verified</name>
  <what-built>Supabase project upgraded from Free → Pro tier ($25/mo) so Storage image transforms become available (D-08 prerequisite for OOM mitigation BEFORE App Store submission).</what-built>
  <how-to-verify>
    Claude attempts CLI verification BEFORE asking you:

    1. `cd leanshot && npx supabase projects list --output json | jq '.[] | select(.id=="ytnsipxxmzgaebkqmokp") | .subscription_tier'` — if this returns `"pro"`, Pro is already active and this checkpoint passes automatically.
    2. If it returns `"free"` or null, this becomes a human checkpoint.

    Once Pro is confirmed via the CLI, Claude additionally:
    3. Probes Storage transforms by uploading a test image via `npx supabase storage cp ./test.png ss://photos/transform-probe.png` and fetching `https://ytnsipxxmzgaebkqmokp.supabase.co/storage/v1/render/image/public/photos/transform-probe.png?width=100` → expects HTTP 200 with `content-type: image/webp` or `image/png`.

    User-side steps (only if the CLI shows free tier):
    1. Open https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp/settings/billing
    2. Click "Upgrade subscription" → Pro tier → enter card → confirm $25/mo charge.
    3. Wait ~60s for billing webhook to propagate.
    4. Verify Storage → Image Transformations panel appears in the dashboard sidebar.
    5. Reply with `supabase-pro-done`.
  </how-to-verify>
  <resume-signal>Reply `supabase-pro-done` — Claude will re-run `npx supabase projects list --output json` to confirm `subscription_tier: "pro"` AND post a Storage transform probe to confirm `/render/image/` endpoint returns 200.</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 7: Vendor checkpoint — leanshot-fastlane-match private GitHub repo + leanshot.app DNS reachability</name>
  <what-built>Two related deliverables: (a) empty private GitHub repo `pallefar/leanshot-fastlane-match` exists (D-16 prereq for fastlane match in Plan 16-09); (b) `leanshot.app` DNS resolves to Vercel prod and `/.well-known/` paths return 200 (D-09 prereq for Plan 16-03 AASA + assetlinks publication).</what-built>
  <how-to-verify>
    Claude verifies BOTH via CLI first:

    1. `gh repo view pallefar/leanshot-fastlane-match --json visibility,isEmpty 2>&1` — expects `{"visibility": "PRIVATE", "isEmpty": true}`. If `not found`, repo needs creating.
    2. `curl -sSI https://leanshot.app/ -o /dev/null -w '%{http_code}\n'` — expects `200`. If `404` or DNS failure, DNS not configured.
    3. `curl -sSI https://leanshot.app/.well-known/probe-16-00.txt -o /dev/null -w '%{http_code}\n'` — expects `404` (file doesn't exist YET but the `.well-known/` path-prefix must NOT be blocked by Vercel header rules — 404 is the right answer; anything else means the path is intercepted).
    4. `dig +short A leanshot.app | head -1` — expects a Vercel IP range (76.76.21.21 or similar A record) OR `cname.vercel-dns.com` from `dig +short CNAME leanshot.app`.

    If steps 1-4 all pass cleanly, Claude flags this checkpoint as auto-passed without needing user action.

    User-side steps (only if any CLI check fails):
    - Repo: `gh repo create pallefar/leanshot-fastlane-match --private --description "fastlane match certs for LeanShot iOS — DO NOT delete"` (Claude can run this if you confirm `gh auth status` is authenticated and you want it to). Do NOT add README/license — match needs an empty repo.
    - DNS: confirm leanshot.app is added as a domain to the leanshot Vercel project. Open https://vercel.com/pallefar/leanshot/settings/domains and add `leanshot.app` if absent; Vercel will instruct on the A/CNAME records to add at the DNS registrar.
  </how-to-verify>
  <resume-signal>Reply `match-and-dns-done` — Claude will re-run all 4 CLI checks and record results in the final SUMMARY.md.</resume-signal>
</task>

<task type="auto">
  <name>Task 8: Append vendor-accounts table to PROJECT.md + commit Wave-0 harness + close plan</name>
  <files>leanshot/.planning/PROJECT.md</files>
  <read_first>leanshot/.planning/PROJECT.md (entire file — find the "Current State" section or the bottom of file; append a new "## Vendor Accounts" H2 there so subsequent phases can see what's provisioned without re-discovering)</read_first>
  <action>
    APPEND (do not overwrite) to `leanshot/.planning/PROJECT.md` a new H2 section titled `## Vendor Accounts (Phase 16 Wave 0)` immediately above the trailing `<!-- GSD:profile-start -->` marker if present, otherwise at the end of the file. The section is a markdown table with columns `Vendor | Account ID/Slug | Status | Secret Names | Provisioned Plan`:

    Rows (one per vendor; replace placeholder `<...>` with the actual values gathered during Tasks 3-7):
    - Apple Developer | Team ID `<TEAM_ID>` | ACTIVE | `APPLE_TEAM_ID`, `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD` | 16-00 (Task 3)
    - Google Play Console | Package `app.leanshot.android` | ACTIVE | `PLAY_JSON_KEY` (base64) | 16-00 (Task 4)
    - RevenueCat | Project "LeanShot" | ACTIVE — 1 entitlement `plus` + 2 products (`app.leanshot.plus.monthly`, `app.leanshot.plus.yearly`) | `RC_API_KEY_IOS`, `RC_API_KEY_ANDROID`, `RC_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_SECRET` | 16-00 (Task 5)
    - Supabase Pro | Project `ytnsipxxmzgaebkqmokp` | PRO tier | (uses existing `SUPABASE_*` secrets) | 16-00 (Task 6)
    - GitHub fastlane-match | `pallefar/leanshot-fastlane-match` | PRIVATE+EMPTY | `MATCH_GIT_BASIC_AUTHORIZATION` (set later in Plan 16-09) | 16-00 (Task 7)
    - DNS leanshot.app | A/CNAME → Vercel | LIVE — `.well-known/` reachable | n/a | 16-00 (Task 7)

    Add a short prose paragraph above the table: `These accounts were provisioned during Phase 16 Wave 0. Secret values are stored in GitHub Actions Secrets (gh secret list) and, where Edge Functions need server-side access, also in Supabase Function Secrets (supabase secrets list). Do NOT commit secret values to the repo.`

    Then commit the entire Wave-0 harness as a single commit with message `feat(16-00): wave-0 harness + vendor checkpoints` using pathspec-scoped git add per `feedback_parallel_executor_git_isolation.md`:

    Files to stage (use explicit pathspec — NEVER `git add .`):
    - `leanshot/vitest-mobile.config.ts`
    - `leanshot/src/lib/native/__mocks__/capacitor-core.ts`
    - `leanshot/src/lib/native/__mocks__/capacitor-app.ts`
    - `leanshot/src/lib/native/__mocks__/capacitor-share.ts`
    - `leanshot/src/lib/native/__mocks__/revenuecat-purchases-capacitor.ts`
    - `leanshot/src/lib/native/__mocks__/capgo-native-biometric.ts`
    - `leanshot/scripts/audit-privacy-manifest.mjs`
    - `leanshot/scripts/sentry-test-crash.mjs`
    - `leanshot/scripts/seed-photo-soak-fixture.mjs`
    - `leanshot/playwright.config.ts`
    - `leanshot/package.json`
    - `leanshot/.planning/PROJECT.md`
    - `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-00-vendor-checkpoints-wave-0-harness-SUMMARY.md` (written by execute-plan from the summary template — emit after the commit if execute-plan flow demands it, otherwise include in the commit)

    Verify the working tree is clean post-commit via `git status --porcelain leanshot/` — must return empty for the listed paths.
  </action>
  <acceptance_criteria>
    - `grep -c "^## Vendor Accounts" leanshot/.planning/PROJECT.md` returns at least `1`
    - `grep -c "app.leanshot.plus.monthly" leanshot/.planning/PROJECT.md` returns at least `1` (verifies the RevenueCat row landed with the PERMANENT product ID)
    - `grep -c "ytnsipxxmzgaebkqmokp" leanshot/.planning/PROJECT.md | xargs test 1 -le` (the Supabase Pro row references the project ref)
    - `git log -1 --format='%s' -- leanshot/vitest-mobile.config.ts` returns exactly `feat(16-00): wave-0 harness + vendor checkpoints`
    - `git status --porcelain leanshot/vitest-mobile.config.ts leanshot/src/lib/native/__mocks__/ leanshot/scripts/audit-privacy-manifest.mjs leanshot/scripts/sentry-test-crash.mjs leanshot/scripts/seed-photo-soak-fixture.mjs leanshot/playwright.config.ts leanshot/package.json leanshot/.planning/PROJECT.md` returns empty (all staged + committed)
    - `gh secret list 2>&1 | grep -E "APPLE_TEAM_ID|FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD|PLAY_JSON_KEY|RC_API_KEY_IOS|RC_API_KEY_ANDROID|RC_SECRET_API_KEY|REVENUECAT_WEBHOOK_SECRET" | wc -l` returns at least `7`
    - `npx supabase secrets list 2>&1 | grep -c REVENUECAT_WEBHOOK_SECRET` returns `1` (Plan 16-06's Edge Function will need it server-side)
  </acceptance_criteria>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && grep -c "^## Vendor Accounts" leanshot/.planning/PROJECT.md && grep -c "app.leanshot.plus.monthly" leanshot/.planning/PROJECT.md && git log -1 --format='%s' -- leanshot/vitest-mobile.config.ts | grep -F "feat(16-00): wave-0 harness + vendor checkpoints" && test -z "$(git status --porcelain leanshot/vitest-mobile.config.ts leanshot/scripts/audit-privacy-manifest.mjs)" && gh secret list 2>&1 | grep -cE "APPLE_TEAM_ID|FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD|PLAY_JSON_KEY|RC_API_KEY_IOS|RC_API_KEY_ANDROID|RC_SECRET_API_KEY|REVENUECAT_WEBHOOK_SECRET" | xargs -I{} test {} -ge 7</automated>
  </verify>
  <done>PROJECT.md has a Vendor Accounts table that downstream phases (17, 18, 19, 20, 21) can read; Wave-0 harness committed in one pathspec-scoped commit; 7+ GitHub Secrets and 1 Supabase Function Secret in place; working tree clean for all 16-00 paths.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Developer machine ↔ Apple Developer dashboard | Apple ID + ASP credentials; if leaked, attacker can submit malicious builds under Team ID |
| Developer machine ↔ Google Play Console + Google Cloud SA JSON | SA JSON enables Play uploads; if leaked, attacker can ship malicious AAB to internal track |
| Developer machine ↔ RevenueCat dashboard | RC secret API key + webhook authorization secret; if leaked, attacker can forge webhook events that downgrade/upgrade users |
| GitHub Actions runner ↔ leanshot-fastlane-match private repo | match repo contains encrypted distribution certs + provisioning profiles; PAT leak = signing-cert leak |
| `leanshot.app` Vercel deployment ↔ public internet | AASA/assetlinks file integrity; if compromised, attacker can redirect Universal Links to a phishing app |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-00-01 | Spoofing | RevenueCat webhook endpoint | mitigate | Generate 32-byte hex `REVENUECAT_WEBHOOK_SECRET` via `openssl rand -hex 32` in Task 5; store in BOTH GitHub Secrets AND Supabase Function Secrets; Plan 16-06's Edge Function does HMAC-SHA256 verify of the raw body before any side-effect (mirrors stripe-webhook pattern per 16-PATTERNS.md). Webhook URL itself is set to blank in Task 5 and configured by Plan 16-06 after deployment — prevents premature exposure. |
| T-16-00-02 | Tampering | leanshot-fastlane-match private repo | mitigate | Repo created with `--private` visibility in Task 7; never `--public`. PAT scoped to single repo with `Contents:read+write` ONLY (no `admin` or `delete_repo`). Match-encryption password (`MATCH_PASSWORD`) is a SEPARATE secret stored in 1Password Vault per D-16 — required to decrypt the certs even if PAT leaks. |
| T-16-00-03 | Information disclosure | Service-account JSONs (Apple ASP, Play SA JSON, RC secret key) | mitigate | All secrets stored via `gh secret set` (encrypted at rest by GitHub) and never echoed to stdout in this plan's verify commands. Task 4 explicitly moves the Play SA JSON to `~/.leanshot-secrets/` (gitignored path) and deletes the Downloads copy. The 5 mock files in Task 1 do NOT contain any real credentials — only vi.fn() stubs. |
| T-16-00-04 | Information disclosure | Supabase service-role key in seed-photo-soak-fixture.mjs | mitigate | Script reads from `process.env.SUPABASE_SERVICE_ROLE_KEY` only; exits 1 immediately if absent. Never logs the key value. CI runs the seeder only on the mobile.yml workflow (Plan 16-09 ownership) with the secret injected via `${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}` — never on PR-from-fork workflows. |
| T-16-00-05 | Elevation of privilege | Capacitor mock files in `__mocks__/` | accept | The mock files only execute under `vitest-mobile.config.ts` — production builds (Vite) do NOT resolve the `__mocks__/` aliases because `vite.config.ts` does not set those aliases. Risk surface: a developer accidentally importing from `__mocks__/` in production code. Mitigation deferred to Plan 16-02 which will add an `import-x/no-restricted-paths` rule blocking `__mocks__/` imports from outside `*.test.ts` files — out of scope for this plan to keep Wave-0 surface minimal. |
| T-16-00-06 | Repudiation | DNS records for leanshot.app | accept | DNS-record-tampering risk is inherent to the registrar account; mitigation lives at the registrar (2FA on Vercel account + registrar). No code-level mitigation possible in this plan. Treat as transferred to the Vercel + registrar security posture. |
| T-16-00-07 | Denial of service | sentry-test-crash.mjs poll loop | accept | Script polls Sentry every 5s for ≤60s. Worst-case: 12 API calls per CI run. Sentry rate limits at 200 req/min on free plan; well within budget. If the script becomes the dominant CI cost, add a fail-fast on HTTP 429. Accept for Wave 0; revisit if Plan 16-04 telemetry shows >10 invocations/day. |
</threat_model>

<verification>
End-to-end harness verification (run after Task 8 completes):

1. `cd leanshot && npm run test:mobile-unit` → exits 0 with "No test files found" (config loads; Wave 1 adds tests).
2. `cd leanshot && npm run test:mobile-e2e -- --list` → exits 0 with "Total: 0 tests" (project loads; Wave 2/4 adds specs).
3. `cd leanshot && npm run audit:privacy-manifest` → exits 0 with `audit-privacy-manifest: SKIPPED` (xcprivacy not yet created; Plan 16-07 fills).
4. `cd leanshot && SENTRY_DSN= SENTRY_AUTH_TOKEN= node scripts/sentry-test-crash.mjs` → exits 0 with skip message.
5. `cd leanshot && node scripts/seed-photo-soak-fixture.mjs` (no env) → exits 1 with `::error::seed-photo-soak-fixture requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY` (env-guard works).
6. `gh secret list 2>&1 | grep -cE "APPLE_TEAM_ID|FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD|PLAY_JSON_KEY|RC_API_KEY_IOS|RC_API_KEY_ANDROID|RC_SECRET_API_KEY|REVENUECAT_WEBHOOK_SECRET"` returns ≥ 7.
7. `npx supabase secrets list 2>&1 | grep -c REVENUECAT_WEBHOOK_SECRET` returns 1.
8. `curl -sS -o /dev/null -w '%{http_code}' https://leanshot.app/` returns `200`.
9. `gh repo view pallefar/leanshot-fastlane-match --json visibility,isEmpty` returns `{"visibility": "PRIVATE", "isEmpty": true}`.
10. `npx supabase projects list --output json | jq -r '.[] | select(.id=="ytnsipxxmzgaebkqmokp") | .subscription_tier'` returns `"pro"`.
11. `git status --porcelain leanshot/` returns empty for all files listed in `files_modified`.
</verification>

<success_criteria>
- 5 vendor accounts (Apple Developer, Google Play, RevenueCat, Supabase Pro, GitHub match-repo) ACTIVE with credentials retrievable via `gh secret list` and (where server-side) `supabase secrets list`.
- `leanshot.app` DNS live; `.well-known/` path-prefix returns 200/404 cleanly (not intercepted).
- `leanshot/vitest-mobile.config.ts` loads via `npx vitest run --config vitest-mobile.config.ts` (jsdom env, Capacitor alias mocks resolve).
- `leanshot/src/lib/native/__mocks__/` contains 5 mock files exporting vi-mockable symbols for `@capacitor/core`, `@capacitor/app`, `@capacitor/share`, `@revenuecat/purchases-capacitor`, `@capgo/capacitor-native-biometric`.
- `mobile` Playwright project listed by `playwright test --project=mobile --list` (matches `e2e/mobile/**/*.spec.ts`).
- `npm run test:mobile-unit`, `npm run test:mobile-e2e`, `npm run audit:privacy-manifest` all listed in package.json scripts.
- 3 harness scripts (`scripts/audit-privacy-manifest.mjs`, `scripts/sentry-test-crash.mjs`, `scripts/seed-photo-soak-fixture.mjs`) author exit codes 0/1 per CI-gate convention and SKIP cleanly when their downstream prerequisites are absent (per Wave-0-precedes-Wave-3 ordering).
- `leanshot/.planning/PROJECT.md` has a `## Vendor Accounts (Phase 16 Wave 0)` section with 6 rows (5 vendors + DNS).
- Single commit `feat(16-00): wave-0 harness + vendor checkpoints` on the working branch; working tree clean for all `files_modified` paths.
</success_criteria>

<output>
After completion, create `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-00-vendor-checkpoints-wave-0-harness-SUMMARY.md` capturing:
- Vendor accounts provisioned (5 rows + DNS row)
- Secrets stored in GitHub Actions Secrets (names only, NEVER values)
- Secrets stored in Supabase Function Secrets (names only)
- Harness artifacts created (config, mocks, scripts) with file paths
- Deferred items: none — all Wave-0 deliverables complete
- Handoff signals for downstream plans:
  - 16-01 may now run `npm i @capacitor/*` and `npx cap init` (vendor accounts ready)
  - 16-03 may now publish AASA + assetlinks to `leanshot.app` (DNS verified)
  - 16-06 may now deploy `revenuecat-webhook` with `REVENUECAT_WEBHOOK_SECRET` already in Supabase Function Secrets
  - 16-07 will fill `apps/ios/App/App/PrivacyInfo.xcprivacy` and the audit script will switch from SKIPPED → PASS
  - 16-09 will wire all 3 scripts into `.github/workflows/mobile.yml`
  - 16-10 will use `scripts/seed-photo-soak-fixture.mjs` to seed the 200-photo OOM soak
</output>
