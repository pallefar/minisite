import { vi } from 'vitest';

export const Purchases = {
  configure: vi.fn(async () => undefined),
  getOfferings: vi.fn(async () => ({ current: null })),
  purchasePackage: vi.fn(async () => ({
    customerInfo: { entitlements: { active: {} } },
  })),
  checkTrialOrIntroductoryPriceEligibility: vi.fn(async () => ({})),
};

export const INTRO_ELIGIBILITY_STATUS = {
  INTRO_ELIGIBILITY_STATUS_UNKNOWN: 0,
  INTRO_ELIGIBILITY_STATUS_INELIGIBLE: 1,
  INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 2,
  INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS: 3,
};

export const __mock = {
  reset() {
    Purchases.configure.mockImplementation(async () => undefined);
    Purchases.getOfferings.mockImplementation(async () => ({ current: null }));
    Purchases.purchasePackage.mockImplementation(async () => ({
      customerInfo: { entitlements: { active: {} } },
    }));
    Purchases.checkTrialOrIntroductoryPriceEligibility.mockImplementation(async () => ({}));
  },
};
