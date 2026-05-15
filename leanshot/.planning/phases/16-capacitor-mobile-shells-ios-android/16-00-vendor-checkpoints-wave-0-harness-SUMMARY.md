---
phase: 16-capacitor-mobile-shells-ios-android
plan: "00"
subsystem: mobile-test-harness
tags: [capacitor, vitest, playwright, privacy-manifest, sentry, photo-soak, vendor-checkpoints]
dependency_graph:
  requires: []
  provides:
    - vitest-mobile config (jsdom env + Capacitor alias mocks)
    - 5 vi-mockable __mocks__ files for @capacitor/core, @capacitor/app, @capacitor/share, @revenuecat/purchases-capacitor, @capgo/capacitor-native-biometric
    - mobile Playwright project (e2e/mobile/**/*.spec.ts)
    - 3 npm scripts (test:mobile-unit, test:mobile-e2e, audit:privacy-manifest)
    - audit-privacy-manifest.mjs (CI gate, SKIPs pre-Wave-3)
    - sentry-test-crash.mjs (CI probe, SKIPs without env)
    - seed-photo-soak-fixture.mjs (200-photo OOM soak seeder)
    - PROJECT.md Vendor Accounts (Phase 16 Wave 0) table
  affects:
    - all Wave 1 unit tests (depend on __mocks__/)
    - Plan 16-09 CI workflow (wires all 3 scripts into mobile.yml)
    - Plan 16-10 200-photo OOM soak (uses seed-photo-soak-fixture.mjs)
    - Plan 16-04 Sentry (will populate SENTRY_DSN + SENTRY_AUTH_TOKEN)
    - Plan 16-07 Privacy Manifest (will make audit-privacy-manifest.mjs transition SKIPPED → PASS)
tech_stack:
  added:
    - vitest jsdom environment for native bridge unit tests
    - Playwright mobile project (430x932 viewport)
  patterns:
    - vi.fn() manual mocks with __mock.reset() helpers per mock file
    - Node ESM CLI scripts with ::error:: GitHub Actions annotations
    - graceful SKIP pattern for pre-requisite-gated scripts
key_files:
  created:
    - leanshot/vitest-mobile.config.ts
    - leanshot/src/lib/native/__mocks__/capacitor-core.ts
    - leanshot/src/lib/native/__mocks__/capacitor-app.ts
    - leanshot/src/lib/native/__mocks__/capacitor-share.ts
    - leanshot/src/lib/native/__mocks__/revenuecat-purchases-capacitor.ts
    - leanshot/src/lib/native/__mocks__/capgo-native-biometric.ts
    - leanshot/scripts/audit-privacy-manifest.mjs
    - leanshot/scripts/sentry-test-crash.mjs
    - leanshot/scripts/seed-photo-soak-fixture.mjs
  modified:
    - leanshot/playwright.config.ts (mobile project added)
    - leanshot/package.json (3 new scripts)
    - leanshot/.planning/PROJECT.md (Vendor Accounts Phase 16 Wave 0 table)
decisions:
  - "Mock files export real vi.fn() spies (not type stubs) so Wave 1 tests can override per-call via .mockReturnValue / .mockImplementation without re-importing"
  - "audit-privacy-manifest.mjs exits 0 (SKIPPED) when xcprivacy is absent — allows CI wiring before Plan 16-07 ships"
  - "sentry-test-crash.mjs exits 0 (SKIPPED) when SENTRY_DSN/AUTH_TOKEN absent — graceful Wave-0 CI behavior"
  - "seed-photo-soak-fixture.mjs exits 1 on missing env (not SKIPPED) — seeder requires live DB, not pre-requisite-gateable"
  - "Playwright mobile project uses Desktop Chrome device at 430x932 viewport (iPhone 14 Pro Max approx) for ASO viewport capture + IAP/soak mock runs"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-15"
  tasks_completed: 3
  tasks_skipped_human_action: 5
  files_created: 9
  files_modified: 3
---

# Phase 16 Plan 00: Vendor Checkpoints + Wave-0 Harness Summary

Wave-0 test harness built and committed. Vitest mobile config + 5 Capacitor mocks + mobile Playwright project + 3 npm scripts + 3 CI harness scripts authored. Vendor checkpoints (Tasks 3-7) surfaced for user action.

