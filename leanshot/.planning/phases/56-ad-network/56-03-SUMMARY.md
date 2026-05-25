---
phase: 56-ad-network
plan: "03"
subsystem: ad-serving
tags: [admob, adsense, ad-renderer, freq-cap, firewall, capacitor]
dependency_graph:
  requires: [56-01]
  provides: [AdRenderer, injectAdSenseScript, initAdNetwork, showBannerAd, showInterstitialAd]
  affects: [56-04, 56-05, 56-06]
tech_stack:
  added: ["@capacitor-community/admob@^8.0.0"]
  patterns: [3-mode-ad-dispatch, consent-gated-injector, sandboxed-iframe, session-freq-cap]
key_files:
  created:
    - leanshot/src/lib/native/ads.ts
    - leanshot/src/lib/ads/adsense.ts
    - leanshot/src/lib/ads/adsense.test.ts
    - leanshot/src/components/ads/AdRenderer.tsx
    - leanshot/src/components/ads/AdRenderer.test.tsx
    - leanshot/src/components/ads/EmbedAdSlot.tsx
    - leanshot/src/components/ads/PlatformAdSlot.tsx
    - leanshot/src/components/ads/HouseAdSlot.tsx
    - leanshot/scripts/check-no-health-in-ad-context.sh
  modified:
    - leanshot/package.json
    - leanshot/package-lock.json
decisions:
  - "AdMob initialized in test mode only (initializeForTesting:true); real IDs + isTesting:false deferred to Phase 70 D-08"
  - "PlatformAdSlot renders placeholder div when VITE_ADSENSE_PUBLISHER_ID is empty — real fill Phase 70"
  - "A/B variant resolved via window.posthog.getFeatureFlag (posthog loaded dynamically; null fallback uses placement.network)"
  - "EmbedAdSlot uses sandbox='allow-same-origin' (no allow-scripts) — T-56-09 XSS mitigation"
  - "healthAssert.ts + 56-01 canShowAds/freqCap/placementRegistry copied from main to worktree (56-01 landed on main, not this worktree branch)"
metrics:
  completed: "2026-05-25"
  tasks_completed: 3
  files_created: 9
  files_modified: 2
  tests_added: 15
---

# Phase 56 Plan 03: Ad Serving — AdMob init + AdSense injector + AdRenderer 3-mode dispatch

Real AdMob test-mode init via @capacitor-community/admob + consent-gated AdSense injector + AdRenderer dispatching embed-code/ad-platform/house-ads with canShowAds gate and session freq-cap.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install AdMob + real ads.ts (AD-01) | 48fe01a2 | package.json, package-lock.json, ads.ts, healthAssert.ts, canShowAds.ts, freqCap.ts, placementRegistry.ts |
| 2 | Consent-gated AdSense injector (AD-02) | d518263e | adsense.ts, adsense.test.ts |
| 3 | AdRenderer 3-mode dispatch + sub-renderers (AD-04, AD-07) | b191bef7 | AdRenderer.tsx, EmbedAdSlot.tsx, PlatformAdSlot.tsx, HouseAdSlot.tsx, AdRenderer.test.tsx, check-no-health-in-ad-context.sh |

## Final API Surface

### AdPlacement type (ads.ts)
```ts
export type AdPlacement = 'marketing-sidebar' | 'free-tier-banner' | 'interstitial';
```

### AdRenderer props (AdRenderer.tsx)
```ts
export interface AdRendererProps {
  surface: AdSurface;        // from canShowAds.ts
  placement: AdPlacementConfig; // from placementRegistry.ts
}
```

### Env var names (for 56-06 CI grep targeting)
- `VITE_ADMOB_APP_ID_IOS`
- `VITE_ADMOB_APP_ID_ANDROID`
- `VITE_ADMOB_BANNER_ID_IOS`
- `VITE_ADMOB_BANNER_ID_ANDROID`
- `VITE_ADSENSE_PUBLISHER_ID`

### Key import symbols (for 56-06 surface-exclusion grep)
- `AdRenderer` — `src/components/ads/AdRenderer.tsx`
- `canShowAds` — `src/lib/ads/canShowAds.ts`
- `injectAdSenseScript` — `src/lib/ads/adsense.ts`
- `initAdNetwork`, `showBannerAd`, `showInterstitialAd` — `src/lib/native/ads.ts`

## npm install + cap sync status
- `@capacitor-community/admob@^8.0.0` added to package.json + package-lock.json (--legacy-peer-deps)
- `npx cap sync` not run — no native iOS/Android project in this worktree. Run at merge time on main.

## Tests
- adsense.test.ts: 8 tests pass (idempotency, empty-publisherId no-inject, consent-gate, cleanup)
- AdRenderer.test.tsx: 7 tests pass (excluded surface, disabled placement, freq-cap exhaust, 3-mode dispatch)
- Total: 15 new tests green

## Firewall Status
- `bash scripts/check-no-health-in-ad-context.sh src` — PASS (no native/health imports in src/lib/ads/ or src/components/ads/)
- assertNoHealthData called in initAdNetwork, showBannerAd, showInterstitialAd (T-56-08)
- EmbedAdSlot renders in sandboxed iframe (T-56-09)
- AdRenderer is single canShowAds gate; sub-renderers do not re-read tier (T-56-10)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 56-01 files not present in worktree branch**
- **Found during:** Task 1 setup
- **Issue:** canShowAds.ts, freqCap.ts, placementRegistry.ts exist on main branch (56-01 completed) but not on this worktree branch (worktree-agent-acae2e145144a6b7a was created before 56-01 merged)
- **Fix:** Copied files from main checkout (/Users/karstenhaldan/minisite/leanshot/src/lib/ads/) into worktree. Same fix applied for healthAssert.ts (55-01).
- **Files modified:** leanshot/src/lib/ads/canShowAds.ts, freqCap.ts, placementRegistry.ts, leanshot/src/lib/native/healthAssert.ts

**2. [Rule 2 - Missing critical] firewall script missing**
- **Found during:** Task 3 verify
- **Issue:** Plan references `bash scripts/check-no-health-in-ad-context.sh` in verification but script did not exist
- **Fix:** Created scripts/check-no-health-in-ad-context.sh (Layer 3 CI grep gate per HEALTH-08)
- **Commit:** b191bef7

## Known Stubs
- `PlatformAdSlot`: renders placeholder div labeled "Ad slot — coming soon" when `VITE_ADSENSE_PUBLISHER_ID` is empty. Intentional — real fill wired in Phase 70 (D-08).
- `HouseAdSlot`: unknown slugs render "LeanShot — coming soon". Intentional — CMS/copy wired later.
- `initAdNetwork`: `initializeForTesting: true` always. Real mode (false) arrives Phase 70.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| No new threats | — | All surfaces covered by existing T-56-08/09/10 in plan threat model |

## Self-Check: PASSED
- leanshot/src/lib/native/ads.ts — FOUND
- leanshot/src/lib/ads/adsense.ts — FOUND
- leanshot/src/lib/ads/adsense.test.ts — FOUND
- leanshot/src/components/ads/AdRenderer.tsx — FOUND
- leanshot/src/components/ads/AdRenderer.test.tsx — FOUND
- leanshot/src/components/ads/EmbedAdSlot.tsx — FOUND
- leanshot/src/components/ads/PlatformAdSlot.tsx — FOUND
- leanshot/src/components/ads/HouseAdSlot.tsx — FOUND
- leanshot/scripts/check-no-health-in-ad-context.sh — FOUND
- Commits 48fe01a2, d518263e, b191bef7 — verified in git log
