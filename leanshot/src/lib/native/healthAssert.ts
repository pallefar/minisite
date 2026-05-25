/**
 * Phase 55 Plan 55-01 — Two-tunnel firewall runtime helpers (HEALTH-04/HEALTH-08 — Layer 2 of 3).
 *
 * Two-tunnel firewall: prevents HealthKit / PHI data from ever reaching ad-targeting
 * surfaces at runtime, complementing the build-time ESLint rule (layer 1) and the
 * CI grep gate (layer 3). Apple §5.1.3 explicitly prohibits using HealthKit data for
 * advertising, marketing, or analytics purposes.
 *
 * HEALTH-08 mandates THREE independent enforcement layers:
 *   1. Build-time AST rule        leanshot/eslint-rules/no-health-in-ad-context.cjs
 *   2. Runtime assertion          (this file) — assertNoHealthData() boundary guard
 *   3. CI grep gate               leanshot/scripts/check-no-health-in-ad-context.sh
 *
 * Layer 2 design (CR-01 fix):
 *   assertHealthTunnel() — lightweight module-load marker called by health.ts public
 *   exports. In a bundled SPA the call stack at runtime does not carry module paths,
 *   so this function does NOT throw for normal health-data reads. It is a no-op that
 *   serves as a documentation and tracing hook. Layers 1 and 3 are the primary
 *   preventive gates.
 *
 *   assertNoHealthData(value, ctx?) — the REAL boundary guard. This is what ad-surface
 *   code MUST call on any data value before using it for targeting/ad-params. It throws
 *   in BOTH dev AND prod (never silently no-ops on a real violation) if value contains
 *   health-shaped field names (bodyMass/weight/steps/sleep/heartRate/health keys).
 *   Normal health reads do NOT call this — it is the AD boundary, not the health boundary.
 *
 * NOTE: This file intentionally does NOT import from any ad-targeting surface.
 * Caller: health.ts (Plan 55-03) imports assertHealthTunnel from here.
 *         ads.ts (and any future ad-surface) MUST call assertNoHealthData before
 *         using any data in targeting/ad-parameter paths.
 */

/**
 * Health-shaped field name detector.
 * These field names are canonical indicators that a value originated from HealthKit / PHI.
 */
const HEALTH_FIELD_NAMES = new Set([
  'bodyMass',
  'weight',
  'steps',
  'stepCount',
  'sleep',
  'sleepAnalysis',
  'heartRate',
  'restingHeartRate',
  'health',
  'healthkit',
  'hkSource',
  'hk_source',
  'activeEnergyBurned',
  'calories',
  'height',
  'bloodGlucose',
  'bloodPressure',
  'oxygenSaturation',
]);

/**
 * assertHealthTunnel — lightweight module-load marker (HEALTH-04/HEALTH-08 Layer 2 of 3).
 *
 * Called from every public export of health.ts that accesses PHI data.
 * This is a no-op in normal flow — runtime call-stack ad-context detection is not
 * feasible in a bundled SPA. Layers 1 (ESLint) and 3 (CI grep) are the primary
 * enforcement gates for preventing health.ts imports in ad files.
 *
 * The REAL boundary enforcement at the data level is assertNoHealthData(), which
 * ad-surface code MUST call before using any data for targeting.
 *
 * @param _callerContext - A short string naming the call site (e.g. 'readHealthSamples').
 *   Present for tracing and documentation; not used for enforcement here.
 */
export function assertHealthTunnel(_callerContext: string): void {
  // Layer 1 (ESLint) and Layer 3 (CI grep) are the primary enforcement gates.
  // Runtime call-stack ad-context detection is not feasible in a bundled SPA.
  // The REAL data-boundary guard is assertNoHealthData() — call that at ad surfaces.
  // This function intentionally does nothing; see HEALTH-08 design (CR-01 fix).
}

/**
 * assertNoHealthData — the real ad-boundary firewall guard (HEALTH-04/HEALTH-08 Layer 2).
 *
 * Ad-targeting code MUST call this on any data value before using it for ad targeting,
 * ad-parameter construction, or analytics ingestion. Throws in BOTH dev AND production
 * (never silently no-ops) if value contains health-shaped field names.
 *
 * Normal health reads (health.ts public exports) do NOT call this — those are the
 * legitimate health-data path. This guard is placed at the AD boundary.
 *
 * @param value - The data value to inspect. Objects with health-shaped keys trigger
 *   the firewall. Primitives, null, undefined, and objects without health keys pass.
 * @param ctx - Optional caller context string for error messages.
 *
 * @throws Error if value contains health-shaped field names, in both dev AND prod.
 *
 * @example
 * // In ads.ts or any ad-targeting path:
 * assertNoHealthData(userProfile, 'buildAdParams');
 * // If userProfile has { weight: 80, ... } → throws Two-tunnel firewall violation
 */
export function assertNoHealthData(value: unknown, ctx?: string): void {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object') return;

  const keys = Object.keys(value as Record<string, unknown>);
  const found = keys.find((k) => HEALTH_FIELD_NAMES.has(k));
  if (found !== undefined) {
    const location = ctx ? ` [${ctx}]` : '';
    throw new Error(
      `Two-tunnel firewall violation${location}: data with health-shaped field "${found}" reached an ad-targeting surface. ` +
        `Apple §5.1.3 prohibits HealthKit / PHI data from being used for advertising. ` +
        `(HEALTH-04/HEALTH-08 Phase 55 Layer 2 — assertNoHealthData)`,
    );
  }
}
