/**
 * Tests for the no-health-in-ad-context custom ESLint rule.
 *
 * Phase 55 Plan 55-01 Task 1 (HEALTH-04/HEALTH-08 — Layer 1 of 3).
 *
 * Background: Apple §5.1.3 prohibits PHI / HealthKit data from reaching
 * ad-targeting surfaces. HEALTH-08 mandates three independent enforcement
 * layers — this rule is layer 1 (build-time AST). Layer 2 is the runtime
 * assertHealthTunnel() helper; layer 3 is
 * scripts/check-no-health-in-ad-context.sh (CI grep gate).
 *
 * Rule shape: ImportDeclaration visitor scoped to FORBIDDEN_IMPORTERS
 * (ad/marketing/analytics/affiliate directory OR *.ad-eligible.ts suffix).
 * Reports crossImport when imported module matches native/health.
 *
 * Test fixtures (4 total, per plan):
 *   1. INVALID: ad-context file imports ./native/health       → crossImport
 *   2. INVALID: ad-eligible file imports @/lib/native/health  → crossImport
 *   3. VALID:   ad-context file imports ./platform            → 0 errors
 *   4. VALID:   non-ad file (healthkit/) imports ./health     → 0 errors
 *
 * Runs with Node.js built-in test runner:
 *   node --test eslint-rules/__tests__/no-health-in-ad-context.test.cjs
 *
 * Uses ESLint's RuleTester (flat-config variant) — same harness as the
 * sibling no-paywall-on-safety-category test.
 *
 * Filename is `.cjs` because package.json declares `"type": "module"` and
 * ESLint rule modules use CommonJS module.exports.
 */

'use strict';

const { test, describe } = require('node:test');
const { RuleTester } = require('eslint');

const rule = require('../no-health-in-ad-context.cjs');

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

describe('no-health-in-ad-context', () => {
  test('Fixture 1: ad-context file importing ./native/health → FAILS', () => {
    tester.run('no-health-in-ad-context', rule, {
      valid: [],
      invalid: [
        {
          filename: 'src/lib/analytics/tracker.ts',
          code: `import { readHealthSamples } from '../native/health';`,
          errors: [{ messageId: 'crossImport' }],
        },
      ],
    });
  });

  test('Fixture 2: *.ad-eligible.ts file importing @/lib/native/health → FAILS', () => {
    tester.run('no-health-in-ad-context', rule, {
      valid: [],
      invalid: [
        {
          filename: 'src/lib/native/ads-profile.ad-eligible.ts',
          code: `import { requestHealthKitAuthorization } from '@/lib/native/health';`,
          errors: [{ messageId: 'crossImport' }],
        },
      ],
    });
  });

  test('Fixture 5: ad-context file using dynamic import() of health → FAILS (CR-02 dynamic-import bypass fix)', () => {
    tester.run('no-health-in-ad-context', rule, {
      valid: [],
      invalid: [
        {
          filename: 'src/lib/analytics/tracker.ts',
          code: `const h = import('../native/health');`,
          errors: [{ messageId: 'crossImport' }],
        },
      ],
    });
  });

  test('Fixture 6: ad-context file using require() of health → FAILS (CR-02 dynamic-import bypass fix)', () => {
    tester.run('no-health-in-ad-context', rule, {
      valid: [],
      invalid: [
        {
          filename: 'src/lib/marketing/campaign.ts',
          code: `const h = require('@/lib/native/health');`,
          errors: [{ messageId: 'crossImport' }],
        },
      ],
    });
  });

  test('Fixture 3: ad-context file importing ./platform (non-health) → PASSES', () => {
    tester.run('no-health-in-ad-context', rule, {
      valid: [
        {
          filename: 'src/lib/marketing/campaign.ts',
          code: `import { detectPlatform } from '../native/platform';`,
        },
      ],
      invalid: [],
    });
  });

  test('Fixture 4: non-ad file (healthkit/) importing ./health → PASSES (rule is importer-scoped)', () => {
    tester.run('no-health-in-ad-context', rule, {
      valid: [
        {
          filename: 'src/components/healthkit/HealthKitConsentModal.tsx',
          code: `import { isHealthKitAvailable } from '../../lib/native/health';`,
        },
      ],
      invalid: [],
    });
  });
});
