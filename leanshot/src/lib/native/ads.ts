// Phase 12 D-01/D-02 stub — ad transport tunnel. Real implementation lands in Phase 20 (AD-01..12).
// This file MUST NEVER import from ./health — the firewall enforces statically (Layer 1 + Layer 3).
//
// HEALTH-08 Layer 2 (CR-01): assertNoHealthData is the REAL ad-boundary runtime guard.
// Phase 20 MUST call assertNoHealthData(targetingParams, 'buildAdParams') on any user-data
// object before passing it to the ad network SDK. This prevents health-shaped PHI from
// reaching ad targeting even if Layers 1/3 were somehow bypassed (e.g. dynamic import).
// Import assertNoHealthData from './healthAssert' — NOT from './health' (that would break
// the firewall).

import { assertNoHealthData } from './healthAssert';

export type AdPlacement = 'marketing-sidebar' | 'free-tier-banner' | 'interstitial';

/**
 * Phase 20 ad network initialisation stub.
 * Phase 20 must wire real implementation here.
 *
 * HEALTH-08 Layer 2 guard: any targeting params object MUST be passed through
 * assertNoHealthData() before it reaches the ad SDK:
 *   assertNoHealthData(targetingParams, 'initAdNetwork');
 *
 * The call below demonstrates the guard on the stub params object so the
 * CI can verify the guard is in place at the ad-surface entry point.
 */
export function initAdNetwork(): never {
  // Demonstrate the ad-boundary guard: any targeting data must pass through here.
  // Phase 20: replace {} with the real targeting params object before SDK call.
  assertNoHealthData({}, 'initAdNetwork');
  throw new Error('Phase 12 stub — implemented by Phase 20 via @capacitor-community/admob + GPT');
}
