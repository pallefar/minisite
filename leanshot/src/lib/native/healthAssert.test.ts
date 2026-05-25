/**
 * Tests for the assertHealthTunnel runtime guard.
 *
 * Phase 55 Plan 55-01 Task 2 (HEALTH-04/HEALTH-08 — Layer 2 of 3).
 *
 * Background: assertHealthTunnel() is the belt-AND-suspenders runtime layer of
 * the two-tunnel firewall. In DEV/test environments it THROWS so that violations
 * are caught loudly during development; in production it console.error-logs only.
 *
 * HEALTH-08 mandates three independent enforcement layers — this helper is
 * layer 2 (runtime). Layer 1 is eslint-rules/no-health-in-ad-context.cjs
 * (build-time AST); layer 3 is scripts/check-no-health-in-ad-context.sh (CI grep).
 *
 * Test strategy:
 *   - Vitest sets import.meta.env.MODE === 'test', so LOUD=true in this environment.
 *   - assertHealthTunnel() MUST throw when called in test env.
 *   - The thrown error message MUST contain the caller context string.
 *   - The thrown error message MUST contain "§5.1.3" (Apple privacy policy reference).
 */

import { describe, it, expect } from 'vitest';
import { assertHealthTunnel } from './healthAssert';

describe('assertHealthTunnel (Layer 2 runtime guard)', () => {
  it('throws in test environment (Vitest sets MODE=test → LOUD=true)', () => {
    expect(() => {
      assertHealthTunnel('testCaller');
    }).toThrow();
  });

  it('thrown error message contains the caller context string', () => {
    const callerCtx = 'readHealthSamples';
    expect(() => {
      assertHealthTunnel(callerCtx);
    }).toThrow(callerCtx);
  });

  it('thrown error message contains Apple §5.1.3 reference', () => {
    expect(() => {
      assertHealthTunnel('someAdContextCaller');
    }).toThrow('§5.1.3');
  });

  it('thrown error is an instance of Error with a descriptive message', () => {
    let caughtError: unknown;
    try {
      assertHealthTunnel('adContextCaller');
    } catch (e) {
      caughtError = e;
    }
    expect(caughtError).toBeInstanceOf(Error);
    const err = caughtError as Error;
    expect(err.message).toContain('Two-tunnel firewall');
    expect(err.message).toContain('adContextCaller');
    expect(err.message).toContain('§5.1.3');
  });
});
