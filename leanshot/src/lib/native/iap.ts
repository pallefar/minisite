// Phase 12 D-01 stub — in-app purchase bridge (RevenueCat). Real implementation lands in Phase 16 (MONEY-06).
// DO NOT import from ./health — enforced by import-x/no-restricted-paths in eslint.config.js.

export type IapProvider = 'apple' | 'google';

export function purchaseSubscription(_productId: string): never {
  throw new Error('Phase 12 stub — implemented by Phase 16 via RevenueCat');
}
