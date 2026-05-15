# Phase 16: Capacitor Mobile Shells (iOS + Android) — Research

**Researched:** 2026-05-15
**Domain:** Cross-platform native mobile shells (iOS + Android) wrapping a Vite+React+TS SPA via Capacitor 8, with App Store / Play Store submission, IAP via RevenueCat, Universal Links, biometric unlock, WKWebView OOM mitigation, native crash reporting, and OTA-update governance under Apple §3.1.1 / §4.7 / §3.3.2.
**Confidence:** HIGH on Capacitor 8 setup, RevenueCat plugin API, Apple guideline text (verbatim from Apple), Privacy Manifest schema, deep-link mechanics; MEDIUM on Capacitor-Sentry React dual-init exact signature, Capgo channel/rollout config detail; LOW on D-04 normalization recommendation (cross-platform UX call, not a technical fact).

## Summary

Phase 16 is **almost a pure assembly job once five vendor accounts are live**. 25 CONTEXT decisions have already pre-locked: plugin set (14 plugins), bundle IDs (`app.leanshot.ios` + `app.leanshot.android`), product IDs (`app.leanshot.plus.monthly` + `.yearly`), entitlement (`plus`), reconciliation pattern (mirror `stripe-webhook` with `provider='revenuecat'`), tier-effective rule (`MAX(stripe.expires_at, revenuecat.expires_at) > now()`), build pipeline (fastlane + match + GitHub Actions macOS runner), Sentry max-coverage, AASA hosting (both `leanshot.app` AND `app.leanshot.app`), OOM stack (react-virtuoso + Supabase Storage transforms), and 4-locale store listings. The plan-phase's main job is **slicing this into shippable plans** — not deciding architecture.

The dominant risk is **Apple App Review**, not engineering. Three guidelines compound: §3.1.1 (IAP-only for digital subs), §3.1.1(a) (anti-steering — even in-app text directing to web for purchase is rejection-bait outside US storefront), §4.7 (HTML/JS mini-app rules govern Page Builder runtime + Capgo Live Updates), §3.3.2 (OTA must not change "primary purpose" or native binaries). D-13 mitigation must be **engineered, not just documented** — the iOS app must dynamically swap `/pricing` to a RevenueCat IAP UI, scope Capgo Live Updates path-allowlist to exclude `/pricing | /auth | /clinic/billing`, and ship a pre-written submission-response template.

The **second risk is WKWebView OOM**, empirically confirmed at 50+ raw photos on iPhone 12 (4GB). Mitigation requires Supabase Pro tier (Storage transforms are Pro-only) + react-virtuoso virtualization + an explicit decode-budget strategy. Validation must be a deterministic 200-photo soak with `Sentry.captureMessage('photo-gallery-soak-complete')` markers and a memory-pressure assertion (not just "did it crash?").

**One CONTEXT correction (LOW-impact):** D-05 says "iOS 14+" — **Capacitor 8 requires iOS 15.0 deployment target** (verified at capacitorjs.com/docs/updating/8-0). Same source: Node.js 22+ required, Android minSdk 24, targetSdk 36, Xcode 26.0+. CONTEXT D-05's "iOS 14+" assertion needs a one-line correction before plan-phase locks deployment targets in xcconfig.

**Primary recommendation:** 10 plans across 4 waves. Wave 0 (vendor accounts, blocker), Wave 1 (Capacitor scaffold + 5 stub fills, parallel), Wave 2 (RevenueCat + paywall fork + reconciliation, sequential dep on Wave 1), Wave 3 (App Store + Play submission artifacts: Privacy Manifest + ASO + soak + Sentry). 4-locale localization splits naturally as a 11th plan or a stretch deferred to v1.3 first-submission — flag for plan-phase debate.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| App shell rendering | Browser/Client (WKWebView/WebView) | — | Capacitor wraps the existing SPA; no SSR introduced. |
| Platform detection (`detectPlatform()`) | Browser/Client | — | Reads `Capacitor.getPlatform()`; pure in-process. |
| IAP purchase flow | Browser/Client (JS layer) | Native plugin (StoreKit/Play Billing via RC) | RC plugin proxies to native; JS owns UX. |
| Entitlement source of truth | API/Backend (Supabase) | — | `subscriptions` table; client only reads `tier`. |
| RevenueCat webhook ingest | API/Backend (Edge Function) | — | New `revenuecat-webhook` Edge Function writes to `subscriptions` (mirrors `stripe-webhook`). |
| Tier effective computation | Database/Storage (Postgres rule) | — | `tier_effective = MAX(...)` SQL expression in `subscriptions` view or RPC. |
| Universal Links / App Links resolution | CDN/Static (Vercel) | Browser/Client | `.well-known/{aasa,assetlinks.json}` served by Vercel; Capacitor App plugin routes the deep link in-app. |
| Photo gallery OOM mitigation | Browser/Client (react-virtuoso) | CDN/Static (Supabase Storage transform render endpoint) | Virtualization in JS; thumbnail generation at the edge. |
| Biometric prompt | Browser/Client (JS) | Native plugin | Capgo plugin bridges to LocalAuthentication / Android Biometric. |
| Crash capture | Browser/Client (JS) + Native (Cocoa/Android SDK) | API/Backend (Sentry ingest) | Dual SDK — JS errors + native crashes both flow to Sentry SaaS. |
| OTA Live Updates | CDN/Static (Capgo CDN) | Browser/Client (updater plugin) | Capgo serves bundle; plugin downloads + atomic-swaps webDir. |
| ASO assets (screenshots, listing copy) | CDN/Static (App Store Connect + Play Console) | — | Hosted by stores; not in repo. |
| Native share sheet | Browser/Client (JS) | Native plugin | `@capacitor/share` bridges to UIActivityViewController / Intent.ACTION_SEND. |

[VERIFIED: `src/lib/native/*` Phase 12 stubs + `eslint.config.js` firewall + `capacitorjs.com/docs/getting-started`]

## User Constraints (from CONTEXT.md)

### Locked Decisions (verbatim summary; full text in `16-CONTEXT.md`)

**RevenueCat tier model:**
- **D-01:** 1 entitlement `plus`; 2 products `app.leanshot.plus.monthly` + `.yearly` (PERMANENT names).
- **D-02:** Reconciliation = mirror `stripe-webhook` → new `revenuecat-webhook` Edge Function writes `subscriptions` with `provider='revenuecat'`. Effective tier = `MAX(stripe.expires_at, revenuecat.expires_at) > now()`.
- **D-03:** Reverse-DNS product IDs (PERMANENT).
- **D-04:** Immediate downgrade on RC CANCELLATION/EXPIRATION (deliberate asymmetry with Stripe grace-period).

**Capacitor + biometric:**
- **D-05:** Capacitor 8.x pinned. iOS 14+ minimum [⚠️ CONTEXT says 14 but Capacitor 8 mandates iOS 15.0 — see Standard Stack note].
- **D-06:** Biometric = `@capgo/capacitor-native-biometric`.
- **D-07:** 14 plugins (see Standard Stack table).
- **D-08:** OOM stack = react-virtuoso + Supabase Storage transforms (REQUIRES Pro tier upgrade BEFORE iOS submission).

**Universal Links + bundle IDs:**
- **D-09:** AASA + assetlinks on BOTH `leanshot.app` AND `app.leanshot.app`.
- **D-10:** Bundle IDs split per-platform: `app.leanshot.ios` + `app.leanshot.android` (PERMANENT).
- **D-11:** All 4 deep-link categories open in-app: auth / share / clinic / marketing.
- **D-12:** Hybrid bundled fallback + Capgo Live Updates; monetization paths ALWAYS bundled.
- **D-13:** Mitigation engineered for §3.1.1 / §4.7 risk — platform-aware `/pricing`, Capgo path allowlist excludes auth+pricing+IAP, submission-response template ready.

**Build pipeline:**
- **D-14:** fastlane + GitHub Actions macOS runner. fastlane match for signing.
- **D-15:** 7-day TestFlight + 3-day Play Internal soak before public.
- **D-16:** `fastlane match` private repo `leanshot-fastlane-match` + 1Password Vault backup.
- **D-17:** Sentry Capacitor + native Sentry Cocoa + Sentry Android.

**Privacy + ASO:**
- **D-18:** Hand-crafted `PrivacyInfo.xcprivacy` from 14-plugin inventory.
- **D-19:** Playwright screenshots + designer overlay; 6 viewports.
- **D-20:** EN + ES + DE + FR (+25-30h scope; flag for plan-phase).
- **D-21:** App Store preview = hand-recorded QuickTime + iMovie 30s + caption overlay (no per-locale audio).

**Cross-platform sync:**
- **D-22:** Block 2nd trial via RC offer-eligibility API.
- **D-23:** Honest unified `MAX(...)` tier display.
- **D-24:** Clinic-owner IAP hidden on iOS.
- **D-25:** Realtime via Supabase Realtime channel `subscriptions:user_id=eq.X`.

### Claude's Discretion
- WatchKit handoff hooks — defer to Phase 21.
- Per-locale translation vendor — DeepL / ChatGPT-assisted / hired translator (researcher recommendation: see "Common Pitfalls — Locale Lifecycle").
- `Virtuoso` vs `VirtuosoGrid` — researcher recommendation: **`VirtuosoGrid` for the photo tab** (grid is the existing Photo UI; row-virtualization is wrong shape).
- Capgo rollout strategy (%, version pinning, rollback triggers) — recommendation in "Architecture Patterns — Capgo Live Updates Governance".

