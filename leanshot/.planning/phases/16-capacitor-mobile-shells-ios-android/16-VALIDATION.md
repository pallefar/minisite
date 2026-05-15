---
phase: 16
slug: capacitor-mobile-shells-ios-android
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `16-RESEARCH.md` → "Validation Architecture" section (canonical).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 (unit) + Playwright 1.59 (e2e) — already installed |
| **Config files** | `vitest.config.ts` + `playwright.config.ts` (existing); Wave 0 adds `vitest-mobile.config.ts` for jsdom-mocked Capacitor tests + new `mobile` Playwright project |
| **Quick run command** | `npm run test:unit` |
| **Full suite command** | `npm run test` (vitest + playwright) |
| **Estimated runtime** | ~10s quick / ~3min full (excluding 30-min OOM soak and manual UAT) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit` (~10s)
- **After every plan wave:** Run `npm run lint && npm run test:unit && npm run test:e2e` (~3 min)
- **Before `/gsd:verify-work`:** Full suite green + 7-day TestFlight soak + 3-day Play Internal soak (per D-15)
- **Max feedback latency:** 10s for unit, 3min for wave

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists |
|-----|----------|-----------|-------------------|-------------|
| MOBILE-01 | iOS app installs from TestFlight → home in ≤10s | manual-only (UAT) | TestFlight install (Wave 3) | ❌ W3 |
| MOBILE-02 | Android app installs from Play Internal → home in ≤10s | manual-only (UAT) | Play Internal install (Wave 3) | ❌ W3 |
| MOBILE-03 | Feature code cannot import `@capacitor/*` directly | unit (ESLint) | `npm run lint -- src/components` | ✅ Phase 12 firewall + add negative-test fixtures |
| MOBILE-04 | ASO assets present 6 viewports × N locales | integration | `playwright test e2e/aso/aso-capture.spec.ts` | ❌ W0 (Wave 3 fills) |
| MOBILE-05 | PrivacyInfo + Data Safety form complete | integration | `node scripts/audit-privacy-manifest.mjs` | ❌ W0 |
| MOBILE-06 | Deep link `leanshot.app/share/X` routes in-app | unit (mocked) | `vitest run src/lib/native/deeplink.test.ts` | ❌ W1 |
| MOBILE-06 | AASA + assetlinks served correct Content-Type | smoke | `curl -i https://leanshot.app/.well-known/apple-app-site-association` (CI script) | ❌ W0 (Wave 1 fills) |
| MOBILE-07 | Biometric unlock with password fallback | unit (mocked) | `vitest run src/lib/native/biometric.test.ts` | ❌ W1 |
| MOBILE-08 | 200-photo gallery soak ≤ mem cap, 0 crashes | e2e + native | `playwright test e2e/mobile/photo-soak.spec.ts` (30 min) | ❌ W0 harness (W2 wires) |
| MOBILE-08 | Cold-start iPhone 12 ≤10s | manual + telemetry | Sentry `app.start` p95 over 7-day TestFlight | ❌ W3 |
| MOBILE-09 | Sentry receives test crash | smoke | `node scripts/sentry-test-crash.mjs` | ❌ W0 (W3 trigger) |
| MOBILE-10 | Share sheet opens with content | unit (mocked) | `vitest run src/lib/native/share.test.ts` | ❌ W1 |
| MONEY-06 | Purchase → entitlement → webhook → subscriptions row | integration | `playwright test e2e/mobile/iap-flow.spec.ts` (RC sandbox + live Supabase) | ❌ W2 |
| MONEY-06 | `MAX(stripe.expires_at, rc.expires_at)` rule | unit (DB) | `vitest run e2e/rls-tier-effective.test.ts` (service-role JWT) | ❌ W2 |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest-mobile.config.ts` — Capacitor plugin mocks via `vi.mock('@capacitor/core')`
- [ ] `e2e/mobile/` Playwright project (or new `mobile` project added to existing `playwright.config.ts`)
- [ ] `src/lib/native/__mocks__/` — manual Capacitor mocks for `App`, `Purchases`, `NativeBiometric`, `Share`
- [ ] `scripts/audit-privacy-manifest.mjs` — diffs declared `PrivacyInfo.xcprivacy` against Xcode build-log "found required-reason APIs"
- [ ] `scripts/sentry-test-crash.mjs` — triggers a known crash, polls Sentry API for receipt
- [ ] `e2e/mobile/photo-soak.spec.ts` + 200-photo Supabase Storage seed fixture
- [ ] CI workflow `.github/workflows/mobile.yml` — lint + unit + e2e:mobile + `fastlane match validate` on PRs touching `apps/`, `src/lib/native/`, `capacitor.config.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| TestFlight install + 7-day soak | MOBILE-01, MOBILE-08, MOBILE-09 | Apple sandbox + real device crash telemetry | Submit Wave 3 build to TestFlight; verify install on iPhone 12; Sentry shows zero fatal events over 7 days |
| Play Internal install + 3-day soak | MOBILE-02, MOBILE-08 | Google Play track gating + real device | Submit Wave 3 AAB to Play Internal track; install on Android 14 device; soak 3 days |
| Apple Sandbox purchase | MONEY-06 happy path | Apple ID Sandbox tester must be configured in iOS Settings; no fully-automated route per A4 | Manually log into Sandbox Apple ID, run Wave 2 IAP flow, observe entitlement + DB row |
| Cold-start p95 telemetry | MOBILE-08 cold-start ≤10s | Requires real-device sample | Sentry transaction `app.start` p95 over 7-day TestFlight window |
| AASA / assetlinks reachability | MOBILE-06 | Requires `leanshot.app` DNS to point to Vercel prod with Phase 15 deployed | Wave 0 vendor checkpoint + Wave 1 CI curl-check |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s (unit) / < 180s (wave)
- [ ] `nyquist_compliant: true` set in frontmatter
- [ ] 7-day TestFlight + 3-day Play Internal soak gates explicit in PLAN.md

**Approval:** pending
