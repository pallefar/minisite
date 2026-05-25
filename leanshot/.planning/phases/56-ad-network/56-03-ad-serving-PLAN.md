---
phase: 56-ad-network
plan: 03
type: execute
wave: 2
depends_on: [56-01]
files_modified:
  - leanshot/package.json
  - leanshot/package-lock.json
  - leanshot/src/lib/native/ads.ts
  - leanshot/src/lib/ads/adsense.ts
  - leanshot/src/lib/ads/adsense.test.ts
  - leanshot/src/components/ads/AdRenderer.tsx
  - leanshot/src/components/ads/EmbedAdSlot.tsx
  - leanshot/src/components/ads/PlatformAdSlot.tsx
  - leanshot/src/components/ads/HouseAdSlot.tsx
  - leanshot/src/components/ads/AdRenderer.test.tsx
autonomous: false
requirements: [AD-01, AD-02, AD-04, AD-07]
must_haves:
  truths:
    - "@capacitor-community/admob is installed (package.json) via --legacy-peer-deps"
    - "initAdNetwork() does real AdMob init in test mode (initializeForTesting:true), keeping the assertNoHealthData boundary guard"
    - "AdRenderer dispatches to embed-code / ad-platform / house-ads sub-renderers per placement config — all 3 modes coexist"
    - "AdRenderer renders nothing when canShowAds(surface, tier) is false (gate enforced at the single entry point)"
    - "AdSense script injects only after marketing consent fires; renders a placeholder div when the slot env var is empty"
    - "AdMob (native) serves on ios/android; AdSense (web) serves on web — branched via detectPlatform()"
  artifacts:
    - path: "leanshot/src/lib/native/ads.ts"
      provides: "Real AdMob init + banner/interstitial serving (test mode), assertNoHealthData preserved"
      contains: "assertNoHealthData"
    - path: "leanshot/src/components/ads/AdRenderer.tsx"
      provides: "canShowAds gate + freq-cap + 3-mode dispatch"
      contains: "canShowAds"
    - path: "leanshot/src/lib/ads/adsense.ts"
      provides: "Consent-gated AdSense script injector"
      exports: ["injectAdSenseScript"]
  key_links:
    - from: "leanshot/src/components/ads/AdRenderer.tsx"
      to: "leanshot/src/lib/ads/canShowAds.ts"
      via: "guard call before any ad render"
      pattern: "canShowAds\\("
    - from: "leanshot/src/components/ads/AdRenderer.tsx"
      to: "leanshot/src/lib/ads/freqCap.ts"
      via: "canShowNextImpression before impression"
      pattern: "canShowNextImpression"
    - from: "leanshot/src/lib/native/ads.ts"
      to: "@capacitor-community/admob"
      via: "AdMob import"
      pattern: "from '@capacitor-community/admob'"
user_setup:
  - service: admob
    why: "AdMob native banner/interstitial serving on iOS/Android"
    env_vars:
      - name: VITE_ADMOB_APP_ID_IOS
        source: "AdMob Console -> Apps (Phase 52 provisioned; test app ID until P70)"
      - name: VITE_ADMOB_APP_ID_ANDROID
        source: "AdMob Console -> Apps (Phase 52 provisioned)"
      - name: VITE_ADMOB_BANNER_ID_IOS
        source: "AdMob Console -> Ad units"
      - name: VITE_ADMOB_BANNER_ID_ANDROID
        source: "AdMob Console -> Ad units"
  - service: adsense
    why: "AdSense web ad serving on free-tier surfaces"
    env_vars:
      - name: VITE_ADSENSE_PUBLISHER_ID
        source: "AdSense -> Account (ca-pub-XXXX; Phase 52 provisioned, real fill P70)"
---

<objective>
Wire the three coexisting ad-serving modes: install `@capacitor-community/admob`, replace the `initAdNetwork()` stub body with real AdMob test-mode init + banner/interstitial helpers (AD-01), build the consent-gated AdSense script injector (AD-02), and build the `AdRenderer` component that gates on `canShowAds` + freq-cap then dispatches to embed-code / ad-platform / house-ads sub-renderers (AD-04), with PostHog A/B variant selection (AD-07).