### Deferred Ideas (OUT OF SCOPE for P16)
- Watch app handoff hooks → Phase 21
- HealthKit / Health Connect data flow → Phase 18 (leave `native/health.ts` as stub)
- AdMob init → Phase 20 (leave `native/ads.ts` as stub)
- Push wiring → Phase 17 (leave `native/push.ts` as stub)
- Offline export via `@capacitor/filesystem` → v1.3 (plugin installed; feature deferred)
- Capgo rollback playbook details
- HomeKit / Siri / shortcuts
- iOS Shortcuts one-tap dose log
- Resend domain verification (Phase 12 carry-over — likely surfaces during P16 UAT for IAP receipt confirmations)
- `@capacitor/camera` + on-device thumbnails (alternative if Pro-tier transforms insufficient; defer to v1.3)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MOBILE-01 | iOS Capacitor 8 app installs from App Store; native build via fastlane + TestFlight | Capacitor 8 setup, fastlane lanes, code-signing via `match` |
| MOBILE-02 | Android Capacitor 8 app installs from Play Store; signed AAB + internal testing | `npx cap add android`, fastlane gradle, Play Internal track |
| MOBILE-03 | Feature code imports only via `src/lib/native/*` (ESLint enforced) | Phase 12 firewall already in place; this phase only ADDS allowed plugin imports inside those 6+1 files |
| MOBILE-04 | App Store + Play Store listings with full ASO assets (icons, screenshots @ 6 viewports, 30s preview, EN copy) | D-19 Playwright + Pencil; D-20 4-locale; D-21 QuickTime preview |
| MOBILE-05 | `PrivacyInfo.xcprivacy` + Play Data Safety form complete | D-18 hand-crafted manifest; Data Safety mapping table below |
| MOBILE-06 | Universal Links + App Links route `leanshot.app/*` into the app | AASA + assetlinks.json schemas, Associated Domains capability, intent-filter XML |
| MOBILE-07 | Biometric unlock with password fallback | `@capgo/capacitor-native-biometric` API; NSFaceIDUsageDescription |
| MOBILE-08 | 200+ photos scrollable on iPhone 12 without OOM | react-virtuoso `VirtuosoGrid` + Supabase Storage transforms (Pro tier) + soak protocol |
| MOBILE-09 | All native crashes → Sentry | `@sentry/capacitor` + `@sentry/react` dual-init; native SDKs auto-installed; dSYM upload in fastlane |
| MOBILE-10 | Native share sheet for dose-log / share-card / doctor-report | `@capacitor/share` plugin API |
| MONEY-06 | iOS+Android IAP via RevenueCat (Apple §3.1.1 mandate) | `@revenuecat/purchases-capacitor` 13.1.1; offerings/purchase/restore APIs; webhook → Edge Function → `subscriptions` |

## Standard Stack

### Core (versions verified against npm registry 2026-05-15)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@capacitor/core` | 8.3.4 | Native runtime bridge | [VERIFIED: npm view; CITED: capacitorjs.com/docs/updating/8-0] Official; only viable cross-platform wrapper for an existing SPA. |
| `@capacitor/cli` | 8.3.4 | Build/sync/migrate CLI | [VERIFIED: npm] Required peer. |
| `@capacitor/ios` | 8.3.4 | iOS native project generator | [VERIFIED: npm] SPM by default in v8. |
| `@capacitor/android` | 8.3.4 | Android native project generator | [VERIFIED: npm] AndroidX. |
| `@capacitor/app` | 8.1.0 | App lifecycle + `appUrlOpen` listener (deep links) | [VERIFIED: npm; CITED: capacitorjs.com/docs/guides/deep-links] Required for D-11 deep-link routing. |
| `@capacitor/preferences` | 8.0.1 | Native key-value store (UserDefaults / SharedPreferences) | [VERIFIED: npm] Reason-code `CA92.1` PrivacyInfo entry. |
| `@capacitor/share` | 8.0.1 | Native share sheet | [VERIFIED: npm] MOBILE-10. |
| `@capacitor/splash-screen` | 8.0.1 | Splash | [VERIFIED: npm] |
| `@capacitor/status-bar` | 8.0.2 | Status bar styling | [VERIFIED: npm] |
| `@capacitor/haptics` | 8.0.2 | Haptic feedback | [VERIFIED: npm] |
| `@capacitor/browser` | 8.0.3 | In-app Safari View Controller / Chrome Custom Tabs (for Stripe Customer Portal on iOS — clinic-owner case D-24) | [VERIFIED: npm] |
| `@capacitor/keyboard` | 8.0.3 | Keyboard events + safe-area | [VERIFIED: npm] |
| `@capacitor/network` | 8.0.1 | Online/offline detection | [VERIFIED: npm] |
| `@capacitor/filesystem` | 8.1.2 | Offline export (deferred to v1.3, plugin installed per D-07) | [VERIFIED: npm] |
| `@capacitor/clipboard` | 8.0.1 | Native clipboard | [VERIFIED: npm] |
| `@revenuecat/purchases-capacitor` | 13.1.1 | IAP unification (App Store + Play) | [VERIFIED: npm; CITED: revenuecat.com/docs/getting-started/installation/capacitor] Apple §3.1.1 mandate. |
| `@capgo/capacitor-native-biometric` | 8.4.5 | FaceID / TouchID / Android Biometric | [VERIFIED: npm; CITED: capgo.app/docs/plugins/native-biometric/] D-06 consistency with `@capgo/capacitor-health` family. |
| `@sentry/capacitor` | 4.0.0 | Native crash + JS error reporting | [VERIFIED: npm; published 2026-05-01 — fresh] D-17 max coverage. |
| `@sentry/react` | 10.52.0 (already installed) | React error boundary integration | [VERIFIED: package.json line 29] Dual-init partner. |
| `react-virtuoso` | 4.18.7 | Virtualized list / grid | [VERIFIED: npm; CITED: virtuoso.dev] D-08 OOM mitigation. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@capgo/capacitor-updater` | 8.46.0 | Capgo Live Updates (OTA JS/CSS) | D-12 — install BUT only initialize when Capgo paid plan provisioned. Until then, ship bundled-only. |
| `fastlane` (Ruby gem) | latest (~2.227.x) | iOS/Android signing + build + upload | D-14. Install via `bundle install` with a `Gemfile`. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@capgo/capacitor-native-biometric` | `@aparajita/capacitor-biometric-auth` or the Capacitor team's own | [CITED: D-06] Capgo family chosen for org-consistency with Phase 18's `@capgo/capacitor-health`. No technical superiority — pick is org-coherence. |
| `react-virtuoso` | `react-window` or `@tanstack/react-virtual` | virtuoso has built-in variable-sized items + `endReached` + grid mode; less hand-rolling for the photo tab. [ASSUMED] re: relative perf on iOS WKWebView — not benchmarked here. |
| Capgo Live Updates | Apple TestFlight-only updates / Capacitor's official Live Updates (Ionic Appflow) | Appflow is enterprise-tier paid; Capgo is the open-source/affordable choice [CITED: capgo.app pricing $15-30/mo]. |
| `@sentry/capacitor` 4.0.0 | Bugsnag, Crashlytics | LeanShot already on Sentry since Phase 1; reuses DSN per D-17. |
| `fastlane match` | Manual cert export + 1Password sync | match is the industry standard; lost-key recovery is documented [CITED: D-16]. |
| Splitting bundle IDs (`app.leanshot.ios` vs `.android`) | Single bundle ID across both | [CITED: D-10] Splits required by separate Sentry projects + per-store analytics + per-platform Privacy Manifest. Tradeoff: 2 RC dashboard apps to configure; standard practice. |

**Installation (Wave 1):**
```bash
# Core + native projects
npm i @capacitor/core@^8 @capacitor/app@^8 @capacitor/preferences@^8 \
  @capacitor/share@^8 @capacitor/splash-screen@^8 @capacitor/status-bar@^8 \
  @capacitor/haptics@^8 @capacitor/browser@^8 @capacitor/keyboard@^8 \
  @capacitor/network@^8 @capacitor/filesystem@^8 @capacitor/clipboard@^8 \
  @revenuecat/purchases-capacitor@^13 @capgo/capacitor-native-biometric@^8 \
  @sentry/capacitor@^4 react-virtuoso@^4
npm i -D @capacitor/cli@^8 @capacitor/ios@^8 @capacitor/android@^8

# Capgo (install always; initialize conditionally per D-12)
npm i @capgo/capacitor-updater@^8

# Initialize
npx cap init "LeanShot" "app.leanshot" --web-dir=dist
# Then EDIT capacitor.config.ts to split appId per-platform (D-10)
npx cap add ios
npx cap add android
npx cap sync

# fastlane (Wave 3)
gem install fastlane bundler
# Inside apps/ios/ and apps/android/: fastlane init
```

> **Note on D-05 vs Capacitor 8 actual minimums:** CONTEXT D-05 says "iOS 14+". [VERIFIED: capacitorjs.com/docs/updating/8-0] Capacitor 8 **requires iOS 15.0** deployment target, **Node.js 22+**, **Android minSdk 24 / targetSdk 36**, **Xcode 26.0+**. Plan-phase should lock these as the true minimums. Impact on LeanShot: negligible (iPhone 12 in CONTEXT D-08 is iOS 15+ capable; no user is excluded by going 15.0 over 14.0).

## Architecture Patterns

### System Architecture Diagram

