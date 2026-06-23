// Phase 16 Plan 16-05 Task 1 — unit tests for the RevenueCat IAP bridge.
//
// Runs under `vitest-mobile.config.ts` which aliases:
//   - `@revenuecat/purchases-capacitor` → __mocks__/revenuecat-purchases-capacitor.ts
//   - `@capacitor/core` → __mocks__/capacitor-core.ts (consumed via ./platform)
//
// Idempotency, platform short-circuit, trial eligibility and user-cancel
// handling are all exercised here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('iap.ts — RevenueCat bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_RC_API_KEY_IOS', 'iostest');
    vi.stubEnv('VITE_RC_API_KEY_ANDROID', 'androidtest');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ─── configureRC ────────────────────────────────────────────────────────────

  it('configureRC on web → Purchases.configure NEVER called', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('web');
    Capacitor.isNativePlatform.mockReturnValue(false);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    const { configureRC } = await import('./iap');
    await configureRC('u1');
    expect(Purchases.configure).not.toHaveBeenCalled();
  });

  it('configureRC on ios → Purchases.configure called once with ios key', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    const { configureRC } = await import('./iap');
    await configureRC('u1');
    expect(Purchases.configure).toHaveBeenCalledTimes(1);
    expect(Purchases.configure).toHaveBeenCalledWith({
      apiKey: 'iostest',
      appUserID: 'u1',
    });
  });

  it('configureRC on android → Purchases.configure called once with android key', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('android');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    const { configureRC } = await import('./iap');
    await configureRC('u1');
    expect(Purchases.configure).toHaveBeenCalledTimes(1);
    expect(Purchases.configure).toHaveBeenCalledWith({
      apiKey: 'androidtest',
      appUserID: 'u1',
    });
  });

  it('configureRC idempotency — same user twice → Purchases.configure called once', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    const { configureRC } = await import('./iap');
    await configureRC('u1');
    await configureRC('u1');
    expect(Purchases.configure).toHaveBeenCalledTimes(1);
    expect(Purchases.logIn).not.toHaveBeenCalled();
  });

  it('configureRC user-switch — different appUserID → logIn called', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    const { configureRC } = await import('./iap');
    await configureRC('u1');
    await configureRC('u2');
    expect(Purchases.configure).toHaveBeenCalledTimes(1);
    expect(Purchases.logIn).toHaveBeenCalledTimes(1);
    expect(Purchases.logIn).toHaveBeenCalledWith({ appUserID: 'u2' });
  });

  it('configureRC on ios with missing api key → throws RcConfigError', async () => {
    vi.stubEnv('VITE_RC_API_KEY_IOS', '');
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { configureRC, RcConfigError } = await import('./iap');
    await expect(configureRC('u1')).rejects.toBeInstanceOf(RcConfigError);
  });

  it('configureRC concurrent first-callers (same user) → Purchases.configure called once (L2 race guard)', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    const { configureRC } = await import('./iap');
    // Both start before the first configure() resolves → must share one init.
    await Promise.all([configureRC('u1'), configureRC('u1')]);
    expect(Purchases.configure).toHaveBeenCalledTimes(1);
  });

  // ─── getOfferings ───────────────────────────────────────────────────────────

  it('getOfferings on web → null', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('web');
    Capacitor.isNativePlatform.mockReturnValue(false);
    const { getOfferings } = await import('./iap');
    await expect(getOfferings()).resolves.toBeNull();
  });

  it('getOfferings on ios with current offering → maps monthly + annual', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    Purchases.getOfferings.mockResolvedValue({
      current: {
        identifier: 'default',
        monthly: {
          identifier: '$rc_monthly',
          product: {
            identifier: 'app.leanshot.plus.monthly',
            priceString: '$12.99',
          },
        },
        annual: {
          identifier: '$rc_annual',
          product: {
            identifier: 'app.leanshot.plus.yearly',
            priceString: '$132.49',
          },
        },
      },
    });
    const { getOfferings } = await import('./iap');
    const offering = await getOfferings();
    expect(offering).not.toBeNull();
    expect(offering?.identifier).toBe('default');
    expect(offering?.monthlyPackage?.productIdentifier).toBe('app.leanshot.plus.monthly');
    expect(offering?.monthlyPackage?.priceString).toBe('$12.99');
    expect(offering?.yearlyPackage?.productIdentifier).toBe('app.leanshot.plus.yearly');
    expect(offering?.yearlyPackage?.priceString).toBe('$132.49');
  });

  it('getOfferings on ios with null current → null', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    Purchases.getOfferings.mockResolvedValue({ current: null });
    const { getOfferings } = await import('./iap');
    await expect(getOfferings()).resolves.toBeNull();
  });

  it('getOfferings falls back to availablePackages for custom package ids (L4)', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    // No built-in .monthly/.annual (custom-identifier offering) — must resolve
    // from availablePackages by store product id.
    Purchases.getOfferings.mockResolvedValue({
      current: {
        identifier: 'default',
        monthly: null,
        annual: null,
        availablePackages: [
          {
            identifier: 'custom_m',
            product: { identifier: 'app.leanshot.plus.monthly', priceString: '$12.99' },
          },
          {
            identifier: 'custom_y',
            product: { identifier: 'app.leanshot.plus.yearly', priceString: '$132.49' },
          },
        ],
      },
    });
    const { getOfferings } = await import('./iap');
    const offering = await getOfferings();
    expect(offering?.monthlyPackage?.productIdentifier).toBe('app.leanshot.plus.monthly');
    expect(offering?.yearlyPackage?.priceString).toBe('$132.49');
  });

  // ─── purchaseSubscription ───────────────────────────────────────────────────

  it('purchaseSubscription on ios happy path → cancelled=false + customerInfo', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    const monthlyPkg = {
      identifier: '$rc_monthly',
      product: { identifier: 'app.leanshot.plus.monthly', priceString: '$12.99' },
    };
    Purchases.getOfferings.mockResolvedValue({
      current: { identifier: 'default', monthly: monthlyPkg, annual: null },
    });
    Purchases.purchasePackage.mockResolvedValue({
      customerInfo: { entitlements: { active: { plus: { isActive: true } } } },
    });
    const { purchaseSubscription } = await import('./iap');
    const result = await purchaseSubscription('app.leanshot.plus.monthly');
    expect(result.cancelled).toBe(false);
    expect(result.customerInfo.entitlements.active).toHaveProperty('plus');
    expect(Purchases.purchasePackage).toHaveBeenCalledWith({ aPackage: monthlyPkg });
  });

  it('purchaseSubscription on ios with userCancelled → cancelled=true (no throw)', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    Purchases.getOfferings.mockResolvedValue({
      current: {
        identifier: 'default',
        monthly: {
          identifier: '$rc_monthly',
          product: { identifier: 'app.leanshot.plus.monthly', priceString: '$12.99' },
        },
        annual: null,
      },
    });
    const cancelErr = new Error('User cancelled');
    (cancelErr as Error & { userCancelled?: boolean }).userCancelled = true;
    Purchases.purchasePackage.mockRejectedValue(cancelErr);
    const { purchaseSubscription } = await import('./iap');
    const result = await purchaseSubscription('app.leanshot.plus.monthly');
    expect(result.cancelled).toBe(true);
  });

  it('purchaseSubscription on ios with non-cancel error → throws', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    Purchases.getOfferings.mockResolvedValue({
      current: {
        identifier: 'default',
        monthly: {
          identifier: '$rc_monthly',
          product: { identifier: 'app.leanshot.plus.monthly', priceString: '$12.99' },
        },
        annual: null,
      },
    });
    Purchases.purchasePackage.mockRejectedValue(new Error('network'));
    const { purchaseSubscription } = await import('./iap');
    await expect(purchaseSubscription('app.leanshot.plus.monthly')).rejects.toThrow('network');
  });

  it('purchaseSubscription on web → throws "not available on web"', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('web');
    Capacitor.isNativePlatform.mockReturnValue(false);
    const { purchaseSubscription } = await import('./iap');
    await expect(purchaseSubscription('app.leanshot.plus.monthly')).rejects.toThrow(
      /not available on web/i,
    );
  });

  it('purchaseSubscription with no matching package → throws', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    Purchases.getOfferings.mockResolvedValue({ current: null });
    const { purchaseSubscription } = await import('./iap');
    await expect(purchaseSubscription('app.leanshot.plus.monthly')).rejects.toThrow(
      /no matching package/i,
    );
  });

  // ─── restorePurchases ───────────────────────────────────────────────────────

  it('restorePurchases on web → no-op (SDK not called)', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('web');
    Capacitor.isNativePlatform.mockReturnValue(false);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    const { restorePurchases } = await import('./iap');
    await restorePurchases();
    expect(Purchases.restorePurchases).not.toHaveBeenCalled();
  });

  it('restorePurchases on ios → SDK called', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    const { restorePurchases } = await import('./iap');
    await restorePurchases();
    expect(Purchases.restorePurchases).toHaveBeenCalledTimes(1);
  });

  it('restorePurchases on ios → returns customerInfo entitlements (M3)', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    Purchases.restorePurchases.mockResolvedValue({
      customerInfo: { entitlements: { active: { plus: { isActive: true } } } },
    });
    const { restorePurchases } = await import('./iap');
    const info = await restorePurchases();
    expect(info?.entitlements.active).toHaveProperty('plus');
  });

  it('restorePurchases on web → returns null', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('web');
    Capacitor.isNativePlatform.mockReturnValue(false);
    const { restorePurchases } = await import('./iap');
    await expect(restorePurchases()).resolves.toBeNull();
  });

  // ─── logOutRC (L1) ────────────────────────────────────────────────────────────

  it('logOutRC on ios after configure → Purchases.logOut called + state reset', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    const { configureRC, logOutRC } = await import('./iap');
    await configureRC('u1');
    await logOutRC();
    expect(Purchases.logOut).toHaveBeenCalledTimes(1);
    // State reset → next configure re-binds the SDK (configure called a 2nd time).
    await configureRC('u2');
    expect(Purchases.configure).toHaveBeenCalledTimes(2);
  });

  it('logOutRC on web → Purchases.logOut NOT called', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('web');
    Capacitor.isNativePlatform.mockReturnValue(false);
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    const { logOutRC } = await import('./iap');
    await logOutRC();
    expect(Purchases.logOut).not.toHaveBeenCalled();
  });

  // ─── checkTrialEligibility ──────────────────────────────────────────────────

  it('checkTrialEligibility on web → both false (conservative)', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('web');
    Capacitor.isNativePlatform.mockReturnValue(false);
    const { checkTrialEligibility } = await import('./iap');
    const r = await checkTrialEligibility();
    expect(r).toEqual({ monthlyEligible: false, yearlyEligible: false });
  });

  it('checkTrialEligibility on ios with both ELIGIBLE → both true', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases, INTRO_ELIGIBILITY_STATUS } = await import('@revenuecat/purchases-capacitor');
    Purchases.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({
      'app.leanshot.plus.monthly': {
        status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE,
      },
      'app.leanshot.plus.yearly': {
        status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE,
      },
    });
    const { checkTrialEligibility } = await import('./iap');
    const r = await checkTrialEligibility();
    expect(r).toEqual({ monthlyEligible: true, yearlyEligible: true });
  });

  it('checkTrialEligibility on ios with monthly INELIGIBLE + yearly ELIGIBLE → asymmetric', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases, INTRO_ELIGIBILITY_STATUS } = await import('@revenuecat/purchases-capacitor');
    Purchases.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({
      'app.leanshot.plus.monthly': {
        status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE,
      },
      'app.leanshot.plus.yearly': {
        status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE,
      },
    });
    const { checkTrialEligibility } = await import('./iap');
    const r = await checkTrialEligibility();
    expect(r).toEqual({ monthlyEligible: false, yearlyEligible: true });
  });

  it('checkTrialEligibility on ios with UNKNOWN → conservative false', async () => {
    const { Capacitor } = await import('@capacitor/core');
    Capacitor.getPlatform.mockReturnValue('ios');
    Capacitor.isNativePlatform.mockReturnValue(true);
    const { Purchases, INTRO_ELIGIBILITY_STATUS } = await import('@revenuecat/purchases-capacitor');
    Purchases.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({
      'app.leanshot.plus.monthly': {
        status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_UNKNOWN,
      },
      'app.leanshot.plus.yearly': {
        status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_UNKNOWN,
      },
    });
    const { checkTrialEligibility } = await import('./iap');
    const r = await checkTrialEligibility();
    expect(r).toEqual({ monthlyEligible: false, yearlyEligible: false });
  });
});
