/**
 * Phase 55 Plan 55-01 — assertHealthTunnel runtime helper (HEALTH-04/HEALTH-08 — Layer 2 of 3).
 *
 * Two-tunnel firewall: prevents HealthKit / PHI data from ever reaching ad-targeting
 * surfaces at runtime, complementing the build-time ESLint rule (layer 1) and the
 * CI grep gate (layer 3). Apple §5.1.3 explicitly prohibits using HealthKit data for
 * advertising, marketing, or analytics purposes.
 *
 * HEALTH-08 mandates THREE independent enforcement layers:
 *   1. Build-time AST rule        leanshot/eslint-rules/no-health-in-ad-context.cjs
 *   2. Runtime assertion          (this file) — assertHealthTunnel()
 *   3. CI grep gate               leanshot/scripts/check-no-health-in-ad-context.sh
 *
 * Behaviour of assertHealthTunnel():
 *   - Called from any public export of health.ts that accesses PHI data, as a
 *     belt-AND-suspenders check at the function call site.
 *   - In DEV / test environments the function THROWS so the violation is loud
 *     during development. The thrown error names the caller context and §5.1.3.
 *   - In production the function only `console.error`s — production renders must
 *     never crash for the end-user. Layers 1 and 3 are the primary preventive
 *     gates; assertHealthTunnel is defense-in-depth for dynamic-import scenarios.
 *
 * Environment detection: `import.meta.env.DEV` (Vite injects this at build),
 * `import.meta.env.MODE === 'test'` (Vitest sets MODE=test).
 * Fallback: loud-by-default (true) when import.meta.env is unavailable (Node test
 * runner importing this file directly without Vite).
 *
 * NOTE: This file intentionally does NOT import from any ad-targeting surface.
 * Caller: health.ts (Plan 55-03) imports assertHealthTunnel from here.
 */

/**
 * Module-level dev/test detection. Evaluated once at import time so the
 * runtime cost on every assertHealthTunnel call is a single boolean read.
 *
 * Mirrors the isLoudEnvironment() pattern from src/lib/pharma/phaCheck.ts
 * (Phase 39 PHARMA-02 precedent).
 */
function isLoudEnvironment(): boolean {
  try {
    const env = import.meta.env as { DEV?: boolean; MODE?: string } | undefined;
    if (env) {
      if (env.DEV === true) return true;
      if (typeof env.MODE === 'string' && env.MODE === 'test') return true;
      if (env.DEV === false && env.MODE !== 'test') return false;
    }
  } catch {
    // import.meta.env may be undefined when imported from a non-Vite runtime.
    // Fall through to the safe default below.
  }
  // Safe default — loud unless we positively detected production.
  return true;
}

const LOUD = isLoudEnvironment();

/**
 * Two-tunnel firewall runtime guard (HEALTH-04/HEALTH-08 Layer 2 of 3).
 *
 * Call from any health.ts public export that accesses PHI data. If the guard
 * detects it is running in a dev or test environment it throws so that any
 * ad-context caller is caught loudly. In production it console.error-logs only —
 * the ESLint rule (layer 1) and CI grep gate (layer 3) are the primary gates.
 *
 * @param callerContext - A short string naming the call site (e.g. 'readHealthSamples').
 *   Included in the error/log message so CI logs are actionable.
 */
export function assertHealthTunnel(callerContext: string): void {
  const msg =
    `Two-tunnel firewall: health data accessed in ad context [${callerContext}]. ` +
    `Apple §5.1.3 violation. ` +
    `(HEALTH-04/HEALTH-08 Phase 55 Layer 2 — assertHealthTunnel)`;
  if (LOUD) {
    throw new Error(msg);
  }
  // Production: error-log only — never crash a real user session.
  // eslint-disable-next-line no-console
  console.error(msg);
}