```
                       ┌─────────────────────────────────────────┐
                       │       App Store Connect / Play Console   │
                       │       (ASO, listings, privacy form)      │
                       └────────────────┬─────────────────────────┘
                                        │  build artifacts
                                        ▼
┌──────────────────┐    fastlane    ┌────────────────┐    OTA  bundles    ┌──────────────┐
│  GitHub Actions  │───────────────▶│  TestFlight /  │◀────── Capgo ──────│  Capgo CDN   │
│  macOS runner    │                │  Play Internal │  (JS/CSS only)     │  (paid plan) │
└──────────────────┘                └────────┬───────┘                    └──────────────┘
                                             │ public release
                                             ▼
                              ┌──────────────────────────────┐
                              │     User device (iOS/Android) │
                              │  ┌────────────────────────┐  │
                              │  │   Capacitor Container  │  │
                              │  │  ┌──────────────────┐  │  │
                Universal Link │  │  │  WebView (SPA)    │  │  │
   leanshot.app/share/XXX ────►│  │  │  React+Vite      │  │  │
                              │  │  │                  │  │  │
                              │  │  │  src/lib/native/ │  │  │
                              │  │  │  ├─ platform.ts ◀┼──┼──┼── Capacitor.getPlatform()
                              │  │  │  ├─ deeplink.ts ◀┼──┼──┼── @capacitor/app appUrlOpen
                              │  │  │  ├─ iap.ts      ─┼──┼──┼─▶ @revenuecat/purchases-capacitor
                              │  │  │  ├─ biometric ──┼──┼──┼─▶ @capgo/capacitor-native-biometric
                              │  │  │  └─ (push/ads/  │  │  │   (Phase 17/18/20 stubs still throw)
                              │  │  │      health)    │  │  │
                              │  │  └──────────────────┘  │  │
                              │  │  Sentry SDK (JS+native)│  │
                              │  └──────────────────────┬─┘  │
                              └──────────────────────────┼────┘
                                                         │
                              tier='paid' Realtime push  │  IAP webhooks
                                                         ▼
                              ┌───────────────────────────────────────┐
                              │  Supabase (Pro tier — D-08 mandate)   │
                              │  ┌──────────────────┐  ┌───────────┐  │
                              │  │ revenuecat-      │  │ stripe-   │  │
                              │  │   webhook        │  │  webhook  │  │
                              │  │  Edge Function   │  │  (P14)    │  │
                              │  └────────┬─────────┘  └─────┬─────┘  │
                              │           ▼                  ▼        │
                              │     subscriptions table (provider col)│
                              │     ↳ tier_effective = MAX(expires)  │
                              │  ┌──────────────────────────────────┐ │
                              │  │ Storage transforms (Pro):        │ │
                              │  │  /storage/v1/render/image/...    │ │
                              │  │  ?width=200&height=200           │ │
                              │  └──────────────────────────────────┘ │
                              │  Realtime channel subscriptions:     │
                              │   user_id=eq.X → tier flip in ~2-5s  │
                              └───────────────────────────────────────┘
                                                         ▲
                                                         │
                              ┌──────────────────────────┴────────────┐
                              │  Vercel (leanshot.app + app.leanshot. │
                              │  app) — D-09                          │
                              │  /.well-known/apple-app-site-         │
                              │           association                  │
                              │  /.well-known/assetlinks.json         │
                              │   (Content-Type: application/json,    │
                              │    no redirects, HTTPS)               │
                              └───────────────────────────────────────┘
```

### Recommended Project Structure

```
leanshot/
├── capacitor.config.ts                  # Root config — appId, webDir, ios+android sections
├── apps/
│   ├── ios/                             # `npx cap add ios` output — committed (.gitignore Pods/)
│   │   ├── App/App/Info.plist
│   │   ├── App/App/PrivacyInfo.xcprivacy    # D-18 hand-crafted
│   │   └── App/App/App.entitlements         # Associated Domains
│   ├── android/                         # `npx cap add android` output — committed (.gitignore .gradle/)
│   │   └── app/src/main/AndroidManifest.xml # Intent filters + USE_BIOMETRIC
│   └── fastlane/                        # Shared Gemfile + lanes (or split per-platform under apps/ios/fastlane)
├── src/
│   └── lib/native/
│       ├── platform.ts      (FILLED — Capacitor.getPlatform())
│       ├── deeplink.ts      (FILLED — App.addListener('appUrlOpen'))
│       ├── iap.ts           (FILLED — @revenuecat/purchases-capacitor)
│       ├── biometric.ts     (NEW    — @capgo/capacitor-native-biometric)  ← Phase 16 adds
│       ├── share.ts         (NEW    — @capacitor/share)                    ← Phase 16 adds
│       ├── push.ts          (STILL STUB — Phase 17)
│       ├── ads.ts           (STILL STUB — Phase 20)
│       └── health.ts        (STILL STUB — Phase 18)
├── supabase/functions/
│   └── revenuecat-webhook/index.ts      # NEW — mirrors stripe-webhook
├── public/.well-known/                  # ASAA + assetlinks served by Vercel
│   ├── apple-app-site-association       # JSON, NO .json extension (Apple requirement)
│   └── assetlinks.json
└── e2e/mobile/                          # NEW Playwright + Capacitor-simulator tests
```

### Pattern 1: `detectPlatform()` Implementation

**What:** Replace the throw-stub with `Capacitor.getPlatform()`-backed detection.
**When to use:** Every UI fork that switches behavior on web vs native (paywall fork D-13, clinic-owner D-24, biometric availability gate).

```typescript
// src/lib/native/platform.ts — Phase 16 fill
// Source: capacitorjs.com/docs/apis/core [CITED]
import { Capacitor } from '@capacitor/core';

export type Platform = 'web' | 'ios' | 'android' | 'capacitor-web';

export function detectPlatform(): Platform {
  const p = Capacitor.getPlatform(); // 'web' | 'ios' | 'android'
  if (p === 'ios' || p === 'android') return p;
  // Capacitor on web (e.g., `npx cap serve`) — treat as web for paywall purposes
  return Capacitor.isNativePlatform() ? 'capacitor-web' : 'web';
}
```

### Pattern 2: Deep-Link Routing into LeanShot's Hash + Pathname Hybrid

**What:** LeanShot uses a hybrid routing scheme: `#/auth/*`, `#/legal/*`, `#/share/*` are HASH routes; `/clinic/*`, `/`, `/pricing`, `/share/*` (Phase 8 SharePage uses BOTH patterns) are PATHNAME routes. Universal Links always deliver a pathname. The bridge must dispatch to the correct mechanism.

**When to use:** All 4 D-11 deep-link categories.

```typescript
// src/lib/native/deeplink.ts — Phase 16 fill
// Source: capacitorjs.com/docs/guides/deep-links [CITED]
// Reference: project memory `reference_supabase_auth_traps.md` (implicit-grant + hash-routes double-# trap)
import { App, type URLOpenListenerEvent } from '@capacitor/app';

const PATHNAME_PREFIXES = ['/clinic', '/pricing', '/faq', '/r/', '/share/'];
const HASH_PREFIXES = ['/auth/', '/legal/'];

export function installDeepLinkHandler(): void {
  App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    try {
      const u = new URL(event.url);
      const path = u.pathname; // e.g., '/share/abc123' or '/clinic/foo'

      // Path-based routes (Phase 8+ clinic + marketing)
      if (PATHNAME_PREFIXES.some((p) => path === p || path.startsWith(p))) {
        window.history.pushState({}, '', path + u.search);
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
      }

      // Hash-based routes (Phase 4 auth + Phase 7 legal + Phase 8 share-hash variant)
      for (const hp of HASH_PREFIXES) {
        if (path.startsWith(hp)) {
          window.location.hash = '#' + path + u.search;
          return;
        }
      }

      // Fallback: marketing root
      window.history.pushState({}, '', '/');
    } catch {
      // Malformed URL — silently ignore (Sentry will pick up the throw above if it happens)
    }
  });
}
```

### Pattern 3: RevenueCat Configure + Paywall Fork

**What:** Configure RC at app boot (BEFORE first paywall render), check entitlements, present platform-correct paywall.

**When to use:** Wave 2 — IAP + paywall fork.

```typescript
// src/lib/native/iap.ts — Phase 16 fill (replaces throw-stub)
// Source: revenuecat.com/docs/getting-started/installation/capacitor [CITED]
import { Purchases, LOG_LEVEL } from '@revenuecat/purchases-capacitor';
import { detectPlatform } from './platform';

const RC_API_KEY_IOS     = import.meta.env.VITE_RC_API_KEY_IOS!;
const RC_API_KEY_ANDROID = import.meta.env.VITE_RC_API_KEY_ANDROID!;

export async function configureRC(appUserID: string): Promise<void> {
  const platform = detectPlatform();
  if (platform === 'web' || platform === 'capacitor-web') return; // No-op on web

  await Purchases.setLogLevel({ level: LOG_LEVEL.WARN });
  await Purchases.configure({
    apiKey: platform === 'ios' ? RC_API_KEY_IOS : RC_API_KEY_ANDROID,
    appUserID,
  });
}

export async function purchaseSubscription(productId: string): Promise<void> {
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) throw new Error('No RevenueCat offering configured');

  const pkg = current.availablePackages.find((p) => p.product.identifier === productId);
  if (!pkg) throw new Error(`Product ${productId} not in current offering`);

  await Purchases.purchasePackage({ aPackage: pkg });
  // CustomerInfoUpdateListener will fire — webhook also fires server-side
}

export async function restorePurchases(): Promise<void> {
  await Purchases.restorePurchases();
}

export async function hasActivePlusEntitlement(): Promise<boolean> {
  const { customerInfo } = await Purchases.getCustomerInfo();
  return typeof customerInfo.entitlements.active['plus'] !== 'undefined';
}
```