Purpose: This is the user-visible ad layer. It consumes the 56-01 guard/registry contract verbatim and serves real (test-mode) AdMob on mobile + AdSense on web. Per D-08, real ad FILL and on-device AdMob and live publisher IDs are Phase 70 — this plan ships the serving code in test/placeholder mode, verifiable via render tests with mocked config (no live ads). The plan carries a human-verify checkpoint for the AdMob package legitimacy gate ([ASSUMED] in RESEARCH audit).
Output: package.json install + ads.ts real body + adsense.ts + AdRenderer + 3 sub-renderers + tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/56-ad-network/56-RESEARCH.md
@.planning/phases/56-ad-network/56-01-SUMMARY.md
@leanshot/src/lib/native/ads.ts

<interfaces>
<!-- Verified from codebase. Consume 56-01 exports verbatim (see 56-01-SUMMARY.md). -->

From leanshot/src/lib/native/ads.ts (CURRENT — KEEP these, replace only the initAdNetwork body):
```
import { assertNoHealthData } from './healthAssert';
export type AdPlacement = 'marketing-sidebar' | 'free-tier-banner' | 'interstitial';  // reuse + extend, do not delete
// initAdNetwork() stub currently throws. Replace body; KEEP the assertNoHealthData({}, 'initAdNetwork') call.
```

From leanshot/src/lib/native/platform.ts:
```
export function detectPlatform(): 'web' | 'ios' | 'android' | 'capacitor-web';
```

From leanshot/src/lib/ads/canShowAds.ts (56-01): canShowAds(surface, tier), AdSurface.
From leanshot/src/lib/ads/freqCap.ts (56-01): canShowNextImpression(placementId, ceiling).
From leanshot/src/lib/ads/placementRegistry.ts (56-01): AdPlacementConfig, AdServingMode ('embed-code'|'ad-platform'|'house-ads'), fetchPlacements().

Tier from Zustand: useStore((s) => s.tier) — see src/components/billing/TierGate.tsx for the read pattern.
Consent event (consent-config.ts): window event 'leanshot:consent-change' with detail.categories.marketing boolean. AdSense URL: https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js.

@capacitor-community/admob v8.0.0 API ([VERIFIED: npm]):
AdMob.initialize({ requestTrackingAuthorization, testingDevices, initializeForTesting }),
AdMob.showBanner({ adId, adSize:'BANNER', position, margin, isTesting }),
AdMob.prepareInterstitial({ adId, isTesting }) + AdMob.showInterstitial().

A/B (AD-07): read PostHog flag for the placement (existing posthog client in src/lib/) to pick ab_variant; default to the config's network when no flag.

ESLint firewall: src/lib/ads/ and src/components/ads/ are FORBIDDEN_IMPORTERS — these files MUST NOT import native/health. Keep all health-boundary checks via assertNoHealthData from native/healthAssert only.
</interfaces>
</context>

<tasks>

<task type="checkpoint:human-verify" gate="blocking-human">
  <name>Task 0: Package legitimacy gate — @capacitor-community/admob</name>
  <action>BLOCKING human verification before npm install. Do NOT install the package until the human approves. Present the verification steps below, wait for "approved".</action>
  <what-built>Pre-install legitimacy gate for @capacitor-community/admob v8.0.0. RESEARCH Package Legitimacy Audit tags it [ASSUMED] (slopcheck unavailable). Per the planner package-legitimacy gate, [ASSUMED] packages require a blocking human verification before install.</what-built>
  <how-to-verify>
    1. Visit https://www.npmjs.com/package/@capacitor-community/admob — confirm: published under the capacitor-community org, ~5yr history, v8.0.0 recent, MIT license, no suspicious postinstall script.
    2. Confirm source repo github.com/capacitor-community/admob is the linked official community plugin.
    3. Run `cd leanshot && npm view @capacitor-community/admob version peerDependencies` — confirm v8.x and peer @capacitor/core ^8.0.0 (matches project ^8.3.4).
  </how-to-verify>
  <resume-signal>Type "approved" to authorize the npm install, or describe the concern.</resume-signal>