## Auto Tasks Completed

### Task 1: vitest-mobile config + Capacitor mocks + Playwright mobile project + npm scripts

**Commit:** `eedced3`

All 8 files created/modified:

- `leanshot/vitest-mobile.config.ts` — jsdom environment, Capacitor alias mocks resolving to `src/lib/native/__mocks__/`, `test.include: ['src/lib/native/**/*.test.ts', '*.test.tsx']`
- `leanshot/src/lib/native/__mocks__/capacitor-core.ts` — `export const Capacitor` with `getPlatform` + `isNativePlatform` vi.fn() stubs
- `leanshot/src/lib/native/__mocks__/capacitor-app.ts` — `export const App` with `addListener` vi.fn() + `URLOpenListenerEvent` type
- `leanshot/src/lib/native/__mocks__/capacitor-share.ts` — `export const Share` with `share` vi.fn()
- `leanshot/src/lib/native/__mocks__/revenuecat-purchases-capacitor.ts` — `export const Purchases` (configure/getOfferings/purchasePackage/checkTrialOrIntroductoryPriceEligibility) + `INTRO_ELIGIBILITY_STATUS` enum
- `leanshot/src/lib/native/__mocks__/capgo-native-biometric.ts` — `export const NativeBiometric` with `isAvailable` + `verifyIdentity` vi.fn()
- `leanshot/playwright.config.ts` — mobile project added: `{ name: 'mobile', testMatch: /e2e\/mobile\/.*\.spec\.ts$/, viewport: { width: 430, height: 932 } }`
- `leanshot/package.json` — scripts added: `test:mobile-unit`, `test:mobile-e2e`, `audit:privacy-manifest`

**Verification:**
- `npx vitest run --config vitest-mobile.config.ts` → "No test files found" (config loads; Wave 1 adds tests)
- `npx playwright test --project=mobile --list` → "Total: 0 tests" (project loads; Wave 2/4 adds specs)
- All 5 `__mocks__/*.ts` exports confirmed via grep

### Task 2: Harness scripts (audit-privacy-manifest + sentry-test-crash + seed-photo-soak-fixture)

**Commit:** `eedced3` (same commit as Task 1 — all batched into Task 8 single commit per plan)

Three Node ESM CLI scripts created:

**`scripts/audit-privacy-manifest.mjs`** (63 lines):
- Reads `apps/ios/App/App/PrivacyInfo.xcprivacy` via `path.resolve(import.meta.dirname, '../apps/ios/...')`
- Hard-codes `REQUIRED_APIS` (5 Apple canonical required-reason categories) + `PLUGIN_INVENTORY` (14 plugins per D-07)
- Exits 0 with `SKIPPED` when xcprivacy absent (pre-Wave-3); exits 1 with `::error::` per missing API when file exists
- `npm run audit:privacy-manifest` → "audit-privacy-manifest: SKIPPED" (confirmed)

**`scripts/sentry-test-crash.mjs`** (108 lines):
- Reads `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` from env
- Exits 0 with `SKIPPED` when any env var absent (graceful CI behavior for Wave 0)
- Posts envelope to `/api/<projectId>/store/` with unique `crypto.randomUUID()` fingerprint
- Polls `https://sentry.io/api/0/projects/<org>/<project>/events/` every 5s up to 60s
- `SENTRY_DSN= SENTRY_AUTH_TOKEN= node scripts/sentry-test-crash.mjs` → "SKIPPED" (confirmed)

**`scripts/seed-photo-soak-fixture.mjs`** (162 lines):
- Reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; exits 1 if absent (not skip-able — seeder requires live DB)
- Creates admin client with `{ auth: { autoRefreshToken: false, persistSession: false } }`
- Accepts `--count <N>` (default 200) + `--cleanup <userId>` flags
- Uploads N 1x1 PNG blobs to Storage `photos` bucket + inserts rows introspecting table schema
- Prints `{ userId, fixturePrefix, count }` JSON + cleanup command to stderr
- `node scripts/seed-photo-soak-fixture.mjs` (no env) → exits 1 with `::error::...requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY` (confirmed)

### Task 8: PROJECT.md Vendor Accounts table

