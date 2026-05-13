// Phase 12 D-01 stub — platform detection bridge.
// Returns 'web' for all Phase 12-15 builds; Capacitor-aware detection lands in Phase 16.
// DO NOT import from ./health — enforced by import-x/no-restricted-paths in eslint.config.js.

export type Platform = 'web' | 'ios' | 'android' | 'capacitor-web';

export function detectPlatform(): Platform {
  return 'web';
}