</task>

<task type="auto">
  <name>Task 1: Install AdMob plugin + real ads.ts serving (AD-01)</name>
  <files>leanshot/package.json, leanshot/package-lock.json, leanshot/src/lib/native/ads.ts</files>
  <action>Install with: cd leanshot && npm install --legacy-peer-deps @capacitor-community/admob@^8.0.0 (the --legacy-peer-deps flag avoids the @sentry/capacitor peer conflict — Pitfall 3; vercel.json installCommand already includes it). Then run npx cap sync (cap sync only, per pinned facts — no native project edits). In src/lib/native/ads.ts: KEEP the assertNoHealthData import and KEEP the existing AdPlacement type (extend the union with any new placement ids needed). Replace the initAdNetwork() body with a real async implementation: call assertNoHealthData({}, 'initAdNetwork') first, then AdMob.initialize({ requestTrackingAuthorization: true, testingDevices: [], initializeForTesting: true }). Add showBannerAd(adUnitId) and showInterstitialAd(adUnitId) — each calls assertNoHealthData({ adUnitId }, ctx) before the SDK call, and passes isTesting: true (real IDs + isTesting:false arrive P70). Read ad unit IDs from import.meta.env.VITE_ADMOB_* (never hardcode app IDs — anti-pattern). Do NOT import native/health (firewall).</action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && grep -q "@capacitor-community/admob" leanshot/package.json && grep -q "assertNoHealthData" leanshot/src/lib/native/ads.ts && grep -q "initializeForTesting" leanshot/src/lib/native/ads.ts && cd leanshot && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -i "ads.ts" || echo "tsc-clean-for-ads"</automated>
  </verify>
  <done>Plugin in package.json + lockfile; initAdNetwork does real AdMob test-mode init with assertNoHealthData preserved; banner/interstitial helpers guard via assertNoHealthData; no hardcoded app IDs; no native/health import; tsc clean for ads.ts.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Consent-gated AdSense injector (AD-02)</name>
  <files>leanshot/src/lib/ads/adsense.ts, leanshot/src/lib/ads/adsense.test.ts</files>
  <behavior>
    - injectAdSenseScript(publisherId) appends a single script#adsense-script to document.head with src pagead2.googlesyndication.com and data-ad-client set; calling twice is idempotent (no duplicate script).
    - When publisherId is empty/undefined, injectAdSenseScript does NOT inject (caller renders a placeholder div instead — slot ids pending P70).
    - A consent helper subscribes to 'leanshot:consent-change' and only injects when detail.categories.marketing === true.
  </behavior>
  <action>Create src/lib/ads/adsense.ts exporting injectAdSenseScript(publisherId: string): void (idempotent guard on document.getElementById('adsense-script'); no-op when publisherId falsy) and a consent subscriber that injects on 'leanshot:consent-change' when marketing consent is granted. The script URL is https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js (CSP allows it via 56-04 middleware augmentation). MUST NOT import native/health. Write the test (RED) using jsdom: idempotency, no-inject on empty publisherId, inject-on-marketing-consent-event.</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/lib/ads/adsense.test.ts --config vite.config.ts</automated>
  </verify>
  <done>AdSense injector idempotent, consent-gated, no-injects on empty publisher id; tests green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: AdRenderer + 3 mode sub-renderers (AD-04, AD-07)</name>
  <files>leanshot/src/components/ads/AdRenderer.tsx, leanshot/src/components/ads/EmbedAdSlot.tsx, leanshot/src/components/ads/PlatformAdSlot.tsx, leanshot/src/components/ads/HouseAdSlot.tsx, leanshot/src/components/ads/AdRenderer.test.tsx</files>
  <behavior>
    - AdRenderer({surface, placement}) renders null when canShowAds(surface, tier) === false (paid tier OR excluded surface) — proven by a test rendering on surface='clinic' and tier='paid'.
    - When canShowAds true but freq-cap exhausted (canShowNextImpression false), renders null.
    - When eligible, dispatches by placement.mode: 'embed-code'→EmbedAdSlot (sandboxed iframe of placement.embed_html), 'ad-platform'→PlatformAdSlot (AdSense slot on web via detectPlatform / AdMob handled imperatively on native), 'house-ads'→HouseAdSlot (self-promo by placement.house_ad_slug).
    - PlatformAdSlot renders a placeholder div when the AdSense slot/publisher env var is empty (real fill P70).
    - A/B: AdRenderer resolves placement.ab_variant via PostHog flag when set, falling back to placement.network.
  </behavior>
  <action>Create the AdRenderer dispatch component and 3 sub-renderers under src/components/ads/. AdRenderer reads tier from useStore((s) => s.tier), calls canShowAds(surface, tier) FIRST (return null if false — single entry-point gate, sub-components must NOT re-read tier per anti-pattern), then canShowNextImpression(placement.placement_id, placement.freq_cap_per_session) (return null if false), then dispatches on placement.mode to the sub-renderer. EmbedAdSlot renders placement.embed_html inside a sandboxed iframe. PlatformAdSlot branches on detectPlatform(): web → AdSense slot element (placeholder div when VITE_ADSENSE_PUBLISHER_ID empty); native → trigger imperative AdMob banner via ads.ts (guard with isTesting). HouseAdSlot renders cross-promo from placement.house_ad_slug. Resolve A/B via the existing PostHog client (src/lib/ — grep for the posthog export) using placement.ab_variant; default to placement.network. None of these files may import native/health. Write AdRenderer.test.tsx (RED) covering the gate-false cases (clinic surface, paid tier, freq-cap exhausted → null) and the 3-mode dispatch with mocked AdPlacementConfig.</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/components/ads/AdRenderer.test.tsx --config vite.config.ts && bash scripts/check-no-health-in-ad-context.sh src</automated>
  </verify>
  <done>AdRenderer gates on canShowAds + freq-cap, dispatches all 3 modes, renders placeholder when slot empty, resolves A/B variant; render tests green; Phase 55 firewall grep still green with new ad component files present.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| ad SDK ← targeting params | any user-data object must pass assertNoHealthData before the SDK call |
