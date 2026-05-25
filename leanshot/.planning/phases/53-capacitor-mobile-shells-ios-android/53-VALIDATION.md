# Phase 53: Capacitor Mobile Shells — Validation

**Generated:** 2026-05-25 (inline by autonomous orchestrator from each plan's `<verify><automated>` blocks)
**Scope:** All checks automatable WITHOUT a native/Xcode/Gradle build, cocoapods, or a device. Signed artifacts, TestFlight/Play upload, on-device cold-launch + deep-link resolution, store submission, and real TEAMID/SHA256/RC-key substitution defer to the Phase 70 HUMAN-UAT gate (D-08).

All commands from git root `/Users/karstenhaldan/minisite` unless they `cd leanshot`. `deno` = `$HOME/.deno/bin/deno`.

## 53-01 — fastlane toolchain + store metadata + privacy labels (MOBILE-02,03,07,09,10)
| Check | Pass signal |
|-------|-------------|
| `ruby -c` Fastfile/Appfile/Matchfile; Gemfile has fastlane; build_ios/android_unsigned + upload_testflight/play lanes present; NO pod/cocoapods | exit 0, all greps match |
| Store metadata files non-empty (ios + android descriptions); privacy_url; privacy-nutrition-labels.md mentions Data Safety + PrivacyInfo; README mentions Phase 70 | exit 0 |

## 53-02 — RC env stubs + deep-link validity + mobile account-deletion reachability (MOBILE-01,04,05,08)
| Check | Pass signal |
|-------|-------------|
| `.env.example` has VITE_RC_API_KEY_IOS/ANDROID + VITE_SENTRY_DSN_WEB; NO VITE_ webhook secret; deeplink runbook has TEAMID + Phase 70 | exit 0 |
| `vitest run --config vitest-mobile.config.ts deeplink-association.test.ts` | tests pass |
| `vitest run --config vitest-mobile.config.ts settings-delete-reachability.test.tsx` (375px ≥44px tap target) | tests pass |

## 53-03 — iOS + Android CI workflows + AndroidManifest App Links (MOBILE-01,02,03,05,09)
| Check | Pass signal |
|-------|-------------|
| mobile-ios.yml valid YAML; cap sync ios; legacy-peer-deps; CODE_SIGNING_ALLOWED=NO (unsigned-green); upload_testflight; macos-latest; NO pod install | exit 0 |
| mobile-android.yml valid YAML; cap sync android; legacy-peer-deps; bundleRelease; upload_play; ubuntu-latest; setup-java | exit 0 |
| AndroidManifest.xml valid XML; autoVerify=true; host app.leanshot.app; BROWSABLE + LAUNCHER intent categories | exit 0 |

## 53-04 — RevenueCat webhook mirror verification + secret ownership (MOBILE-06)
| Check | Pass signal |
|-------|-------------|
| `deno test revenuecat-webhook/index.test.ts` (pre-existing Phase 16 Fn); onConflict user_id,provider; provider 'revenuecat'; REVENUECAT_WEBHOOK_SECRET; from('subscriptions') | N passed / 0 failed |
| Exactly ONE `public.subscriptions` table; NO parallel RC table; provider CHECK includes stripe+revenuecat; user_provider unique index | exit 0 |
| SECRETS-RUNBOOK.md declares REVENUECAT_WEBHOOK_SECRET + AUTH as server-only, Phase-70-gated, mirrors public.subscriptions; no VITE_ webhook secret | exit 0 |

## Requirement coverage
MOBILE-01..10 all mapped (01 cap config+sync, 02/03 fastlane+CI signing, 04 plugins pre-installed, 05 deep links, 06 RC webhook mirror [pre-existing+verified], 07 metadata, 08 account-deletion reachability, 09 upload lanes gated, 10 privacy labels).

## Deferred to Phase 70
Signed IPA/AAB, TestFlight + Play upload, physical-device cold-launch + login + dose-log persistence, on-device deep-link resolution, store submission + real screenshots, real TEAMID/SHA256/RC-key/match-repo substitution.
