// Phase 16 Plan 16-02 fill — platform detection bridge (MOBILE-03).
// Source: RESEARCH Pattern 1 (capacitorjs.com/docs/v8/apis/core).
//
// Replaces the Phase 12 D-01 throw-stub. The `Platform` type union is
// preserved byte-identical — every downstream platform fork (16-05 IAP,
// 16-06 webhook tier flip, every detectPlatform() === 'ios|android' branch)
// depends on it.
//
// Firewall: this file is the SOLE legitimate `@capacitor/core` import site
// in `src/lib/native/*`. Other native bridge files MUST import `detectPlatform`
// from here, not import `Capacitor` directly. This is asserted in the Task 1
// `done` criteria of Plan 16-02 via grep.
//
// DO NOT import from ./health — enforced by import-x/no-restricted-paths in
// eslint.config.js (Phase 12 two-tunnel firewall, D-02 Zone 1).
import { Capacitor } from '@capacitor/core';

export type Platform = 'web' | 'ios' | 'android' | 'capacitor-web';

export function detectPlatform(): Platform {
  const p = Capacitor.getPlatform();
  if (p === 'ios') return 'ios';
  if (p === 'android') return 'android';
  return Capacitor.isNativePlatform() ? 'capacitor-web' : 'web';
}