Appended `## Vendor Accounts (Phase 16 Wave 0)` section to `leanshot/.planning/PROJECT.md` with 6-row table (Apple Developer, Google Play Console, RevenueCat, Supabase Pro, GitHub fastlane-match, DNS leanshot.app). All rows marked PENDING until human checkpoints complete.

## Vendor Checkpoints Pending (Tasks 3-7)

The following 5 human-action checkpoints must be completed by the user before Wave 1 can fully proceed:

| Task | Service | Status | Resume Signal |
|------|---------|--------|---------------|
| Task 3 | Apple Developer Program + bundle `app.leanshot.ios` | PENDING | `apple-done <TEAM_ID> <ASP>` |
| Task 4 | Google Play Console + `app.leanshot.android` + SA JSON | PENDING | `play-done <path-to-json>` |
| Task 5 | RevenueCat project + `plus` entitlement + 2 products | PENDING | `revenuecat-done` + 4 keys inline |
| Task 6 | Supabase Pro tier upgrade (`ytnsipxxmzgaebkqmokp`) | PENDING | `supabase-pro-done` |
| Task 7 | GitHub `pallefar/leanshot-fastlane-match` + DNS `leanshot.app` | PENDING | `match-and-dns-done` |

CLI pre-checks at checkpoint time:
- GitHub repo: `gh repo view pallefar/leanshot-fastlane-match --json visibility,isEmpty` → MISSING (not yet created)
- DNS: `curl -sSI https://leanshot.app/ -o /dev/null -w '%{http_code}'` → DNS resolution failure (not yet configured)
- Supabase tier: `npx supabase projects list --output json | jq '.[] | select(.id=="ytnsipxxmzgaebkqmokp") | .subscription_tier'` → `"N/A"` (CLI doesn't expose tier; dashboard confirmation needed)

## Deviations from Plan

None — plan executed exactly as written for the 3 auto tasks. Tasks 3-7 are vendor human-action checkpoints surfaced in the CHECKPOINT REACHED message.

## Handoff Signals for Downstream Plans

| Plan | Signal |
|------|--------|
| **16-01** | May now run `npm i @capacitor/*` and `npx cap init` — Wave-0 harness complete |
| **16-03** | DNS `leanshot.app` needed (Task 7 checkpoint) before publishing AASA + assetlinks |
| **16-04** | Sentry mock NOT created in this plan (scope boundary); Plan 16-04 owns Sentry mock surfaces |
| **16-06** | May deploy `revenuecat-webhook` with `REVENUECAT_WEBHOOK_SECRET` once Task 5 completes |
| **16-07** | Will fill `apps/ios/App/App/PrivacyInfo.xcprivacy` — audit script will switch from SKIPPED → PASS |
| **16-09** | Will wire all 3 scripts into `.github/workflows/mobile.yml` |
| **16-10** | Will use `seed-photo-soak-fixture.mjs` with `--count 200` for WKWebView OOM soak |

## Threat Flags

No new security-relevant surface introduced beyond what the plan's threat model covers. The 5 mock files do NOT contain real credentials (vi.fn() stubs only, T-16-00-05). Scripts read from env, never log secret values.

## Self-Check: PASSED

- `leanshot/vitest-mobile.config.ts` — FOUND
- `leanshot/src/lib/native/__mocks__/capacitor-core.ts` — FOUND
- `leanshot/src/lib/native/__mocks__/capacitor-app.ts` — FOUND
- `leanshot/src/lib/native/__mocks__/capacitor-share.ts` — FOUND
- `leanshot/src/lib/native/__mocks__/revenuecat-purchases-capacitor.ts` — FOUND
- `leanshot/src/lib/native/__mocks__/capgo-native-biometric.ts` — FOUND
- `leanshot/scripts/audit-privacy-manifest.mjs` — FOUND
- `leanshot/scripts/sentry-test-crash.mjs` — FOUND
- `leanshot/scripts/seed-photo-soak-fixture.mjs` — FOUND
- `leanshot/playwright.config.ts` (mobile project) — FOUND
- `leanshot/package.json` (3 new scripts) — FOUND
- `leanshot/.planning/PROJECT.md` (Vendor Accounts section) — FOUND
- Commit `eedced3` — FOUND (confirmed via git log)
