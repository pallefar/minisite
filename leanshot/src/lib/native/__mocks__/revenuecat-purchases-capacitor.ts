import { vi } from 'vitest';

export const Purchases = {
  configure: vi.fn(async () => undefined),
  getOfferings: vi.fn(async () => ({ current: null })),
  purchasePackage: vi.fn(async () => ({
    customerInfo: { entitlements: { active: {} } },
  })),
  restorePurchases: vi.fn(async () => ({
    customerInfo: { entitlements: { active: {} } },
  })),
  logIn: vi.fn(async (_args: { appUserID: string }) => ({
    customerInfo: { entitlements: { active: {} } },
    created: false,
  })),
  checkTrialOrIntroductoryPriceEligibility: vi.fn(async () => ({})),
};

// Grouped enum object — matches the real @revenuecat/purchases-capacitor v13
// export shape (no flat sibling constants are exported from the SDK).
export const INTRO_ELIGIBILITY_STATUS = {
  INTRO_ELIGIBILITY_STATUS_UNKNOWN: 0,
  INTRO_ELIGIBILITY_STATUS_INELIGIBLE: 1,
  INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 2,
  INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS: 3,
};

export const __mock = {
  reset() {
    Purchases.configure.mockReset().mockImplementation(async () => undefined);
    Purchases.getOfferings.mockReset().mockImplementation(async () => ({ current: null }));
    Purchases.purchasePackage.mockReset().mockImplementation(async () => ({
      customerInfo: { entitlements: { active: {} } },
    }));
    Purchases.restorePurchases.mockReset().mockImplementation(async () => ({
      customerInfo: { entitlements: { active: {} } },
    }));
    Purchases.logIn.mockReset().mockImplementation(async (_args: { appUserID: string }) => ({
      customerInfo: { entitlements: { active: {} } },
      created: false,
    }));
    Purchases.checkTrialOrIntroductoryPriceEligibility
      .mockReset()
      .mockImplementation(async () => ({}));
  },
};
