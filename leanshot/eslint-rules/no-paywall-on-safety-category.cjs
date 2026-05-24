/**
 * ESLint custom rule: no-paywall-on-safety-category
 *
 * Phase 39 Plan 39-02 (PHARMA-02 / D-06 layer 1 of 3).
 *
 * Background: D-05 enumerates 5 safety-info categories that MUST never sit
 * behind any pharma paywall surface — these are the regulator-visible
 * never-paywalled categories:
 *   - overdose-warning
 *   - contraindication-alert
 *   - fda-black-box
 *   - serious-adverse-event-signal
 *   - pregnancy-lactation-contraindication
 *
 * D-06 mandates THREE independent enforcement layers so a single bypass
 * (eslint-disable comment, runtime feature flag, missed code review) cannot
 * cause a compliance breach:
 *   1. (this file)            build-time AST rule              fails CI lint
 *   2. src/lib/pharma/phaCheck.ts  runtime assertion           throws in dev/test, warn-logs in prod
 *   3. scripts/check-no-paywall-on-safety-category.sh  CI grep gate  comment-stripped backup
 *
 * Rule semantics (this file, layer 1):
 *   When ESLint visits any JSXElement whose opening name is one of the
 *   PAYWALL_COMPONENTS (Paywall, PaywallGate, PaywallModal), the rule walks
 *   the element's subtree looking for any Identifier or MemberExpression
 *   that accesses `safety_category`. If found, the rule reports
 *   `paywallOnSafety` at the JSXElement node.
 *
 *   The subtree walk stops at function-boundary nodes (FunctionDeclaration,
 *   FunctionExpression, ArrowFunctionExpression) — mirrors the
 *   no-conditional-native-review FUNCTION_BOUNDARY_TYPES pattern. Rationale:
 *   a paywall-wrapped element that hands a CALLBACK referencing
 *   safety_category to a child component is NOT the same as the paywall
 *   directly rendering safety_category. The callback's caller is responsible
 *   for its own paywall decisions; this rule only catches direct subtree
 *   renders.
 *
 *   Future-extension hook: when a new gate component name appears (e.g.
 *   PaywallOverlay, RefundPaywall), it MUST be added to PAYWALL_COMPONENTS;
 *   the rule meta.docs.description documents the requirement so reviewers
 *   catch the omission. T-39-02-03 residual is accepted with this
 *   cross-checked at Wave 3 plan checker review.
 *
 * Per ADDENDUM A6 (sibling: additive-only-events.cjs,
 * no-raw-service-role-client.cjs, no-conditional-native-review.cjs):
 * filename is `.cjs` because `package.json` declares `"type": "module"`.
 *
 * Detection scope notes:
 *   - Identifier access:           content.safety_category       (Identifier  inside MemberExpression .property)
 *   - String-literal MemberExpr:   data['safety_category']       (StringLiteral inside MemberExpression .property)
 *   - Bare Identifier:             const safety_category = ...   (rare; still caught)
 *
 *   The rule does NOT attempt to track aliased re-exports
 *   (`const sc = content.safety_category; <Paywall>{sc}</Paywall>`) — that
 *   pattern is covered by layer 3 (the CI grep gate, which uses a 10-line
 *   co-occurrence window after comment-stripping).
 */

'use strict';

const PAYWALL_COMPONENTS = new Set([
  'Paywall',
  'PaywallGate',
  'PaywallModal',
]);

const SAFETY_FIELD_NAME = 'safety_category';

const FUNCTION_BOUNDARY_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/**
 * Return true when the JSXElement opening-element's name identifier is one
 * of the PAYWALL_COMPONENTS.
 *
 * JSXMemberExpression names (e.g. <PaywallNS.Gate>) are NOT recognised —
 * the project's gate components are imported as plain identifiers per
 * Pattern K (see no-conditional-native-review.cjs).
 */
function isPaywallElement(node) {
  if (!node || node.type !== 'JSXElement') return false;
  const opening = node.openingElement;
  if (!opening) return false;
  const nameNode = opening.name;
  if (!nameNode) return false;
  if (nameNode.type !== 'JSXIdentifier') return false;
  return PAYWALL_COMPONENTS.has(nameNode.name);
}

/**
 * Return true when `node` is a MemberExpression OR Identifier that
 * references the field name `safety_category`.
 *
 * Covers three access shapes:
 *   1. content.safety_category   →  MemberExpression with .property Identifier
 *   2. data['safety_category']   →  MemberExpression with .property Literal (string)
 *   3. safety_category           →  bare Identifier (rare; usually destructured)
 */
function referencesSafetyCategory(node) {
  if (!node) return false;
  if (node.type === 'Identifier' && node.name === SAFETY_FIELD_NAME) {
    return true;
  }
  if (node.type === 'MemberExpression') {
    const prop = node.property;
    if (!prop) return false;
    if (
      prop.type === 'Identifier' &&
      !node.computed &&
      prop.name === SAFETY_FIELD_NAME
    ) {
      return true;
    }
    if (
      node.computed &&
      prop.type === 'Literal' &&
      typeof prop.value === 'string' &&
      prop.value === SAFETY_FIELD_NAME
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Walk every descendant of `root` and return true if any descendant
 * references `safety_category`. Stops descent into function-boundary
 * nodes (their bodies are owned by a different caller).
 *
 * Iterative DFS (stack) — avoids deep recursion on large JSX subtrees.
 */
function subtreeReferencesSafetyCategory(root) {
  if (!root) return false;
  const stack = [root];
  let visited = 0;
  while (stack.length) {
    const node = stack.pop();
    visited += 1;
    if (visited > 1) {
      // Skip the root JSXElement itself when checking — but we DO check its
      // descendants. The check on the root would otherwise spuriously
      // matchif we ever extended the rule to inspect attributes.
    }
    if (referencesSafetyCategory(node)) return true;
    // Descend into child nodes. We enumerate own enumerable properties and
    // walk anything that looks like an ESTree node (has .type) or an array
    // of such. Skip parent backref to avoid infinite loops.
    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'loc' || key === 'range') continue;
      const value = node[key];
      if (!value) continue;
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === 'object' && typeof child.type === 'string') {
            if (FUNCTION_BOUNDARY_TYPES.has(child.type)) continue;
            stack.push(child);
          }
        }
      } else if (typeof value === 'object' && typeof value.type === 'string') {
        if (FUNCTION_BOUNDARY_TYPES.has(value.type)) continue;
        stack.push(value);
      }
    }
  }
  return false;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Pharma paywall components (Paywall, PaywallGate, PaywallModal) must never wrap a render that reads safety_category — D-05 enumerates 5 categories (overdose-warning, contraindication-alert, fda-black-box, serious-adverse-event-signal, pregnancy-lactation-contraindication) that are always free regardless of subscription state. Adding a new gate component name? Extend PAYWALL_COMPONENTS in this rule file.',
      recommended: false,
    },
    messages: {
      paywallOnSafety:
        'Paywall* component wraps a subtree that reads `safety_category` — D-05 mandates these 5 categories stay free of any paywall surface. Move the safety_category render outside the Paywall* wrapper, or guard with phaCheck() to surface the violation at runtime as well.',
    },
    schema: [],
  },

  create(context) {
    return {
      JSXElement(node) {
        if (!isPaywallElement(node)) return;
        if (!subtreeReferencesSafetyCategory(node)) return;
        context.report({
          node,
          messageId: 'paywallOnSafety',
        });
      },
    };
  },
};
