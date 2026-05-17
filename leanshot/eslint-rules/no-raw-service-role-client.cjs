/**
 * ESLint custom rule: no-raw-service-role-client
 *
 * Phase 28 Plan 28-02 D-06 / ADDENDUM A6.
 *
 * Blocks `createClient(*, SERVICE_ROLE_KEY)` construction anywhere in the
 * codebase EXCEPT inside `supabase/functions/_shared/supabase-server.ts`
 * (the ONLY authorized factory per the 4-layer org_id defense).
 *
 * Matches three patterns for the second argument to createClient():
 *   1. Identifier: `createClient(url, SUPABASE_SERVICE_ROLE_KEY)`
 *   2. Deno env:   `createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))`
 *   3. process env:`createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY)`
 *
 * The SERVICE_ROLE_KEY regex `/SERVICE_ROLE_KEY$/` covers all variants;
 * it does NOT match anon key, publishable key, etc.
 *
 * Per ADDENDUM A6: filename is `.cjs` because `package.json` declares
 * `"type": "module"` — all `.js` files are ESM by default; custom ESLint
 * rules use CommonJS (require / module.exports) and MUST use `.cjs`.
 *
 * Matches existing project convention: `additive-only-events.cjs`.
 */

'use strict';

const SERVICE_ROLE_KEY_RE = /SERVICE_ROLE_KEY$/;

// ---------------------------------------------------------------------------
// Helper: detect whether the second argument to createClient() uses a key
// that matches SERVICE_ROLE_KEY.
// ---------------------------------------------------------------------------

/**
 * Returns true if `argNode` looks like a service-role key reference.
 *
 * Handles:
 *   - `Identifier` whose name matches /SERVICE_ROLE_KEY$/
 *   - `MemberExpression` (process.env.SUPABASE_SERVICE_ROLE_KEY)
 *   - `CallExpression` (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
 */
function isServiceRoleKeyArg(argNode) {
  if (!argNode) return false;

  // Pattern 1: bare Identifier — createClient(url, SUPABASE_SERVICE_ROLE_KEY)
  if (
    argNode.type === 'Identifier' &&
    SERVICE_ROLE_KEY_RE.test(argNode.name)
  ) {
    return true;
  }

  // Pattern 3: process.env.SUPABASE_SERVICE_ROLE_KEY (MemberExpression)
  if (
    argNode.type === 'MemberExpression' &&
    argNode.property &&
    (argNode.property.type === 'Identifier'
      ? SERVICE_ROLE_KEY_RE.test(argNode.property.name)
      : argNode.property.type === 'Literal' &&
        SERVICE_ROLE_KEY_RE.test(String(argNode.property.value)))
  ) {
    return true;
  }

  // Pattern 2: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') (CallExpression)
  // Shape: CallExpression where
  //   callee = MemberExpression { object: MemberExpression { object: {name:'Deno'}, property: {name:'env'} }, property: {name:'get'} }
  //   arguments[0] = Literal matching SERVICE_ROLE_KEY_RE
  if (
    argNode.type === 'CallExpression' &&
    argNode.callee &&
    argNode.callee.type === 'MemberExpression' &&
    argNode.callee.property &&
    argNode.callee.property.type === 'Identifier' &&
    argNode.callee.property.name === 'get'
  ) {
    const calleeObj = argNode.callee.object;
    // Deno.env.get — the object is Deno.env (another MemberExpression)
    if (
      calleeObj &&
      calleeObj.type === 'MemberExpression' &&
      calleeObj.object &&
      calleeObj.object.type === 'Identifier' &&
      calleeObj.object.name === 'Deno' &&
      calleeObj.property &&
      calleeObj.property.type === 'Identifier' &&
      calleeObj.property.name === 'env'
    ) {
      // Check the string literal argument
      const firstArg = argNode.arguments && argNode.arguments[0];
      if (
        firstArg &&
        firstArg.type === 'Literal' &&
        SERVICE_ROLE_KEY_RE.test(String(firstArg.value))
      ) {
        return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// ESLint rule definition
// ---------------------------------------------------------------------------

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid raw createClient(..., SERVICE_ROLE_KEY) construction outside ' +
        'supabase/functions/_shared/supabase-server.ts (Phase 28 D-06). ' +
        'Use withOrgScope(orgId, fn) from supabase/functions/_shared/with-org-scope.ts instead. ' +
        'See 28-CONTEXT.md D-04..D-07 for the 4-layer org_id defense rationale.',
      recommended: false,
    },
    messages: {
      'raw-service-role-client':
        'Raw createClient() with a SERVICE_ROLE_KEY argument is forbidden here. ' +
        'Only supabase/functions/_shared/supabase-server.ts may construct a service-role client. ' +
        'Wrap your query in withOrgScope(orgId, async (c) => ...) from with-org-scope.ts instead. ' +
        '(Phase 28 D-06 — V13-2a multi-tenant bypass prevention.)',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        // Only match createClient() calls
        if (
          !node.callee ||
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'createClient'
        ) {
          return;
        }

        // Need at least 2 arguments
        if (!node.arguments || node.arguments.length < 2) return;

        // Check second argument for SERVICE_ROLE_KEY pattern
        const secondArg = node.arguments[1];
        if (!isServiceRoleKeyArg(secondArg)) return;

        // Allowlist: supabase/functions/_shared/supabase-server.ts is the ONLY
        // authorized location for raw service-role client construction.
        // context.filename uses path separators from the OS — normalize to forward slashes.
        const filename = (context.filename ?? context.getFilename?.() ?? '').replace(/\\/g, '/');
        if (filename.endsWith('supabase/functions/_shared/supabase-server.ts')) return;

        context.report({ node, messageId: 'raw-service-role-client' });
      },
    };
  },
};