| embed_html → iframe | advertiser snippet is untrusted markup |
| package install → build | new npm dependency (supply chain) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-56-08 | Information Disclosure | ads.ts SDK calls | mitigate | assertNoHealthData on every targeting object before AdMob/AdSense call; preserved at every entry point |
| T-56-09 | Tampering | EmbedAdSlot embed_html | mitigate | render advertiser snippet inside a sandboxed iframe (sandbox attribute), not inline DOM |
| T-56-10 | Elevation of Privilege | AdRenderer gate | mitigate | canShowAds is the single gate; sub-renderers trust parent decision, never re-read tier |
| T-56-SC | Tampering | npm @capacitor-community/admob install | mitigate | blocking human legitimacy checkpoint (Task 0) before install; --legacy-peer-deps; no postinstall script confirmed |
</threat_model>

<verification>
- Task verify commands above (vitest renderer/injector specs + firewall grep).
- `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` — no new type errors.
- `cd leanshot && bash scripts/check-no-health-in-ad-context.sh src` — Layer 3 still green with new ad files.
- Real on-device AdMob fill + live AdSense fill → Phase 70 (D-08; not verified here).
</verification>

<success_criteria>
AdMob plugin installed; initAdNetwork does real test-mode init with the firewall guard intact; AdSense injects consent-gated; AdRenderer enforces canShowAds + freq-cap and serves all 3 modes (embed/platform/house) with placeholders where live IDs are pending — all proven by render tests with mocked config and the firewall grep green.
</success_criteria>

<output>
Create `.planning/phases/56-ad-network/56-03-SUMMARY.md` when done. Record the final AdPlacement union, the AdRenderer prop signature, and the env var names so the surface-exclusion CI grep (56-06) targets the right import symbols. Note npm install + cap sync status for the CARRY-OVER push/install matrix.
</output>
