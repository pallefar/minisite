/**
 * Tests for the no-paywall-on-safety-category custom ESLint rule.
 *
 * Phase 39 Plan 39-02 Task 1 (D-06 layer 1 of 3).
 *
 * Background: D-05 enumerates 5 safety-info categories that MUST be free of
 * any paywall surface: overdose-warning, contraindication-alert, fda-black-box,
 * serious-adverse-event-signal, pregnancy-lactation-contraindication. D-06
 * mandates three independent enforcement layers — this rule is layer 1
 * (build-time AST). Layer 2 is the runtime phaCheck() helper; layer 3 is the
 * scripts/check-no-paywall-on-safety-category.sh CI grep gate.
 *
 * Rule shape mirrors no-conditional-native-review.cjs (Pattern K): identifier
 * Set + JSXElement visitor + subtree walk bounded at function/program nodes.
 *
 * Test fixtures (6 total, per plan):
 *   1. invalid: <Paywall>{content.safety_category}</Paywall>           → paywallOnSafety
 *   2. invalid: <PaywallGate>{x.safety_category && ...}</PaywallGate>  → paywallOnSafety
 *   3. invalid: <PaywallModal>{ data['safety_category'] }</...>        → paywallOnSafety (MemberExpression form)
 *   4. valid:   <PaywallGate>{content.dosage}</PaywallGate>            → 0 errors
 *   5. valid:   <div>{content.safety_category}</div>                   → 0 errors (not a Paywall* wrapper)
 *   6. valid:   <Paywall>{ () => content.safety_category }</Paywall>   → 0 errors (function boundary bail)
 *
 * Runs with Node.js built-in test runner:
 *   node --test eslint-rules/__tests__/no-paywall-on-safety-category.test.cjs
 *
 * Uses ESLint's RuleTester (flat-config variant) — same harness as the sibling
 * no-conditional-native-review and no-raw-service-role-client tests.
 *
 * Filename is `.cjs` because package.json declares `"type": "module"` and
 * ESLint rule modules use CommonJS module.exports.
 */

'use strict';

const { test, describe } = require('node:test');
const { RuleTester } = require('eslint');

const rule = require('../no-paywall-on-safety-category.cjs');

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

describe('no-paywall-on-safety-category', () => {
  test('Fixture 1: <Paywall>{content.safety_category}</Paywall> → FAILS', () => {
    tester.run('no-paywall-on-safety-category', rule, {
      valid: [],
      invalid: [
        {
          filename: 'src/components/pharma/Surface.tsx',
          code: `
            function Surface({ content }) {
              return <Paywall>{content.safety_category}</Paywall>;
            }
          `,
          errors: [{ messageId: 'paywallOnSafety' }],
        },
      ],
    });
  });

  test('Fixture 2: <PaywallGate>{x.safety_category && <span/>}</PaywallGate> → FAILS', () => {
    tester.run('no-paywall-on-safety-category', rule, {
      valid: [],
      invalid: [
        {
          filename: 'src/components/pharma/Surface.tsx',
          code: `
            function Surface({ x }) {
              return <PaywallGate>{x.safety_category && <span/>}</PaywallGate>;
            }
          `,
          errors: [{ messageId: 'paywallOnSafety' }],
        },
      ],
    });
  });

  test('Fixture 3: <PaywallModal>{ data[\'safety_category\'] }</PaywallModal> → FAILS (MemberExpression literal)', () => {
    tester.run('no-paywall-on-safety-category', rule, {
      valid: [],
      invalid: [
        {
          filename: 'src/components/pharma/Surface.tsx',
          code: `
            function Surface({ data }) {
              return <PaywallModal>{ data['safety_category'] }</PaywallModal>;
            }
          `,
          errors: [{ messageId: 'paywallOnSafety' }],
        },
      ],
    });
  });

  test('Fixture 4: <PaywallGate>{content.dosage}</PaywallGate> → PASSES (non-safety field)', () => {
    tester.run('no-paywall-on-safety-category', rule, {
      valid: [
        {
          filename: 'src/components/pharma/Surface.tsx',
          code: `
            function Surface({ content }) {
              return <PaywallGate>{content.dosage}</PaywallGate>;
            }
          `,
        },
      ],
      invalid: [],
    });
  });

  test('Fixture 5: <div>{content.safety_category}</div> → PASSES (not a Paywall* wrapper)', () => {
    tester.run('no-paywall-on-safety-category', rule, {
      valid: [
        {
          filename: 'src/components/pharma/Surface.tsx',
          code: `
            function Surface({ content }) {
              return <div>{content.safety_category}</div>;
            }
          `,
        },
      ],
      invalid: [],
    });
  });

  test('Fixture 6: function-boundary bail — Paywall containing an inline arrow accessing safety_category → PASSES', () => {
    tester.run('no-paywall-on-safety-category', rule, {
      valid: [
        {
          filename: 'src/components/pharma/Surface.tsx',
          // The arrow function body is a SEPARATE function-scope; the rule's
          // subtree walk bails at FunctionExpression / ArrowFunctionExpression
          // boundaries (mirrors no-conditional-native-review FUNCTION_BOUNDARY_TYPES).
          // The Paywall itself does not directly render safety_category — the
          // arrow is a callback/render-prop that the caller invokes elsewhere.
          code: `
            function Surface({ content, onAccess }) {
              return <Paywall>{onAccess(() => content.safety_category)}</Paywall>;
            }
          `,
        },
      ],
      invalid: [],
    });
  });
});
