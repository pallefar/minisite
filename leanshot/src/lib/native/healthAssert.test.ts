/**
 * Tests for the two-tunnel firewall runtime helpers.
 *
 * Phase 55 Plan 55-01 Task 2 (HEALTH-04/HEALTH-08 — Layer 2 of 3).
 * Updated by CR-01 fix: assertHealthTunnel is now a no-op (benign marker);
 * assertNoHealthData is the real ad-boundary guard that throws on health-shaped data.
 *
 * Background: Layer 2 of the firewall has two distinct functions:
 *   assertHealthTunnel() — no-op marker on legitimate health reads (does NOT throw;
 *     runtime call-stack detection is not feasible in a bundled SPA)
 *   assertNoHealthData()  — real boundary guard at ad surfaces; ALWAYS throws (dev
 *     AND prod) when health-shaped fields are detected on data passed to ad code
 *
 * HEALTH-08 mandates three independent enforcement layers — this helper is
 * layer 2 (runtime). Layer 1 is eslint-rules/no-health-in-ad-context.cjs
 * (build-time AST); layer 3 is scripts/check-no-health-in-ad-context.sh (CI grep).
 *
 * Test strategy (CR-01 — proves BOTH halves of Layer 2):
 *   Part A — assertHealthTunnel: normal health reads do NOT throw (benign marker).
 *   Part B — assertNoHealthData: health-shaped data at ad boundary ALWAYS throws;
 *             non-health data passes without throwing.
 */

import { describe, it, expect } from 'vitest';
import { assertHealthTunnel, assertNoHealthData } from './healthAssert';

// ---------------------------------------------------------------------------
// Part A: assertHealthTunnel — must be a no-op (benign for legitimate health reads)
// ---------------------------------------------------------------------------

describe('assertHealthTunnel (Layer 2 module-load marker — no-op)', () => {
  it('does NOT throw when called from a legitimate health read context', () => {
    expect(() => {
      assertHealthTunnel('syncNow');
    }).not.toThrow();
  });

  it('does NOT throw when called with any string context', () => {
    expect(() => {
      assertHealthTunnel('readHealthSamples');
    }).not.toThrow();
    expect(() => {
      assertHealthTunnel('requestHealthKitAuthorization');
    }).not.toThrow();
    expect(() => {
      assertHealthTunnel('isEnabled');
    }).not.toThrow();
  });

  it('returns undefined (void — no return value)', () => {
    const result = assertHealthTunnel('revokeAccess');
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Part B: assertNoHealthData — real ad-boundary guard
// ---------------------------------------------------------------------------

describe('assertNoHealthData (Layer 2 ad-boundary guard — throws on health-shaped data)', () => {
  // --- Data that MUST throw ---

  it('throws when data has "weight" key (bodyMass PHI) — proves ad boundary enforcement', () => {
    expect(() => {
      assertNoHealthData({ weight: 82.5, userId: 'u1' }, 'buildAdParams');
    }).toThrow('Two-tunnel firewall violation');
  });

  it('thrown error contains §5.1.3 reference', () => {
    expect(() => {
      assertNoHealthData({ heartRate: 72 }, 'adTargeting');
    }).toThrow('§5.1.3');
  });

  it('thrown error contains the caller context string', () => {
    expect(() => {
      assertNoHealthData({ steps: 10000 }, 'buildAdProfile');
    }).toThrow('buildAdProfile');
  });

  it('thrown error names the offending field', () => {
    expect(() => {
      assertNoHealthData({ sleep: 7.5 }, 'analyticsIngest');
    }).toThrow('"sleep"');
  });

  it('throws on "hk_source" (HealthKit provenance marker)', () => {
    expect(() => {
      assertNoHealthData({ hk_source: 'apple_health', name: 'workout' });
    }).toThrow('Two-tunnel firewall violation');
  });

  it('throws on "height" (PHI — used in BMI calculation)', () => {
    expect(() => {
      assertNoHealthData({ height: 178, email: 'user@example.com' });
    }).toThrow('Two-tunnel firewall violation');
  });

  it('throws on "calories" (active energy burned — PHI)', () => {
    expect(() => {
      assertNoHealthData({ calories: 450 });
    }).toThrow('Two-tunnel firewall violation');
  });

  it('throws on "bodyMass" key', () => {
    expect(() => {
      assertNoHealthData({ bodyMass: 80 });
    }).toThrow('Two-tunnel firewall violation');
  });

  it('throws on "heartRate" key', () => {
    expect(() => {
      assertNoHealthData({ heartRate: 65 });
    }).toThrow('Two-tunnel firewall violation');
  });

  it('is an instance of Error with a descriptive message', () => {
    let caughtError: unknown;
    try {
      assertNoHealthData({ weight: 80 }, 'adBoundary');
    } catch (e) {
      caughtError = e;
    }
    expect(caughtError).toBeInstanceOf(Error);
    const err = caughtError as Error;
    expect(err.message).toContain('Two-tunnel firewall violation');
    expect(err.message).toContain('§5.1.3');
    expect(err.message).toContain('ad-targeting surface');
  });

  // --- Data that must NOT throw (proves normal health reads work fine) ---

  it('does NOT throw for null (safe no-op)', () => {
    expect(() => assertNoHealthData(null)).not.toThrow();
  });

  it('does NOT throw for undefined (safe no-op)', () => {
    expect(() => assertNoHealthData(undefined)).not.toThrow();
  });

  it('does NOT throw for a primitive string', () => {
    expect(() => assertNoHealthData('some string')).not.toThrow();
  });

  it('does NOT throw for a number', () => {
    expect(() => assertNoHealthData(42)).not.toThrow();
  });

  it('does NOT throw for an object with no health-shaped keys', () => {
    expect(() => {
      assertNoHealthData({ userId: 'u1', plan: 'free', email: 'a@b.com' }, 'adParams');
    }).not.toThrow();
  });

  it('does NOT throw for an empty object', () => {
    expect(() => assertNoHealthData({})).not.toThrow();
  });
});
