// Phase 56 Plan 03 — Real AdMob ad-serving bridge (AD-01).
// Replaces the Phase 12 D-01 throw-stub with real test-mode AdMob init and
// banner/interstitial helpers.
//
// FIREWALL: This file MUST NEVER import from ./health — enforced by ESLint
// import-x/no-restricted-paths (Phase 12 D-02 Zone 1). Use assertNoHealthData
// from ./healthAssert at every ad-parameter entry point (T-56-08).
import type { BannerAdOptions} from '@capacitor-community/admob';
import { AdMob, BannerAdSize, BannerAdPosition } from '@capacitor-community/admob';
import { assertNoHealthData } from './healthAssert';

export type AdPlacement = 'marketing-sidebar' | 'free-tier-banner' | 'interstitial';

/**
 * Initialise the AdMob SDK in test mode.
 *
 * MUST call assertNoHealthData first (T-56-08 — no PHI in ad-init path).
 * Real app IDs and isTesting:false arrive in Phase 70 (D-08).
 * VITE_ADMOB_APP_ID_IOS / _ANDROID are set in .env.local; absent in test env.
 */
export async function initAdNetwork(): Promise<void> {
  // Layer 2 firewall guard: no health-shaped fields may reach the SDK init.
  assertNoHealthData({}, 'initAdNetwork');

  await AdMob.initialize({
    testingDevices: [],
    initializeForTesting: true,
  });
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
