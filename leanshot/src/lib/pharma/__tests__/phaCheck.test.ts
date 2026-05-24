/**
 * Phase 39 Plan 39-02 Task 2 — phaCheck runtime helper tests (D-06 layer 2 of 3).
 *
 * D-05 enumerates 5 safety-info categories that must never sit behind a paywall:
 *   - overdose-warning
 *   - contraindication-alert
 *   - fda-black-box
 *   - serious-adverse-event-signal
 *   - pregnancy-lactation-contraindication
 *
 * In dev/test environments phaCheck() THROWS so the violation is loud during
 * development. In production it console.warn()s only so a regression cannot
 * crash a user's render (defense-in-depth — layer 1 ESLint and layer 3 CI grep
 * are the primary preventive gates).
 *
 * Vitest sets `MODE = 'test'` so the throwing branch is exercised here.
 */
import { describe, expect, it } from 'vitest';
import { phaCheck } from '../phaCheck';

const SAFETY_CATEGORIES = [
  'overdose-warning',
  'contraindication-alert',
  'fda-black-box',
  'serious-adverse-event-signal',
  'pregnancy-lactation-contraindication',
] as const;

describe('phaCheck', () => {
  describe('throws in test/dev when safety_category is set', () => {
    for (const category of SAFETY_CATEGORIES) {
      it(`throws for safety_category="${category}"`, () => {
        expect(() => phaCheck({ safety_category: category })).toThrow();
      });
    }
  });

  describe('does not throw when safety_category is absent/null', () => {
    it('does not throw when safety_category is null', () => {
      expect(() => phaCheck({ safety_category: null })).not.toThrow();
    });

    it('does not throw when safety_category is undefined (absent)', () => {
      expect(() => phaCheck({})).not.toThrow();
    });

    it('does not throw for unrelated content fields', () => {
      expect(() => phaCheck({ dosage: '5mg', frequency: 'weekly' })).not.toThrow();
    });
  });

  describe('error message references D-05 / safety_category', () => {
    it('includes the offending category value in the thrown error', () => {
      try {
        phaCheck({ safety_category: 'fda-black-box' });
        throw new Error('expected phaCheck to throw');
      } catch (err) {
        expect((err as Error).message).toMatch(/safety_category/);
        expect((err as Error).message).toMatch(/fda-black-box/);
      }
    });
  });
});
