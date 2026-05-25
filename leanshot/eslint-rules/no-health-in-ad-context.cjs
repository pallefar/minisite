/**
 * ESLint custom rule: no-health-in-ad-context
 *
 * Phase 55 Plan 55-01 (HEALTH-04 / HEALTH-08 — Layer 1 of 3).
 *
 * Background: Apple §5.1.3 explicitly prohibits using HealthKit / PHI data
 * for advertising, marketing, or analytics purposes. Any file under an
 * ad/marketing/analytics/affiliate surface that imports health.ts would
 * constitute a §5.1.3 violation.
 *
 * HEALTH-08 mandates THREE independent enforcement layers so a single bypass
 * (an eslint-disable comment, a missed code review, a dynamic import) cannot
 * cause a §5.1.3 compliance breach:
 *   1. (this file)                build-time AST rule             fails CI lint
 *   2. src/lib/native/healthAssert.ts  runtime assertion          throws in dev/test, console.error in prod
 *   3. scripts/check-no-health-in-ad-context.sh  CI grep gate    comment-stripped backup
 *
 * Rule semantics (this file, layer 1):
 *   When ESLint visits any ImportDeclaration in a file whose path matches
 *   the FORBIDDEN_IMPORTERS pattern (ad/marketing/analytics/affiliate directory
 *   OR a *.ad-eligible.ts suffix), the rule checks whether the imported module
 *   path matches HEALTH_IMPORT. If so, it reports messageId `crossImport`.
 *
 *   The rule is scoped to the IMPORTER (the ad-context file), not the imported
 *   module. This is additive to the Phase 12 import-x/no-restricted-paths zones
 *   which block health.ts from flowing into ad directories at the path-zone level.
 *   This named custom rule adds a INDIVIDUALLY IDENTIFIABLE enforcement layer
 *   with a named messageId for HEALTH-08 compliance provability.
 *
 * Carveout: the rule returns {} (no-op) for any file that does NOT match
 * FORBIDDEN_IMPORTERS — so health.ts itself, healthkit/ components, and all
 * non-ad surfaces are entirely unaffected.
 *
 * Per ADDENDUM A6 (sibling: additive-only-events.cjs, no-raw-service-role-client.cjs,
 * no-conditional-native-review.cjs, no-paywall-on-safety-category.cjs):
 * filename is `.cjs` because `package.json` declares `"type": "module"`.
 */

'use strict';

/**
 * FORBIDDEN_IMPORTERS: files under these paths are ad-context files and
 * must NEVER import health.ts.
 *
 * The regex matches any file whose path contains /ads/, /ad/, /marketing/,
 * /analytics/, or /affiliate/ as a directory component, OR whose filename
 * ends with .ad-eligible.ts.
 *
 * The pattern covers both absolute paths (linting real src/) and the
 * virtual filenames supplied in RuleTester fixtures.
 */
const FORBIDDEN_IMPORTERS = /\/(ads?|marketing|analytics|affiliate|lib\/watch)\/|\.ad-eligible\.ts$/;

/**
 * HEALTH_IMPORT: the health.ts module path patterns that must not be
 * imported from ad-context files.
 *
 * Covers:
 *   - Relative imports:  '../native/health', './native/health'
 *   - Path-alias:        '@/lib/native/health'
 *   - With extension:    '../native/health.ts', '@/lib/native/health.ts'
 *
 * The regex is intentionally specific to `native/health` (not bare `health`)
 * to avoid false positives on unrelated health-themed modules.
 */
const HEALTH_IMPORT = /native\/health(\.ts)?$|@\/lib\/native\/health(\.ts)?$/;

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Two-tunnel firewall: ad/marketing/analytics/affiliate files must not import health.ts (HEALTH-04/HEALTH-08 Apple §5.1.3). ' +
        'Adding a new ad-surface directory? Extend FORBIDDEN_IMPORTERS in this rule file. ' +
        'Layer 1 of 3; layers 2–3 are src/lib/native/healthAssert.ts + scripts/check-no-health-in-ad-context.sh.',
      recommended: false,
    },
    messages: {
      crossImport:
        'Two-tunnel firewall violation: {{importer}} must not import health.ts. ' +
        'HealthKit / PHI data must never reach an ad-targeting surface — Apple §5.1.3. ' +
        '(HEALTH-04/HEALTH-08, Phase 55 D-01 Layer 1)',
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename ? context.getFilename() : (context.filename || '');
    // Rule is scoped to ad-context importers only. Non-ad files return a no-op visitor.
    if (!FORBIDDEN_IMPORTERS.test(filename)) {
      return {};
    }
    return {
      ImportDeclaration(node) {
        const importPath = node.source.value;
        if (HEALTH_IMPORT.test(importPath)) {
          context.report({
            node,
            messageId: 'crossImport',
            data: { importer: filename },
          });
        }
      },
      // CR-02: also catch dynamic import() expressions — import('@/lib/native/health')
      // These are ImportExpression nodes; their source is node.source (a Literal).
      // eslint-disable-next-line @typescript-eslint/naming-convention
      ImportExpression(node) {
        const source = node.source;
        const importPath =
          source && source.type === 'Literal' && typeof source.value === 'string'
            ? source.value
            : null;
        if (importPath && HEALTH_IMPORT.test(importPath)) {
          context.report({
            node,
            messageId: 'crossImport',
            data: { importer: filename },
          });
        }
      },
      // CR-02: also catch require() calls — require('../native/health')
      // These appear as CallExpression nodes with callee.name === 'require'.
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length > 0
        ) {
          const arg = node.arguments[0];
          const importPath =
            arg && arg.type === 'Literal' && typeof arg.value === 'string' ? arg.value : null;
          if (importPath && HEALTH_IMPORT.test(importPath)) {
            context.report({
              node,
              messageId: 'crossImport',
              data: { importer: filename },
            });
          }
        }
      },
    };
  },
};
