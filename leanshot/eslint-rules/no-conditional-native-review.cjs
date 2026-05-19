// Created in P42 D-20 to enforce the UNCONDITIONAL principle on BOTH NPS instruments: P36 review-prompt (requestReview / showReviewPrompt / triggerReviewPrompt) AND P42 quarterly check-in (showQuarterlyNpsModal / triggerQuarterlyNps). Phase 36's V13-3 BLOCKER decision applies here.
/**
 * ESLint custom rule: no-conditional-native-review
 *
 * Phase 42 Plan 42-07 (POLISH-12 D-20).
 *
 * Background: P36 (review-prompt) and P42 (quarterly NPS) are TWO separate
 * NPS-family instruments (P42 D-19), but both share the same V13-3 BLOCKER
 * rule from Phase 36: when the in-app modal/native-review surface is
 * conditionalized on cohort / experiment flag / runtime predicate, the user
 * experience becomes non-deterministic and the cap-enforcement logic on the
 * server can no longer be trusted.
 *
 * This rule walks the AST of each project file and flags any invocation of
 * the known NPS-family entry-point call identifiers if it lives under a
 * conditional ancestor (IfStatement / ConditionalExpression / LogicalExpression
 * / SwitchCase) inside the enclosing function/program body.
 *
 * Target call identifiers:
 *   - P36 review-prompt baseline (the rule pre-emptively covers P36's identifiers
 *     so when P36 ships its call sites, the lint gate is already in place):
 *       requestReview, showReviewPrompt, triggerReviewPrompt
 *   - P42 quarterly NPS surfacing (this plan):
 *       showQuarterlyNpsModal, triggerQuarterlyNps
 *
 * Matches both:
 *   - Bare CallExpression with callee.name in the set:    `triggerQuarterlyNps()`
 *   - MemberExpression call with property.name in the set: `review.requestReview()`
 *
 * Conditional ancestors that trigger a report:
 *   - IfStatement
 *   - ConditionalExpression (the `? :` ternary)
 *   - LogicalExpression with operator `&&` or `||` (short-circuit guard)
 *   - SwitchCase
 *
 * The ancestor walk STOPS at the enclosing FunctionDeclaration /
 * FunctionExpression / ArrowFunctionExpression / Program node — a call inside
 * a function body that is itself conditionally invoked is the caller's
 * problem; the rule only catches conditional surfacing *at* the call site.
 *
 * Per ADDENDUM A6 (and sibling rules `additive-only-events.cjs`,
 * `no-raw-service-role-client.cjs`): filename is `.cjs` because
 * `package.json` declares `"type": "module"`.
 *
 * NOTE TO PHASE 36 EXECUTOR: this file already exists. When P36 ships its
 * call sites, REUSE this rule — do NOT recreate. Add P36-specific test
 * fixtures to the existing .test.cjs file if needed.
 */

'use strict';

const TARGET_CALL_NAMES = new Set([
  // P36 review-prompt baseline (added to the rule pre-emptively).
  'requestReview',
  'showReviewPrompt',
  'triggerReviewPrompt',
  // P42 D-20 quarterly NPS surfacing.
  'showQuarterlyNpsModal',
  'triggerQuarterlyNps',
]);

const CONDITIONAL_ANCESTOR_TYPES = new Set([
  'IfStatement',
  'ConditionalExpression',
  'LogicalExpression',
  'SwitchCase',
]);

const FUNCTION_BOUNDARY_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'Program',
]);

/**
 * Return true if `node` is a CallExpression whose callee identifies one of
 * the target NPS-family call names.
 */
function matchesTargetCall(node) {
  if (!node || node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (!callee) return false;
  if (callee.type === 'Identifier' && TARGET_CALL_NAMES.has(callee.name)) {
    return true;
  }
  if (
    callee.type === 'MemberExpression' &&
    callee.property &&
    callee.property.type === 'Identifier' &&
    TARGET_CALL_NAMES.has(callee.property.name)
  ) {
    return true;
  }
  return false;
}

/**
 * Walk parents from `node` up to (but not crossing) the enclosing function /
 * program node. Return the first conditional-ancestor type encountered, or
 * null if there is no conditional ancestor in the enclosing scope.
 */
function findConditionalAncestor(node) {
  let current = node.parent;
  while (current) {
    if (FUNCTION_BOUNDARY_TYPES.has(current.type)) return null;
    if (CONDITIONAL_ANCESTOR_TYPES.has(current.type)) return current.type;
    current = current.parent;
  }
  return null;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Native review prompts and quarterly NPS modal must fire unconditionally — no cohort gating, no conditional ancestors.',
      recommended: false,
    },
    messages: {
      conditionalSurface:
        'Native review / NPS surfacing must be unconditional — found conditional ancestor of type {{type}}. ' +
        'Per Phase 36 V13-3 BLOCKER + Phase 42 D-20: the call site must be at the function/module top-level, ' +
        'with cap / cohort decisions made server-side (or by the native API itself).',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (!matchesTargetCall(node)) return;
        const ancestor = findConditionalAncestor(node);
        if (!ancestor) return;
        context.report({
          node,
          messageId: 'conditionalSurface',
          data: { type: ancestor },
        });
      },
    };
  },
};
