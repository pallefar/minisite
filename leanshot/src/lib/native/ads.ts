// Phase 56 Plan 03 — Real AdMob ad-serving bridge (AD-01).
// Replaces the Phase 12 D-01 throw-stub with real test-mode AdMob init and
// banner/interstitial helpers.
//
// FIREWALL: This file MUST NEVER import from ./health — enforced by ESLint
// import-x/no-restricted-paths (Phase 12 D-02 Zone 1). Use assertNoHealthData
// from ./healthAssert at every ad-parameter entry point (T-56-08).
import type { BannerAdOptions } from '@capacitor-community/admob';
import { AdMob, BannerAdSize, BannerAdPosition } from '@capacitor-community/admob';
import { assertNoHealthData } from './healthAssert';
import { detectPlatform } from './platform';

export type AdPlacement = 'marketing-sidebar' | 'free-tier-banner' | 'interstitial';

// Module-level idempotency guard. The boot-wiring (App.tsx mount effect) can
// fire more than once under React StrictMode / fast-refresh; the AdMob SDK must
// be initialised at most once. Mirrors iap.ts's `_configured` flag.
let _adNetworkInitialized = false;

/**
 * Initialise the AdMob SDK once at app boot.
 *
 * Gating mirrors `configureRC` in ./iap (the RevenueCat key pattern):
 *   - Native-only — web / capacitor-web are a silent no-op. The AdMob plugin is
 *     an iOS/Android native binding; the web ad path is AdSense (PlatformAdSlot).
 *   - Env-gated — only initialises when a real app ID is configured
 *     (`VITE_ADMOB_APP_ID_IOS` / `_ANDROID`). Until those land (Phase 70 D-08)
 *     this is a silent no-op rather than spinning up a test-mode SDK with no
 *     inventory. Unlike configureRC it does NOT throw on a missing ID — ads are
 *     non-critical, so absence is a benign skip.
 *   - Idempotent — repeat calls after a successful init are no-ops.
 *
 * MUST call assertNoHealthData first (T-56-08 — no PHI in ad-init path).
 * Real app IDs and isTesting:false arrive in Phase 70 (D-08).
 */
export async function initAdNetwork(): Promise<void> {
  // Layer 2 firewall guard: no health-shaped fields may reach the SDK init.
  assertNoHealthData({}, 'initAdNetwork');

  // Native-platform gate — mirror configureRC's ios|android short-circuit.
  const platform = detectPlatform();
  if (platform !== 'ios' && platform !== 'android') return;

  // Idempotent — never re-initialise an already-configured SDK.
  if (_adNetworkInitialized) return;

  // Env-gated no-op until real app IDs land (Phase 70 D-08).
  const appId =
    platform === 'ios'
      ? import.meta.env.VITE_ADMOB_APP_ID_IOS
      : import.meta.env.VITE_ADMOB_APP_ID_ANDROID;
  if (!appId) return;

  await AdMob.initialize({
    testingDevices: [],
    initializeForTesting: true,
  });
  _adNetworkInitialized = true;
}

/**
 * Show an AdMob banner ad in test mode.
 *
 * @param adUnitId - Read from import.meta.env.VITE_ADMOB_BANNER_ID_IOS or
 *   VITE_ADMOB_BANNER_ID_ANDROID. Never hardcoded.
 */
export async function showBannerAd(adUnitId: string): Promise<void> {
  assertNoHealthData({ adUnitId }, 'showBannerAd');

  const options: BannerAdOptions = {
    adId: adUnitId,
    adSize: BannerAdSize.ADAPTIVE_BANNER,
    position: BannerAdPosition.BOTTOM_CENTER,
    margin: 0,
    isTesting: true,
  };

  await AdMob.showBanner(options);
}

/**
 * Prepare and show an interstitial ad in test mode.
 *
 * @param adUnitId - Read from import.meta.env.VITE_ADMOB_* env vars. Never hardcoded.
 */
export async function showInterstitialAd(adUnitId: string): Promise<void> {
  assertNoHealthData({ adUnitId }, 'showInterstitialAd');

  await AdMob.prepareInterstitial({ adId: adUnitId, isTesting: true });
  await AdMob.showInterstitial();
}
