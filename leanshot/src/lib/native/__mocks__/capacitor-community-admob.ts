// Phase 70 — mock for @capacitor-community/admob (AdMob boot-wiring tests).
// Aliased in vitest-mobile.config.ts; mirrors the revenuecat-purchases-capacitor
// + capacitor-core mock convention. vi.resetModules() in tests re-evaluates this
// file, yielding fresh vi.fn()s with zeroed call counts per test.
import { vi } from 'vitest';

export const AdMob = {
  initialize: vi.fn(async () => undefined),
  showBanner: vi.fn(async () => undefined),
  prepareInterstitial: vi.fn(async () => undefined),
  showInterstitial: vi.fn(async () => undefined),
};

export const BannerAdSize = { ADAPTIVE_BANNER: 'ADAPTIVE_BANNER' } as const;
export const BannerAdPosition = { BOTTOM_CENTER: 'BOTTOM_CENTER' } as const;

export const __mock = {
  reset() {
    AdMob.initialize.mockReset().mockImplementation(async () => undefined);
    AdMob.showBanner.mockReset().mockImplementation(async () => undefined);
    AdMob.prepareInterstitial.mockReset().mockImplementation(async () => undefined);
    AdMob.showInterstitial.mockReset().mockImplementation(async () => undefined);
  },
};
