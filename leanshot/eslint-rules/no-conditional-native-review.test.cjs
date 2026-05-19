/**
 * Tests for the no-conditional-native-review custom ESLint rule.
 *
 * Phase 42 Plan 42-07 Task 3 (D-20).
 *
 * Required fixtures (per plan):
 *   1. P36-style conditional `if (cohort === 'X') { requestReview(); }` FAILS.
 *   2. P42 conditional `if (...) { showQuarterlyNpsModal(); }` FAILS.
 *   3. UNCONDITIONAL `showQuarterlyNpsModal()` at top-level PASSES.
 *   4. UNCONDITIONAL `review.requestReview()` PASSES.
 *
 * Runs with Node.js built-in test runner:
 *   node --test eslint-rules/no-conditional-native-review.test.cjs
 *
 * Uses ESLint's RuleTester (flat-config variant). See sibling
 * `__tests__/no-raw-service-role-client.test.cjs` for the same harness.
 */

'use strict';

const { test, describe } = require('node:test');
const { RuleTester } = require('eslint');

const rule = require('./no-conditional-native-review.cjs');

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

describe('no-conditional-native-review', () => {
  test('Fixture 1: P36-style conditional `if (cohort) { requestReview(); }` → FAILS', () => {
    tester.run('no-conditional-native-review', rule, {
      valid: [],
      invalid: [
        {
          filename: 'src/lib/review/trigger.ts',
          code: `
            function maybePrompt(cohort) {
              if (cohort === 'X') {
                requestReview();
              }
            }
          `,
          errors: [{ messageId: 'conditionalSurface' }],
        },
        // Member-expression variant: review.requestReview() inside an if.
        {
          filename: 'src/lib/review/trigger.ts',
          code: `
            function maybePrompt(review, cohort) {
              if (cohort === 'X') {
                review.requestReview();
              }
            }
          `,
          errors: [{ messageId: 'conditionalSurface' }],
        },
      ],
    });
  });

  test('Fixture 2: P42 conditional `if (...) { showQuarterlyNpsModal(); }` → FAILS', () => {
    tester.run('no-conditional-native-review', rule, {
      valid: [],
      invalid: [
        {
          filename: 'src/components/dashboard/QuarterlyNpsTrigger.tsx',
          code: `
            function check(state) {
              if (state.eligible) {
                showQuarterlyNpsModal();
              }
            }
          `,
          errors: [{ messageId: 'conditionalSurface' }],
        },
        // Ternary ConditionalExpression ancestor.
        {
          filename: 'src/components/dashboard/QuarterlyNpsTrigger.tsx',
          code: `
            function check(state) {
              state.eligible ? triggerQuarterlyNps() : null;
            }
          `,
          errors: [{ messageId: 'conditionalSurface' }],
        },
        // Logical-and short-circuit guard.
        {
          filename: 'src/components/dashboard/QuarterlyNpsTrigger.tsx',
          code: `
            function check(state) {
              state.eligible && triggerQuarterlyNps();
            }
          `,
          errors: [{ messageId: 'conditionalSurface' }],
        },
      ],
    });
  });

  test('Fixture 3: UNCONDITIONAL `showQuarterlyNpsModal()` at module top-level → PASSES', () => {
    tester.run('no-conditional-native-review', rule, {
      valid: [
        {
          filename: 'src/lib/nps/trigger.ts',
          // Top-level statement, no conditional ancestor inside the enclosing
          // function (which is Program here — the function-boundary node).
          code: `
            function fireOnLogin() {
              showQuarterlyNpsModal();
            }
          `,
        },
        // Bare top-level call.
        {
          filename: 'src/lib/nps/trigger.ts',
          code: `showQuarterlyNpsModal();`,
        },
      ],
      invalid: [],
    });
  });

  test('Fixture 4: UNCONDITIONAL `review.requestReview()` → PASSES', () => {
    tester.run('no-conditional-native-review', rule, {
      valid: [
        {
          filename: 'src/lib/review/trigger.ts',
          code: `
            function fire(review) {
              review.requestReview();
            }
          `,
        },
        // Member access on a chain (still unconditional).
        {
          filename: 'src/lib/review/trigger.ts',
          code: `
            function fire() {
              window.review.requestReview();
            }
          `,
        },
      ],
      invalid: [],
    });
  });

  // Sanity: an unrelated identifier inside a conditional must NOT trip.
  test('Sanity: unrelated function call inside an `if` → 0 errors', () => {
    tester.run('no-conditional-native-review', rule, {
      valid: [
        {
          filename: 'src/lib/unrelated.ts',
          code: `
            function fire(state) {
              if (state.eligible) {
                console.log('ok');
              }
            }
          `,
        },
      ],
      invalid: [],
    });
  });
});
