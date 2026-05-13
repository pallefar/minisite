// Phase 12 D-01/D-02 stub — ad transport tunnel. Real implementation lands in Phase 20 (AD-01..12).
// This file MUST NEVER import from ./health — the firewall enforces statically.

export type AdPlacement = 'marketing-sidebar' | 'free-tier-banner' | 'interstitial';

export function initAdNetwork(): never {
  throw new Error('Phase 12 stub — implemented by Phase 20 via @capacitor-community/admob + GPT');
}
