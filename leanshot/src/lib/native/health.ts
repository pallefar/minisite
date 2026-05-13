// Phase 12 D-01/D-02 stub — Two-tunnel firewall target. Real implementation lands in Phase 18 (HEALTH-01..08).
// DO NOT import from any *.ad-eligible.ts, src/lib/analytics/*, src/lib/affiliate/*,
// src/lib/ads/*, src/lib/marketing/*, or src/lib/native/ads*.ts file —
// enforced by import-x/no-restricted-paths in eslint.config.js.

export type HealthSample = {
  metric: 'weight' | 'steps' | 'sleep' | 'hr';
  value: number;
  recordedAt: string;
};

export function readHealthSample(_metric: HealthSample['metric']): never {
  throw new Error('Phase 12 stub — implemented by Phase 18 via @capgo/capacitor-health');
}
