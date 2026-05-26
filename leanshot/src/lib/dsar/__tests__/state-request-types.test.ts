/**
 * Phase 64 Plan 64-06 — state-request-types lookup module tests.
 *
 * 8 behaviors per 64-06-PLAN.md Task 1:
 *   Test 1: getRequestTypesForState('CA') → 5 types (incl. limit_sensitive_use)
 *   Test 2: getRequestTypesForState('VA') → 5 types (incl. correction)
 *   Test 3: getRequestTypesForState('CO') → 6 types (incl. opt_in_sensitive)
 *   Test 4: getRequestTypesForState('CT') === CO (same as CO)
 *   Test 5: getRequestTypesForState('UT') → 2 types only (deletion, access — UCPA narrower)
 *   Test 6: getRequestTypesForState('OTHER') → 2 types (deletion, access)
 *   Test 7: getRequestTypesForState('XX') throws "Unknown state"
 *   Test 8: STATE_REQUEST_TYPES is `as const` shaped { CA, VA, CO, CT, UT, OTHER }
 */
import { describe, it, expect } from 'vitest';
import {
  getRequestTypesForState,
  STATE_REQUEST_TYPES,
  type StateCode,
} from '@/lib/dsar/state-request-types';

describe('getRequestTypesForState (Phase 64 LEGAL-03)', () => {
  it('Test 1: CA returns deletion, access, portability, opt_out, limit_sensitive_use', () => {
    const result = getRequestTypesForState('CA');
    expect(result).toEqual(['deletion', 'access', 'portability', 'opt_out', 'limit_sensitive_use']);
    expect(result).toHaveLength(5);
  });

  it('Test 2: VA returns deletion, access, portability, correction, opt_out', () => {
    const result = getRequestTypesForState('VA');
    expect(result).toEqual(['deletion', 'access', 'portability', 'correction', 'opt_out']);
    expect(result).toHaveLength(5);
  });

  it('Test 3: CO returns deletion, access, portability, correction, opt_out, opt_in_sensitive', () => {
    const result = getRequestTypesForState('CO');
    expect(result).toEqual([
      'deletion',
      'access',
      'portability',
      'correction',
      'opt_out',
      'opt_in_sensitive',
    ]);
    expect(result).toHaveLength(6);
  });

  it('Test 4: CT returns same as CO (deletion, access, portability, correction, opt_out, opt_in_sensitive)', () => {
    const ctResult = getRequestTypesForState('CT');
    const coResult = getRequestTypesForState('CO');
    expect(ctResult).toEqual(coResult);
    expect(ctResult).toHaveLength(6);
  });

  it('Test 5: UT returns only deletion, access (UCPA narrower — no portability)', () => {
    const result = getRequestTypesForState('UT');
    expect(result).toEqual(['deletion', 'access']);
    expect(result).toHaveLength(2);
    expect(result).not.toContain('portability');
    expect(result).not.toContain('correction');
    expect(result).not.toContain('opt_out');
    expect(result).not.toContain('opt_in_sensitive');
    expect(result).not.toContain('limit_sensitive_use');
  });

  it('Test 6: OTHER returns deletion, access (default base set)', () => {
    const result = getRequestTypesForState('OTHER');
    expect(result).toEqual(['deletion', 'access']);
    expect(result).toHaveLength(2);
  });

  it('Test 7: unknown state code throws "Unknown state"', () => {
    // Cast to StateCode to bypass TypeScript check (testing runtime defensive guard)
    expect(() => getRequestTypesForState('XX' as StateCode)).toThrow('Unknown state');
  });

  it('Test 8: STATE_REQUEST_TYPES is shaped { CA, VA, CO, CT, UT, OTHER } with correct arrays', () => {
    const keys = Object.keys(STATE_REQUEST_TYPES).sort();
    expect(keys).toEqual(['CA', 'CO', 'CT', 'OTHER', 'UT', 'VA']);
    // Spot check a few entries to confirm as const readonly arrays
    expect(STATE_REQUEST_TYPES.CA).toContain('limit_sensitive_use');
    expect(STATE_REQUEST_TYPES.CO).toContain('opt_in_sensitive');
    expect(STATE_REQUEST_TYPES.UT).toHaveLength(2);
  });
});