### Pattern 4: RevenueCat Webhook → `subscriptions` Edge Function

**What:** Mirror `stripe-webhook` shape; insert/upsert with `provider='revenuecat'`; let the `MAX(expires_at)` rule compute effective tier.

**When to use:** Wave 2 — the server side of cross-platform sync.

```typescript
// supabase/functions/revenuecat-webhook/index.ts — Phase 16 NEW
// Source: revenuecat.com/docs/integrations/webhooks [CITED]
// Pattern: mirrors supabase/functions/stripe-webhook/index.ts (P14)
import { createClient } from 'jsr:@supabase/supabase-js';

const SHARED_SECRET = Deno.env.get('REVENUECAT_WEBHOOK_AUTH')!;

Deno.serve(async (req) => {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${SHARED_SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const body = await req.json();
  const event = body.event;
  // event.type: INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION,
  //             BILLING_ISSUE, UNCANCELLATION, PRODUCT_CHANGE, TRANSFER
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // D-04 — immediate downgrade on CANCELLATION / EXPIRATION
  const expiresAt =
    event.type === 'CANCELLATION' || event.type === 'EXPIRATION'
      ? new Date().toISOString()
      : new Date(event.expiration_at_ms).toISOString();

  await supabase.from('subscriptions').upsert({
    user_id: event.app_user_id,
    provider: 'revenuecat',
    product_id: event.product_id,
    expires_at: expiresAt,
    status: event.type,
    raw_event: event,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
});
```

> **Memory hint applied:** `reference_supabase_edge_function_deploy.md` — gateway overrides Content-Type to `text/plain` ONLY for HTML responses. JSON responses pass through cleanly. This webhook is safe.

### Pattern 5: Biometric Unlock with Password Fallback

```typescript
// src/lib/native/biometric.ts — Phase 16 NEW (firewall zone: shared/no-restriction)
// Source: capgo.app/docs/plugins/native-biometric/ [CITED]
import { NativeBiometric, BiometryType } from '@capgo/capacitor-native-biometric';

export async function unlockOrFallback(): Promise<'biometric' | 'password' | 'unavailable'> {
  try {
    const { isAvailable } = await NativeBiometric.isAvailable();
    if (!isAvailable) return 'unavailable';

    await NativeBiometric.verifyIdentity({
      reason: 'Unlock LeanShot',
      title: 'Authenticate',
      subtitle: 'Use Face ID / Touch ID to open the app',
      description: 'Falls back to your account password if biometrics fail',
    });
    return 'biometric';
  } catch {
    // User cancelled or hardware error — surface password screen
    return 'password';
  }
}
```

### Pattern 6: Sentry Capacitor + React Dual-Init

[CONFIDENCE: MEDIUM — exact React signature confirmed via @sentry/capacitor README references but not pinned line-of-code in fetched content]

```typescript
// src/main.tsx — Phase 16 modification
// Source: docs.sentry.io/platforms/javascript/guides/capacitor/ + github.com/getsentry/sentry-capacitor README
import * as Sentry from '@sentry/capacitor';
import * as SentryReact from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: import.meta.env.VITE_SENTRY_RELEASE, // 'ios@1.0.0' or 'android@1.0.0' per D-17
  integrations: [
    SentryReact.browserTracingIntegration(),
    SentryReact.replayIntegration(),
  ],
  tracesSampleRate: 0.1,
}, SentryReact.init); // ← second arg is the React init function — official dual-init pattern
```

> **Validation step:** plan-phase MUST verify this exact signature in the @sentry/capacitor v4 README during the executor's first plan write, since the React-specific code wasn't captured verbatim in research. If the v4 README changed the signature, adjust per current docs. [ASSUMED] — pinned-line evidence not retrieved this session.

### Pattern 7: `apple-app-site-association` Hosting (Vercel)

```json
{
  "applinks": {
    "details": [
      { "appID": "TEAMID.app.leanshot.ios", "paths": [
        "/r/*", "/share/*", "/clinic/*", "/clinic-invite/*",
        "/signin", "/signup", "/reset-password", "/verify-email",
        "/pricing", "/faq", "/"
      ]}
    ]
  },
  "webcredentials": { "apps": ["TEAMID.app.leanshot.ios"] }
}
```

**Vercel hosting requirements:**
- File at `public/.well-known/apple-app-site-association` (NO `.json` extension)
- `vercel.json` header override: `Content-Type: application/json`
- HTTPS, no redirects [CITED: capacitorjs.com/docs/guides/deep-links]
- Hosted on BOTH `leanshot.app` AND `app.leanshot.app` per D-09

```json
// vercel.json — new headers entry
{
  "headers": [
    {
      "source": "/.well-known/apple-app-site-association",
      "headers": [{ "key": "Content-Type", "value": "application/json" }]
    },
    {
      "source": "/.well-known/assetlinks.json",
      "headers": [{ "key": "Content-Type", "value": "application/json" }]
    }
  ]
}
```

### Pattern 8: `assetlinks.json` (Android App Links)

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.leanshot.android",
      "sha256_cert_fingerprints": [
        "<UPLOAD-CERT-FINGERPRINT>",
        "<PLAY-STORE-SIGNING-FINGERPRINT>"
      ]
    }
  }
]
```

**Critical:** Play Store uses **its own signing key** after upload. The fingerprint Play Console shows under **Release → Setup → App integrity → App signing key** must be in this array OR App Links break in production. [CITED: developer.android.com/training/app-links/verify-android-applinks]

### Pattern 9: Capgo Live Updates Path-Allowlist (D-13 Mitigation)

```typescript
// src/lib/native/live-updates.ts — Phase 16 NEW (only initialized when Capgo plan is paid)
// Apple §3.3.2 + §4.7 compliance: monetization paths use bundled JS only
import { CapacitorUpdater } from '@capgo/capacitor-updater';

const ALLOWED_OTA_PATHS = ['/', '/home', '/medication', '/body', '/insights', '/share'];
const BLOCKED_OTA_PATHS = ['/pricing', '/auth/', '/clinic/billing', '/upgrade'];

