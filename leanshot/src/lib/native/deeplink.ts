// Phase 12 D-01 stub — deep-link bridge. Real implementation lands in Phase 16 (MOBILE-06).
// DO NOT import from ./health — enforced by import-x/no-restricted-paths in eslint.config.js.

export type DeepLinkRoute = 'share' | 'affiliate' | 'app';

export function handleDeepLink(_url: string): never {
  throw new Error('Phase 12 stub — implemented by Phase 16 via Universal Links + App Links');
}