export async function maybeApplyUpdate(): Promise<void> {
  const currentPath = window.location.pathname;
  if (BLOCKED_OTA_PATHS.some((p) => currentPath.startsWith(p))) return;
  // Capgo updater will only download/apply when on allowed paths
  // (Capgo's own runtime also checks; this is belt-and-suspenders)
  await CapacitorUpdater.notifyAppReady();
}
```

> **D-13 plan-phase requirement:** The actual `/pricing` route component must render `<PricingIOS />` when `detectPlatform() === 'ios'` and `<PricingWeb />` otherwise — both file paths must be bundled (not OTA-replaceable), enforced via Vite chunk naming.

### Anti-Patterns to Avoid

- **Bypassing `src/lib/native/*`** — Direct `import { Capacitor } from '@capacitor/core'` in a tab component breaks the Phase 12 firewall. ESLint will error; do not disable the rule.
- **Single bundle ID across iOS+Android** — Breaks D-10 (separate Sentry projects, separate Privacy Manifests, separate per-store analytics).
- **Stripe Checkout link on iOS `/pricing`** — Direct §3.1.1 rejection. Use `<PricingIOS />` with RevenueCat purchase button instead. NEVER include phrases like "subscribe on our website for a lower price" — §3.1.1(a) anti-steering applies OUTSIDE US storefront, and LeanShot ships to ES/DE/FR per D-20 (non-US).
- **Loading remote JS at runtime for paywall** — Even via dynamic `import()` to a non-bundled URL. §4.7 + §3.3.2 hard rejection.
- **`#`-prefix in AASA paths** — Universal Links don't see fragments. AASA paths use `/share/*` not `#/share/*`. Native deep-link bridge translates `path → hash` at runtime (Pattern 2).
- **Skipping `PrivacyInfo.xcprivacy`** for any installed plugin — Each of the 14 plugins must be audited. Apple rejects missing manifests with cryptic "Privacy Manifest Issue" errors.
- **Forgetting Play Store re-signing fingerprint** in `assetlinks.json` — App Links work in internal testing (upload cert) but break in production (Play re-signs).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Receipt validation (App Store + Play) | Custom server-side StoreKit + Play Billing validation | RevenueCat handles this server-side | StoreKit notifications + Play RTDN are gnarly; RC's $0/mo tier handles <$2.5k MTR for free. Time-to-build ~3 weeks vs. ~2 hours. |
| Cross-platform tier reconciliation logic | Custom merge of Stripe + iOS + Android subscription state | RC + `MAX(expires_at)` SQL rule (D-02) | Edge cases (refunds, billing-issue grace, mid-period upgrade) explode in custom code. SQL `MAX` is one line. |
| Native crash reporter | Hand-built objc/Java crash handler | `@sentry/capacitor` (D-17) | Symbolication of stripped iOS binaries + Android ProGuard maps is a multi-week project. |
| Code-signing automation | Manual `xcodebuild`/Gradle scripts + ad-hoc cert distribution | `fastlane match` (D-16) | match's git-encrypted-repo + lost-key playbook is industry standard. Manual scripts break per-developer. |
| Image thumbnail server | Self-hosted sharp/libvips image resizer | Supabase Storage transforms (Pro tier, D-08) | Pro tier `/render/image?width=200` URL handles cache, format selection (webp/avif), edge delivery. ~$25/mo vs. weeks of infra. |
| Biometric secure storage of credentials | Custom keychain wrapper | `@capgo/capacitor-native-biometric` `setCredentials/getSecureCredentials` | Plugin already bridges to Keychain (iOS) / Keystore (Android) with biometric gates. |
| Long-list virtualization | Hand-rolled IntersectionObserver loop | `react-virtuoso` `VirtuosoGrid` | Variable-sized items + endReached + grid mode out of the box. Hand-roll = OOM in production. |
| ASO screenshot automation | Manual Figma export per viewport per locale | Playwright `page.setViewportSize` capture loop + designer Pencil overlay (D-19) | 6 viewports × 5 screens × 4 locales = 120 captures; Playwright does it deterministically. |
| Universal Link signature validation | Custom AASA fetcher | iOS handles automatically when Associated Domains entitlement is set | Apple validates the AASA file at install + periodically; don't reinvent. |

**Key insight:** Phase 16 is **engineering through vendor selection**. Every "Don't Hand-Roll" item is a $20-30/mo SaaS that buys weeks of engineering. The CONTEXT decisions already selected these — research confirms they are the right calls.

## Runtime State Inventory

**Not applicable — this is a greenfield phase (adding native shells; not renaming/refactoring existing runtime state).**

However, three **forward-state items** matter for plan-phase:

| Category | Items | Action |
|----------|-------|--------|
| Stored data | Existing `subscriptions` table (Phase 14) — `provider` column already exists per `code_context` line 86; this phase only INSERTS rows with `provider='revenuecat'` | No migration needed; verify P14 schema includes `provider enum` + composite uniqueness on `(user_id, provider)` |
| Live service config | New RevenueCat dashboard project with 2 products + 1 entitlement + webhook URL pointing to `revenuecat-webhook` Edge Function; new Capgo project; new App Store Connect app record (×1) + Play Console app record (×1) | Vendor checkpoints — flag as Wave 0 |
| OS-registered state | iOS Associated Domains capability registered in App Store Connect; Android Digital Asset Links auto-verified via Play Console | Configured in fastlane lanes during Wave 3 |
| Secrets / env vars | `VITE_RC_API_KEY_IOS`, `VITE_RC_API_KEY_ANDROID`, `REVENUECAT_WEBHOOK_AUTH` (Supabase Function Secret), `SENTRY_AUTH_TOKEN` (CI for dSYM upload), `FASTLANE_PASSWORD` (CI for match), `APP_STORE_CONNECT_API_KEY_JSON` (CI for upload) | NET-NEW secrets; plan a single "secrets manifest" task |
| Build artifacts | `apps/ios/App/App.xcworkspace`, `apps/android/app/build/outputs/bundle/release/app-release.aab` | Generated by fastlane; not committed |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Capacitor 8 CLI | ✓ | 22.18.0 (dev machine) | None — Capacitor 8 mandates Node 22+ |
| Xcode | iOS builds | UNKNOWN (dev-machine specific) | Must be 26.0+ for Capacitor 8 | Use GitHub Actions macOS runner exclusively |
| Android Studio | Android builds | UNKNOWN (dev-machine specific) | Must be Otter / 2025.2.1+ | Use GitHub Actions ubuntu runner with sdkmanager |
| `fastlane` (Ruby gem) | Wave 3 build automation | ✗ (not installed) | latest (~2.227.x) | Install in CI via `bundle install`; dev machines optional |
| Ruby | fastlane dependency | macOS system ruby works | 2.6+ | Same as fastlane |
| Apple Developer Program | App Store submission | UNKNOWN — Phase 12 vendor checkpoint flagged | $99/yr | None — blocking |
| Google Play Console | Play submission | UNKNOWN — Phase 12 vendor checkpoint flagged | $25 one-time | None — blocking |
| RevenueCat account | MONEY-06 | ✗ (NET-NEW per CONTEXT D-01) | $0/mo until $2.5k MTR | None — blocking |
| Supabase Pro tier | D-08 Storage transforms | ✗ (currently Free) | $25/mo | None for iOS — without transforms, OOM crash blocks MOBILE-08 |
| Capgo account | D-12 Live Updates | ✗ (NET-NEW) | $15-30/mo | **Bundled-only mode acceptable for first submission**; defer Capgo until v1.2.1 |
| `leanshot.app` DNS + `.well-known/` | D-09 Universal Links | UNKNOWN — Phase 12 vendor carry-over | — | None — blocking; Universal Links won't validate |
| `leanshot-fastlane-match` private repo | D-16 signing-key sync | ✗ (NET-NEW) | GitHub private repo (free) | None — match requires git repo |
| 1Password Vault | D-16 backup | UNKNOWN | $0 (existing personal) | Alternative: any password manager / encrypted backup |
| iPhone 12 (4GB) for OOM soak | MOBILE-08 success criterion | UNKNOWN | iOS 15+ | TestFlight beta on a colleague's device; or Xcode simulator with memory throttle |

**Missing dependencies with no fallback (Wave 0 blockers):**
- Apple Developer Program account (carry-over from Phase 12)
- Google Play Console account (carry-over from Phase 12)
- RevenueCat account + 2 products configured
- Supabase Pro tier upgrade (before iOS submission, not before development)
- `leanshot.app` DNS pointing to Vercel + AASA accessibility verified
- `leanshot-fastlane-match` private GitHub repo

**Missing dependencies with fallback:**
- Capgo account — ship bundled-only first; add Capgo in v1.2.1 (D-12 already permits this)

## Common Pitfalls

### Pitfall 1: AASA Path Doesn't Match Native Route Resolution
**What goes wrong:** AASA `paths` include `/share/*` but the app's deep-link handler can't resolve `/share/abc123` to a view because LeanShot's SharePage is on the `#/share/<token>` hash route OR the `/share/<token>` pathname route (mixed per Phase 8).
**Why it happens:** Universal Links deliver pathname; LeanShot routes are inconsistent (project memory: `project_phase15_shipped.md` notes hash↔path drift).
**How to avoid:** Pattern 2 above — the deep-link handler **inspects pathname and dispatches to hash OR pushState as appropriate**. Add an e2e test that simulates `App.addListener('appUrlOpen', ...)` firing with all 4 D-11 deep-link shapes and asserts the resulting `useStore().currentTab` / `window.location.hash` matches expectations.
**Warning signs:** "Tap link, app opens, lands on home tab" instead of the linked content — silent failure.

### Pitfall 2: Apple Privacy Manifest Rejection Without Clear Error
**What goes wrong:** App Store Connect rejects upload with "ITMS-91056: Invalid privacy manifest" or "Missing API declaration" with no specific row pointer.
**Why it happens:** One of 14 plugins introduces a required-reason API call (often `UserDefaults` via `@capacitor/preferences`, `SystemBootTime` via Capacitor core, `FileTimestamp` via Capacitor filesystem) and the hand-crafted manifest missed it.
**How to avoid:** Use Apple's [Privacy Manifest Tooling](https://developer.apple.com/documentation/bundleresources/privacy_manifest_files) via Xcode 26 — build the app, then Xcode auto-generates a "found vs declared" diff in the build log. Iterate the manifest until diff is empty. Run this in fastlane gym pre-upload as a CI gate.
**Warning signs:** Build succeeds locally but App Store Connect upload errors after 5-10min processing.

### Pitfall 3: WKWebView OOM on Photo Tab — Soak Reveals It, Not Functional Tests
**What goes wrong:** Photo tab works with 10 photos in dev. User uploads 200 over 6 months. iPhone 12 (4GB) WKWebView background-killed when memory pressure hits.
**Why it happens:** Raw PNG photos stored as Storage URLs decode in WKWebView at full res (often 8-12MP from iPhone camera). 200 × 30MB decoded = 6GB. WebView is killed by iOS jetsam before it crashes loudly.
**How to avoid:**
1. Supabase Pro tier transforms (D-08) — request `?width=400&height=400&quality=70` for thumbnails (~50KB each); raw on detail view only.
2. `<VirtuosoGrid totalCount={photos.length} itemContent={...}>` so only ~20 thumbnails decoded simultaneously.
3. Decode budget — `<img loading="lazy">` + `<img decoding="async">`.
4. Deterministic 30-min 200-photo soak harness (Validation Architecture below).
**Warning signs:** "Photo tab feels slow at scroll" → already 80% to OOM in production.

### Pitfall 4: Apple §3.1.1 Anti-Steering Rejection on `/pricing` Marketing Copy
**What goes wrong:** Apple reviewer opens the in-app `/pricing` page on iPhone, sees Stripe-style "Subscribe — $X/mo" + a link to leanshot.app/account/billing, rejects under §3.1.1(a).
**Why it happens:** Phase 15 shipped a unified `/pricing` that links to Stripe Checkout for web. D-13 demands platform-aware fork but the implementation lives in `pricing-page-content.ts` (a Phase 15 file) — easy to miss the fork.
**How to avoid:** `<PricingIOS />` component renders ONLY:
- Plan tier comparison (no prices in $ — use "Free" / "Plus" labels)
- "Subscribe via App Store" button that calls `purchaseSubscription(productId)`
- NO web URL, NO "save by subscribing on the web", NO text that mentions other purchase paths.
- Optional: pre-written "Apple Reviewer Note" in App Store Connect explaining D-24 clinic-owner case ("clinic billing is managed at leanshot.app/clinic/billing" — this is allowed under §3.1.1's "service consumed elsewhere" carve-out, NOT a digital subscription).
**Warning signs:** Pre-submission audit — diff `/pricing` rendered in `Capacitor.getPlatform() === 'ios'` vs. web. ANY mention of price-elsewhere is rejection-bait outside US storefront (LeanShot ships to DE/ES/FR — non-US).

### Pitfall 5: fastlane match Lost-Key Doomsday
**What goes wrong:** macOS dev machine wiped. `FASTLANE_PASSWORD` not backed up. `leanshot-fastlane-match` repo encrypted with that password. Can't decrypt. Must `match nuke distribution` and re-issue certs — invalidates existing TestFlight builds, may require user re-install.
**Why it happens:** match passwords are not stored anywhere by fastlane; if the dev memorizes it and forgets, all backups encrypted by it are useless.
**How to avoid:** D-16 already mandates 1Password Vault backup of `FASTLANE_PASSWORD`. Plan-phase MUST treat "1Password vault entry exists + verified-readable" as an explicit Wave 3 gate, not an aside.
**Warning signs:** None — silent until disaster.

### Pitfall 6: Play Store App Links Production Break (Re-signing Fingerprint)
**What goes wrong:** App Links work in Internal Testing track (upload cert signs the AAB). User installs from production Play Store, taps `leanshot.app/share/X`, lands in browser instead of app.
**Why it happens:** Play Store re-signs the AAB with its own signing key on user devices. `assetlinks.json` only contains the upload cert fingerprint, not the Play-issued one.
**How to avoid:** After first Play upload, copy the "App signing key SHA-256" from Play Console → Setup → App integrity, add to `assetlinks.json`, redeploy. Verify with `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://leanshot.app&relation=delegate_permission/common.handle_all_urls`.
**Warning signs:** "Works on my Android" but fails on a user's production install.

### Pitfall 7: Cap-8 SPM Default Trips Up CocoaPods Plugins
**What goes wrong:** Capacitor 8 defaults to Swift Package Manager. Some older plugins ship only as CocoaPods. Pod install fails or plugin is silently missing.
**Why it happens:** [CITED: capacitorjs.com/docs/updating/8-0] "The CLI now creates iOS projects using Swift Package Manager by default rather than CocoaPods."
**How to avoid:** Audit each of the 14 plugins for SPM support BEFORE Wave 1. If any plugin is Pods-only, either (a) opt the iOS project back to Pods via `npx cap add ios --use-cocoapods`, or (b) wait for plugin maintainer to ship SPM support. All 14 plugins in D-07 are official `@capacitor/*` or active maintainers — SPM support is highly likely but unverified.
**Warning signs:** `pod install` errors during `npx cap sync` OR plugin methods throw "not implemented" at runtime.

### Pitfall 8: Locale Lifecycle Drift (4 Locales × ASO Refresh)
**What goes wrong:** EN strings change after launch. Translations stale. Reviewers in DE/ES/FR see outdated copy → some reviewers reject for inconsistency.
**Why it happens:** D-20 4-locale store listings are static — they're not in source control as `.po`/`.xliff`. Updating EN requires manual hand-off to translation pipeline.
**How to avoid:**
- Pick translation vendor with API: **DeepL Pro API ($25/mo) for one-shot, ChatGPT-assisted for nuanced copy**. Researcher recommends **DeepL Pro** (deterministic; LeanShot's medical/coaching tone is well-suited; auditable). Hired translator is best-quality but adds days per refresh.
- Store all ASO copy in `apps/store-listings/{en,es,de,fr}/*.md` versioned in repo.
- Plan-phase: add a P16 task "ASO refresh checklist" with translation re-run trigger.
**Warning signs:** ASO refresh review takes >2 weeks per locale.

### Pitfall 9: D-04 Asymmetric Downgrade UX Confusion
**What goes wrong:** iOS user cancels via Apple Settings. App immediately flips tier to `free`. User confused: "I paid for the rest of the month."
**Why it happens:** D-04 deliberately ships immediate downgrade on iOS to match Apple's own subscription UX (which iOS users expect). Web/Stripe keeps grace until period end.
**How to avoid:** In-app `tier === 'free'` state for users with active-but-recently-cancelled `subscriptions` row needs a one-time toast: "Your Plus subscription was cancelled. To continue Plus, resubscribe in Settings." Researcher's read of D-04: **document as permanent platform difference**, don't normalize Stripe (Apple Setting users expect immediate; Stripe users expect grace; matching each platform's native UX is more honest than forcing one model).
**Warning signs:** Support tickets "I paid until [end of month] but lost access immediately".

### Pitfall 10: D-13 Page Builder Runtime on iOS Becomes §4.7 Risk
**What goes wrong:** Phase 15 Page Builder runtime renders DB-stored block trees. If a block contains user-authored HTML/JS, §4.7 applies (HTML5 mini-app rules).
**Why it happens:** Phase 15 Page Builder is currently admin-only-authored (operators write blocks); not user-authored. But the runtime CAPABILITY exists. If Phase 17+ adds user-authored landing pages or share-card customization, §4.7 triggers.
**How to avoid:** Plan-phase decision needed (D-13 open question). Researcher's recommendation: **separate iOS-safe-mode build flag — DOES NOT need a new flag IF Phase 16 ships before any user-authored block-tree feature.** Until then, the page builder is just a content-management system for the LeanShot team, which is fine under §4.7. If Phase 17 introduces user-authored blocks, that phase plans the iOS-safe-mode flag. **Defer the flag decision; don't engineer it now.**
**Warning signs:** Future phase introduces user HTML/JS authoring → §4.7 risk explodes.

## Code Examples

(See Patterns 1-9 above — they ARE the code examples. Inlined for plan-phase reference.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| StoreKit 1 manual receipt validation | StoreKit 2 + RevenueCat managed | iOS 15+ (StoreKit 2 GA) | RevenueCat handles both via plugin; no app-side StoreKit code needed |
| Universal Links via swift-only AASA fetch | Capacitor App plugin's `appUrlOpen` event abstracts both iOS Universal Links and Android App Links | Capacitor 3+ | Single JS handler routes both platforms |
| Manual cert distribution via .p12 | `fastlane match` git-encrypted-repo | fastlane 2.x era | Reproducible across CI + multiple devs |
| Sentry JS-only crash reporting | `@sentry/capacitor` 4.x with native Cocoa + Android SDKs | 4.0.0 published 2026-05-01 (FRESH) | Native crashes (not just JS exceptions) symbolicated end-to-end |
| Hand-rolled image thumbnails | Supabase Storage `/render/image` Pro-tier transforms | 2024-Q1 GA | $25/mo replaces ~$5k/mo bespoke pipeline |
| Manual ASO screenshot capture | Playwright `setViewportSize` + designer Pencil overlay | 2024 (Playwright 1.40+) | Deterministic 6-viewport × 4-locale capture loop |
| `@capacitor/livereload` for dev | Capacitor server.url pointing to Vite dev server | Vite 4+ era | `server.url: http://localhost:5173` in capacitor.config.ts gives HMR inside the native shell |

**Deprecated/outdated:**
- CocoaPods as Capacitor 8 default — replaced by SPM (Pitfall 7)
- `@capacitor/local-notifications` for push reminders — moved to `@capacitor/push-notifications` in Phase 17

## Project Constraints (from CLAUDE.md)

- **React 19 + Vite 6 + TS 5.6 + Tailwind v4** — Locked. Capacitor 8 is React-version-agnostic (works with React 19).
- **Zustand single store** — `currentTab`, `user`, etc. live in `useStore`. Deep-link handler must dispatch to `useStore.getState().setTab(...)` for tab routes, not just hash mutation.
- **No router** — LeanShot uses hash + pathname inspection. Pattern 2 respects this (hybrid dispatcher).
- **Path alias `@/*` → `src/*`** — All Capacitor imports must use `@/lib/native/*`, never `@capacitor/*` from feature code.
- **Bundle size discipline** — Phase 12 D-04 chunk caps: page-builder-runtime ≤25 kB, etc. RevenueCat SDK is ~80kB but only loaded on native — must verify Vite chunk-naming keeps it OFF the web bundle.
- **ESLint flat config + import-x/no-restricted-paths** — Phase 12 firewall ZONES preserved; new `native/biometric.ts` + `native/share.ts` go in shared zone (no restrictions inbound). Do NOT add firewall rules for them.
- **Strict TypeScript** — Capacitor plugin types are well-maintained; `Purchases.configure({})` typed.
- **Direct browser → Anthropic preserved** — Phase 16 does NOT touch the AI coach. `@capacitor/browser` is for in-app Safari View Controller (Stripe Portal on iOS clinic-owner case), not the AI flow.
- **No emojis in code/comments** — Honored (none in the patterns above).
- **GSD workflow enforcement** — All edits inside `/gsd-execute-phase 16` per CLAUDE.md.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 (unit) + Playwright 1.59 (e2e) — already installed |
| Config files | `vitest.config.ts` (existing), `playwright.config.ts` (existing) — Phase 16 likely adds `vitest-mobile.config.ts` for jsdom-mocked Capacitor tests |
| Quick run command | `npm run test:unit` |
| Full suite command | `npm run test` (vitest + playwright) |
| Mobile-specific | NEW Playwright project + NEW vitest config (Wave 0) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MOBILE-01 | iOS app installs from TestFlight | manual-only | Manual TestFlight install → open → land on home in ≤10s | ❌ Wave 3 manual UAT |
| MOBILE-02 | Android app installs from Play Internal | manual-only | Manual Play Internal install → open → home in ≤10s | ❌ Wave 3 manual UAT |
| MOBILE-03 | Feature code cannot import `@capacitor/*` directly | unit (ESLint) | `npm run lint -- src/components` | ✅ Phase 12 firewall already enforces; add 1-2 negative-test fixtures |
| MOBILE-04 | ASO assets present at all 6 viewports × 4 locales | integration | `playwright test e2e/aso/aso-capture.spec.ts` (loop) | ❌ Wave 3 NEW |
| MOBILE-05 | PrivacyInfo + Data Safety form complete | integration | `node scripts/audit-privacy-manifest.mjs` (declares vs found diff) | ❌ Wave 3 NEW |
| MOBILE-06 | Deep link `leanshot.app/share/X` routes in-app | unit (mocked Capacitor) | `vitest run src/lib/native/deeplink.test.ts` | ❌ Wave 1 NEW |
| MOBILE-06 | AASA + assetlinks served with correct Content-Type | smoke | `curl -i https://leanshot.app/.well-known/apple-app-site-association` (CI check) | ❌ Wave 1 NEW (CI script) |
| MOBILE-07 | Biometric unlock with fallback | unit (mocked) | `vitest run src/lib/native/biometric.test.ts` | ❌ Wave 1 NEW |
| MOBILE-08 | 200-photo gallery soak ≤ memory cap, 0 crashes | e2e + native | `playwright test e2e/mobile/photo-soak.spec.ts` (drives the soak harness via Capacitor live-reload) | ❌ Wave 2 NEW |
| MOBILE-09 | Sentry receives test crash | smoke | `node scripts/sentry-test-crash.mjs` (deploy then trigger) | ❌ Wave 3 |
| MOBILE-10 | Share sheet opens with correct content | unit (mocked) | `vitest run src/lib/native/share.test.ts` | ❌ Wave 1 NEW |
| MONEY-06 | Purchase flow → entitlement → webhook → `subscriptions` row | integration | `playwright test e2e/mobile/iap-flow.spec.ts` (uses RC sandbox + live Supabase) | ❌ Wave 2 NEW |
| MONEY-06 | `MAX(stripe.expires_at, rc.expires_at)` rule | unit (DB) | `vitest run e2e/rls-tier-effective.test.ts` (service-role JWT pattern per project memory) | ❌ Wave 2 NEW |
| MOBILE-08 | Cold-start time on iPhone 12 ≤10s | manual + measured | Sentry transaction `app.start` p95 ≤10s over 7-day TestFlight | ❌ Wave 3 telemetry |

### Sampling Rate

- **Per task commit:** `npm run test:unit` (Vitest only — ~10s)
- **Per wave merge:** `npm run lint && npm run test:unit && npm run test:e2e` (~3 min)
- **Phase gate:** Full suite green + manual TestFlight soak (7 days) + manual Play Internal soak (3 days) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `vitest-mobile.config.ts` — Capacitor plugin mocks via vitest's `vi.mock('@capacitor/core')` pattern
- [ ] `e2e/mobile/playwright.config.ts` OR add a `mobile` project to existing playwright config
- [ ] `src/lib/native/__mocks__/` — manual Capacitor mocks for `App`, `Purchases`, `NativeBiometric`, `Share`
- [ ] `scripts/audit-privacy-manifest.mjs` — diffs declared `PrivacyInfo.xcprivacy` against Xcode build log "found required-reason APIs"
- [ ] `scripts/sentry-test-crash.mjs` — triggers a known crash payload, polls Sentry API for receipt
- [ ] `e2e/mobile/photo-soak.spec.ts` + a 200-photo seeding fixture in Supabase Storage
- [ ] CI workflow `mobile.yml` — runs lint + unit + e2e:mobile + fastlane match validate (without building) on every PR touching `apps/`, `src/lib/native/`, or `capacitor.config.ts`

### Specific: MOBILE-08 200-Photo OOM Soak Protocol

```typescript
// e2e/mobile/photo-soak.spec.ts (Wave 2)
test('200-photo gallery scroll on iPhone 12 — no OOM in 30min', async ({ page }) => {
  // Seed: 200 photos × ~3MB each in user fixture's Supabase Storage bucket
  await seedTestPhotos({ count: 200, sizeMB: 3 });
  await page.goto('http://localhost:5173/#/photos');

  // Capacitor live-reload: this drives the iOS simulator's WKWebView via Vite
  // 30-min loop: scroll up/down across full gallery
  const start = Date.now();
  while (Date.now() - start < 30 * 60_000) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2_000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(2_000);
  }

  // Assert: no Sentry crash event in this session
  const sentryEvents = await fetchSentryEventsBySession(session.id);
  expect(sentryEvents.filter(e => e.level === 'fatal')).toHaveLength(0);

  // Assert: memory pressure markers never exceeded
  // (Capacitor exposes memoryWarning event; we listen + count)
  const memoryWarnings = await page.evaluate(() => (window as any).__memWarnCount);
  expect(memoryWarnings).toBeLessThan(3); // tolerate 2 (system noise), fail at 3+
});
```

### Specific: MONEY-06 IAP Flow with RevenueCat Sandbox

```typescript
// e2e/mobile/iap-flow.spec.ts (Wave 2)
test('sandbox purchase → entitlement active → webhook fires → subscriptions row', async () => {
  // 1. Authenticate test user via service-role JWT (project memory: rls fixture pattern)
  const userId = await createTestUser('iap-flow@leanshot.test');

  // 2. Configure RC with sandbox API key (RevenueCat dashboard ENV: sandbox)
  await Purchases.configure({ apiKey: process.env.RC_SANDBOX_KEY!, appUserID: userId });

  // 3. Drive purchase (Apple Sandbox tester required — manually configured in Apple ID Settings)
  const offerings = await Purchases.getOfferings();
  const monthlyPkg = offerings.current!.availablePackages.find(p => p.product.identifier === 'app.leanshot.plus.monthly');
  await Purchases.purchasePackage({ aPackage: monthlyPkg! });

  // 4. Verify entitlement (client-side)
  const info = await Purchases.getCustomerInfo();
  expect(info.customerInfo.entitlements.active['plus']).toBeDefined();

  // 5. Verify webhook fired → subscriptions row exists (server-side, with retry — webhook delivery is async)
  await retry(async () => {
    const { data } = await supabaseService
      .from('subscriptions')
      .select()
      .eq('user_id', userId)
      .eq('provider', 'revenuecat');
    expect(data).toHaveLength(1);
    expect(data![0].status).toBe('INITIAL_PURCHASE');
  }, { attempts: 6, delayMs: 5_000 });

  // 6. Verify effective-tier rule
  const tier = await getEffectiveTier(userId);
  expect(tier).toBe('paid');
});
```

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing Supabase Auth + biometric overlay (D-06) — no NEW auth surface |
| V3 Session Management | yes | RC `appUserID` ↔ Supabase `user.id` — must be cryptographically tied. Researcher recommendation: use Supabase JWT `sub` as `appUserID` (1:1 mapping; no impersonation possible) |
| V4 Access Control | yes | `revenuecat-webhook` Edge Function: `Bearer ${REVENUECAT_WEBHOOK_AUTH}` validation MANDATORY (Pattern 4); reject all unsigned requests |
| V5 Input Validation | yes | Webhook payload schema: validate `event.type` ∈ known enum; validate `event.app_user_id` is a UUID matching `auth.users.id`; reject TRANSFER events that target a non-existent user_id |
| V6 Cryptography | yes | `fastlane match` uses AES-256 for cert repo; `FASTLANE_PASSWORD` ≥ 32 chars; biometric credentials via Keychain (iOS) / Keystore (Android) — handled by `@capgo/capacitor-native-biometric` |
| V7 Errors/Logging | yes | Sentry max-coverage (D-17); ensure `app_user_id` and `email` are SCRUBBED from Sentry breadcrumbs (PII; HBNR-adjacent risk) |
| V9 Communications | yes | All native plugin → backend traffic over HTTPS (Supabase + RC enforce); AASA + assetlinks MUST be HTTPS (Apple validates) |
| V10 Malicious Code | yes | Capgo Live Updates path-allowlist (Pattern 9) — also a §3.3.2 compliance control |
| V14 Configuration | yes | `vercel.json` Content-Type override for `.well-known/*`; `capacitor.config.ts` per-platform appId (D-10) |

### Known Threat Patterns for iOS+Android Capacitor Apps

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Webhook replay attack | Tampering | Validate `event.event_timestamp_ms` is within last 24h; idempotency key on `event.id` in Edge Function |
| Receipt fraud / jailbroken devices | Tampering | RevenueCat server-side validation; trust RC over client-claimed `customerInfo` |
| Universal Link hijacking | Spoofing | AASA file integrity (Apple validates); HTTPS-only; no redirects |
| Capgo Live Update poisoning | Tampering, EoP | Capgo's own signing; ALSO require path-allowlist (Pattern 9); ALSO require Capgo + bundled checksum compare on critical paths |
| Sentry PII leak | Information Disclosure | `beforeSend` hook scrubs `email`, `phone`, RC `appUserID` (Phase 7 carry-over: HBNR/WMHMDA-adjacent) |
| Biometric bypass via stolen device | EoP | Biometric credential storage uses Secure Enclave (iOS) / StrongBox (Android); 3-failed-attempt fallback to password |
| Stripe-on-iOS rejection (§3.1.1 violation) | DoS (review-time) | Pattern: D-13 platform-aware `/pricing` + pre-written reviewer-note |
| Anti-steering violation (DE/ES/FR storefronts) | DoS (review-time) | Audit all in-app copy for "buy on web" / "save by subscribing online" / etc. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@sentry/capacitor` v4 dual-init signature is `Sentry.init({...}, SentryReact.init)` | Pattern 6 | Plan-phase + executor must verify against current @sentry/capacitor README; if signature changed in v4 GA, adjust. Low — pattern hasn't changed across v3 → v4. |
| A2 | `react-virtuoso` `VirtuosoGrid` correctly handles 200-photo case on iOS WKWebView | Don't Hand-Roll + Pitfall 3 | If empirically OOM persists with Virtuoso, fall back to `@capacitor/camera` + on-device thumbnails (CONTEXT defers this to v1.3 as alternative path). Soak harness will catch. |
| A3 | All 14 plugins in D-07 ship SPM packages | Pitfall 7 | If one is Pods-only, opt iOS project back to CocoaPods (`npx cap add ios --use-cocoapods`). Verifiable in Wave 1 first hour. |
| A4 | RevenueCat sandbox lets us drive automated e2e purchases (without manual Apple ID tester config per test run) | Validation Architecture MONEY-06 | If sandbox requires manual Apple ID Settings config per test, MONEY-06 e2e becomes manual-only — drops to UAT. |
| A5 | Supabase Pro tier `/render/image` rate limits accommodate 200-photo soak | Pitfall 3 | Pro plan = 100 transformations/cycle baseline; soak generates ~200 unique URLs per run. May hit overage (~$1/run). Acceptable; flag in plan. |
| A6 | Apple Reviewer accepts D-24 clinic-owner Stripe link as "service consumed elsewhere" carve-out | Pitfall 4 | If rejected, fall back to: clinic-owner billing entirely managed via web — iOS app simply hides the billing UI (no link out). Plan-phase: write the response template AND the fallback. |
| A7 | D-04 immediate-downgrade is the right UX (not normalizing Stripe to immediate) | Open Question 1 | If user research shows confusion, can flip Stripe to immediate in Phase 19 closeout. Reversible; not architecturally significant. |
| A8 | D-13 page-builder runtime does NOT need an iOS-safe-mode flag in Phase 16 | Open Question 2 + Pitfall 10 | If a future phase introduces user-authored blocks before Phase 16 ships, §4.7 risk inflates. Tracker: add a check to "v1.2 milestone audit" — no user-authored blocks land before P16 verifier passes. |
| A9 | D-20 4-locale ASO can be deferred to v1.3 if needed | Open Question 3 + Specific |  Adds 25-30h to P16 (D-20 explicit). If timeline-pressured, ship EN-only first submission; add ES/DE/FR via store-listing-only update (no code release). Reversible. |
| A10 | CONTEXT D-05 "iOS 14+" is a typo / lazy paraphrase — actual Capacitor 8 minimum is iOS 15.0 | Standard Stack note | Plan-phase confirms; if user actually wanted iOS 14 support, must downgrade to Capacitor 7 (breaks all 14 plugin version pins). Recommend: accept iOS 15.0 minimum. |

## Open Questions

1. **D-04 — Should Stripe normalize to immediate-downgrade to match iOS?**
   - What we know: D-04 explicitly flags this as out of scope for P16; flag for researcher consideration.
   - What's unclear: UX impact on existing Stripe users (project memory: Phase 14 verifier passed, presumably with grace-period behavior baked in).
   - Recommendation: **Keep platforms asymmetric**. Match each platform's native UX. Document the behavior explicitly in the in-app "Manage subscription" copy. Defer normalization decision to v1.3 with user-feedback signal.

2. **D-13 — Does the page-builder runtime need a separate iOS-safe-mode build flag?**
   - What we know: Phase 15 Page Builder runtime renders DB-stored block trees. Currently admin-authored only.
   - What's unclear: Whether future phases will introduce user-authored blocks before P16 ships.
   - Recommendation: **No flag needed for P16.** Add a tracker item to "v1.2 milestone audit": "verify no user-authored block-tree feature shipped before P16 verifier passes." If a future phase introduces user blocks, that phase plans the iOS-safe-mode build flag.

3. **D-20 — 4-locale all-at-once vs EN-first-then-localize?**
   - What we know: D-20 adds ~25-30h. EN-only is the floor.
   - What's unclear: Whether DE/ES/FR markets are critical for first submission or can be a post-launch ASO refresh.
   - Recommendation: **EN-first first submission; ES/DE/FR as v1.2.1 ASO-only update.** App Store + Play allow store-listing edits without resubmitting the binary. Saves 25h on P16 critical path. Defer the 25h to a v1.2.1 sprint.

4. **Capgo Live Updates on / off for first submission?**
   - What we know: D-12 mandates hybrid bundled-fallback + Capgo. Bundled-only is acceptable per CONTEXT.
   - What's unclear: Whether Capgo is needed for v1.2 launch or can wait.
   - Recommendation: **Defer Capgo to v1.2.1.** Ship bundled-only first submission. Saves vendor checkpoint (Capgo account + integration testing) and reduces App Review surface area (§3.3.2 + §4.7 risk smaller when no OTA at all).

5. **RevenueCat sandbox automation feasibility?**
   - What we know: Apple StoreKit sandbox traditionally requires a manually-created Sandbox Apple ID configured in iPhone Settings.
   - What's unclear: Whether Apple's recent StoreKit testing improvements (Xcode StoreKit Configuration files) + RC's sandbox tooling enable full Playwright automation without manual setup per test.
   - Recommendation: **Plan for hybrid** — Vitest mocks for happy-path (Pattern 3 contract test); manual sandbox UAT once per submission cycle for the full purchase flow. Flag as a P16 closeout deferred item if a full-auto solution emerges.

## Sources

### Primary (HIGH confidence)
- [npm registry](https://www.npmjs.com) — versions verified for all 18 packages (2026-05-15)
- [Capacitor 8 docs](https://capacitorjs.com/docs/getting-started) — setup, config schema, dev workflow
- [Capacitor 8 migration](https://capacitorjs.com/docs/updating/8-0) — iOS 15.0, Node 22, Android SDK 24/36, Xcode 26.0, SPM default
- [Capacitor Deep Links guide](https://capacitorjs.com/docs/guides/deep-links) — AASA + assetlinks + appUrlOpen
- [Capacitor App API](https://capacitorjs.com/docs/apis/app) — addListener signature
- [Apple App Store Review Guidelines §3.1.1, §3.1.1(a), §4.7](https://developer.apple.com/app-store/review/guidelines/) — verbatim text fetched
- [Apple Privacy Manifest documentation](https://developer.apple.com/documentation/bundleresources/privacy_manifest_files) — schema + reason-code mapping (example reason codes verified: CA92.1 / C617.1 / C3A4.1 / E174.1 / 54BD.1)
- [RevenueCat Capacitor SDK install guide](https://www.revenuecat.com/docs/getting-started/installation/capacitor) — npm install, iOS capability, Android launchMode, configure code
- [RevenueCat Webhook event types](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields) — 17 event types enumerated with payload fields
- [RevenueCat Webhook authentication](https://www.revenuecat.com/docs/integrations/webhooks) — Authorization header configurable; 5-retry backoff (5/10/20/40/80 min)
- [Supabase Storage Image Transformations](https://supabase.com/docs/guides/storage/serving/image-transformations) — Pro-only confirmed; URL pattern; query params
- [Google Play Data Safety form guidance](https://support.google.com/googleplay/android-developer/answer/10787469) — category list

### Secondary (MEDIUM confidence)
- [Sentry Capacitor docs](https://docs.sentry.io/platforms/javascript/guides/capacitor/) — install command verified; React dual-init pattern inferred from Angular example shown in @sentry/capacitor README
- [@sentry/capacitor README on GitHub](https://github.com/getsentry/sentry-capacitor) — confirms dual-init pattern shape (`Sentry.init({...}, frameworkInit)`)
- [Capgo Live Updates docs](https://capgo.app/docs/plugin/self-hosted/getting-started/) — install + 3-phase workflow + Apple compliance scope (HTML/CSS/JS only)
- [Capgo Biometric plugin docs](https://capgo.app/docs/plugins/native-biometric/) — API method list (isAvailable, verifyIdentity, setCredentials, getCredentials, deleteCredentials, getSecureCredentials, isCredentialsSaved)
- [react-virtuoso homepage](https://virtuoso.dev/) — feature list confirmed (variable-sized items, endless scrolling, grid mode)

### Tertiary (LOW confidence — flagged for plan-phase verification)
- Reason-code mappings beyond the 5 verified — full Apple table not fetched
- Specific `customerInfo` listener signatures (`Purchases.addCustomerInfoUpdateListener`) — example code came from one doc page; cross-verify in @revenuecat/purchases-capacitor v13.1.1 README during Wave 2
- Exact RC webhook payload JSON for INITIAL_PURCHASE — fetched docs reference "Sample Events" section that wasn't in fetched excerpt; verify in dashboard or RC docs during webhook Edge Function implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all 18 versions verified against npm registry 2026-05-15
- Architecture: HIGH — patterns map 1:1 to CONTEXT decisions + verified vendor docs
- Pitfalls: HIGH — backed by Apple/Google official policy text + project memory (Phase 8 CSP hot-fix, Phase 12 D-13, Phase 5 implicit-grant trap)
- Validation: HIGH for unit/contract; MEDIUM for IAP e2e (Apple Sandbox automation A4 assumption); HIGH for OOM soak
- Open questions: MEDIUM — researcher recommendations included; final calls are plan-phase / user decisions

**Research date:** 2026-05-15
**Valid until:** 2026-06-15 (Capacitor 8.x is stable; Apple guidelines change quarterly; RC API stable; @sentry/capacitor v4 just released 2026-05-01 — re-check before submission if >30 days elapsed)
