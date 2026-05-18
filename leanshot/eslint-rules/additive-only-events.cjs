/**
 * ESLint custom rule: additive-only-events
 *
 * Phase 24 Plan 24-02 / TAXO-06 reconciliation (D-10).
 *
 * Enforces that changes to `src/lib/analytics/events.ts` are ADDITIVE ONLY:
 * - Adding a new event: OK
 * - Adding an optional field to existing payload: OK
 * - Removing a field: BLOCKED → messageId: event-payload-field-removed
 * - Changing a field's zod type: BLOCKED → messageId: event-payload-type-changed
 * - Renaming a field: BLOCKED (treat as remove + add)
 * - Comment/whitespace/reorder edits: no error (AST-based, not text diff)
 *
 * The rule compares the current `events.ts` text against the committed HEAD
 * version (via `git show HEAD:src/lib/analytics/events.ts`). For testability,
 * the git working directory can be overridden via `LEANSHOT_GIT_CWD` env var.
 *
 * First-commit case: if events.ts does not exist at HEAD (git show exits non-zero),
 * the rule returns without reporting — the first commit is allowed.
 */

'use strict';

const { execSync } = require('child_process');
const { resolve } = require('path');

// ---------------------------------------------------------------------------
// AST parsing helper
// ---------------------------------------------------------------------------

/**
 * Parse source text and return the Program AST node.
 * Uses @typescript-eslint/parser if available (handles TypeScript + `as const`).
 * Falls back to graceful no-op on parse failure.
 */
function parseSource(source) {
  try {
    const parser = require('@typescript-eslint/parser');
    return parser.parse(source, { jsx: false, range: true, loc: true });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Payload extraction helpers
// ---------------------------------------------------------------------------

/**
 * Walk an AST to find `export const EVENTS = { ... } as const`.
 * Returns the ObjectExpression for the EVENTS object literal, or null.
 */
function findEventsObject(program) {
  if (!program || !program.body) return null;
  for (const node of program.body) {
    // export const EVENTS = { ... } [as const satisfies ...]
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      const decl = node.declaration;
      if (decl.type === 'VariableDeclaration') {
        for (const vd of decl.declarations) {
          if (
            vd.id &&
            vd.id.type === 'Identifier' &&
            vd.id.name === 'EVENTS' &&
            vd.init
          ) {
            return unwrapAsConst(vd.init);
          }
        }
      }
    }
  }
  return null;
}

/**
 * Unwrap `{ ... } as const satisfies ...` or `{ ... } as const` → ObjectExpression.
 */
function unwrapAsConst(node) {
  if (!node) return null;
  if (node.type === 'ObjectExpression') return node;
  // TSAsExpression: `expr as TYPE`
  if (node.type === 'TSAsExpression') return unwrapAsConst(node.expression);
  // TSSatisfiesExpression: `expr satisfies TYPE`
  if (node.type === 'TSSatisfiesExpression') return unwrapAsConst(node.expression);
  return null;
}

/**
 * Given the EVENTS ObjectExpression, return a Map:
 *   eventName → Map<fieldName, zodMethodName>
 * e.g. signup_started → { source: 'string' }
 *
 * zodMethodName is the method called on z, e.g. 'string', 'number', 'enum', 'object'.
 */
function extractEventPayloads(eventsObject) {
  const result = new Map();
  if (!eventsObject || !eventsObject.properties) return result;

  for (const prop of eventsObject.properties) {
    if (prop.type !== 'Property') continue;
    const eventName = getPropertyKeyName(prop);
    if (!eventName) continue;

    const defObject = unwrapAsConst(prop.value);
    if (!defObject || defObject.type !== 'ObjectExpression') continue;

    // Find `payload: z.object({ ... })`
    const payloadProp = defObject.properties.find(
      p => p.type === 'Property' && getPropertyKeyName(p) === 'payload',
    );
    if (!payloadProp) continue;

    const fieldMap = extractPayloadFieldTypes(payloadProp.value);
    result.set(eventName, fieldMap);
  }
  return result;
}

/**
 * Extract field names + zod type names from a `z.object({ ... })` call expression.
 * Returns Map<fieldName, zodTypeName>.
 */
function extractPayloadFieldTypes(node) {
  const fields = new Map();
  if (!node) return fields;

  // z.object({ ... }) → CallExpression where callee is MemberExpression z.object
  const objNode = getZodObjectArg(node);
  if (!objNode || objNode.type !== 'ObjectExpression') return fields;

  for (const prop of objNode.properties) {
    if (prop.type !== 'Property') continue;
    const fieldName = getPropertyKeyName(prop);
    if (!fieldName) continue;

    // Get the zod type: could be z.string(), z.number(), z.enum([...]), z.string().optional(), etc.
    // We extract the BASE method name (e.g. "string", "number") by walking the call chain.
    const baseMethod = extractBaseZodMethodName(prop.value);
    fields.set(fieldName, baseMethod);
  }
  return fields;
}

/**
 * Unwrap `.optional()`, `.nullable()`, etc. to get the underlying `z.X(...)` call.
 * Returns the ObjectExpression argument of `z.object(...)` if found.
 */
function getZodObjectArg(node) {
  if (!node) return null;
  if (node.type === 'CallExpression') {
    // Could be z.object({...}) or z.object({...}).optional() etc.
    const callee = node.callee;
    if (
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      callee.object.name === 'z' &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'object'
    ) {
      return node.arguments[0] || null;
    }
    // Chain: z.object({...}).optional() → recurse on callee.object
    if (callee.type === 'MemberExpression') {
      return getZodObjectArg(callee.object);
    }
  }
  return null;
}

/**
 * Extract the base zod method name from a chained expression like:
 *   z.string().optional()  → 'string'
 *   z.enum(['a','b'])       → 'enum'
 *   z.number().positive()  → 'number'
 *   z.object({...})         → 'object'
 */
function extractBaseZodMethodName(node) {
  if (!node) return 'unknown';
  if (node.type === 'CallExpression') {
    const callee = node.callee;
    if (callee.type === 'MemberExpression') {
      const obj = callee.object;
      const method = callee.property;
      // z.X(...) — direct z method
      if (obj.type === 'Identifier' && obj.name === 'z' && method.type === 'Identifier') {
        return method.name;
      }
      // Chain: z.X(...).optional() — recurse to find z.X base
      return extractBaseZodMethodName(obj);
    }
  }
  return 'unknown';
}

/**
 * Extract the string key of a Property node.
 */
function getPropertyKeyName(prop) {
  if (!prop || !prop.key) return null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal') return String(prop.key.value);
  return null;
}

// ---------------------------------------------------------------------------
// ESLint rule definition
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PHI+AEM cross-check helper
// ---------------------------------------------------------------------------

/**
 * Walk the current AST to find the EVENTS object and check every event entry.
 * If an event has `phi: true` AND `aem_priority` set (any value), report a
 * phi-aem-conflict error on the aem_priority property node.
 *
 * Phase 33 D-08: PHI events cannot be forwarded to Meta CAPI.
 * This check runs on the current working-tree AST, not the HEAD diff,
 * so it fires even on first commit.
 *
 * Note: EventDef type enforces `phi: false`, so phi:true events live in
 * events.phi.ts — the cross-check is a belt+suspenders guard for any file
 * linted with this rule.
 *
 * @param {object} programNode - ESLint Program AST node (for fallback reporting)
 * @param {object} currAst - @typescript-eslint/parser AST of the current source
 * @param {object} context - ESLint rule context with .report()
 */
function checkPhiAemConflicts(programNode, currAst, context) {
  const eventsObj = findEventsObject(currAst);
  if (!eventsObj || !eventsObj.properties) return;

  for (const eventProp of eventsObj.properties) {
    if (eventProp.type !== 'Property') continue;
    const eventName = getPropertyKeyName(eventProp);
    if (!eventName) continue;

    const defObject = unwrapAsConst(eventProp.value);
    if (!defObject || defObject.type !== 'ObjectExpression') continue;

    let phiIsTrue = false;
    let aemPriorityNode = null;

    for (const prop of defObject.properties) {
      if (prop.type !== 'Property') continue;
      const key = getPropertyKeyName(prop);
      if (key === 'phi') {
        // Check if value is literal `true`
        const val = prop.value;
        if (val && val.type === 'Literal' && val.value === true) {
          phiIsTrue = true;
        }
      }
      if (key === 'aem_priority') {
        aemPriorityNode = prop;
      }
    }

    if (phiIsTrue && aemPriorityNode !== null) {
      // Extract the priority value for the error message
      const priorityVal =
        aemPriorityNode.value && aemPriorityNode.value.type === 'Literal'
          ? aemPriorityNode.value.value
          : '?';
      context.report({
        node: aemPriorityNode,
        messageId: 'phi-aem-conflict',
        data: { eventName, priority: String(priorityVal) },
      });
    }
  }
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce additive-only evolution of the events.ts registry (Phase 24 D-10/TAXO-06). ' +
        'Blocks payload field removal and type changes; allows additions. ' +
        'Phase 33 D-08: blocks aem_priority on phi:true events (PHI guardrail).',
    },
    messages: {
      'event-payload-field-removed':
        'Event "{{eventName}}" had payload field "{{fieldName}}" removed. ' +
        'Event payload schema is additive-only (Phase 24 D-10/TAXO-06). ' +
        'Keep the field (mark deprecated in description instead).',
      'event-payload-type-changed':
        'Event "{{eventName}}" payload field "{{fieldName}}" changed type ' +
        'from "{{prevType}}" to "{{currType}}". ' +
        'Event payload schema is additive-only (Phase 24 D-10/TAXO-06). ' +
        'Add a new optional field with the new type instead.',
      'phi-aem-conflict':
        'Event "{{eventName}}" has phi:true but also aem_priority={{priority}}. ' +
        'PHI events cannot be forwarded to Meta CAPI (D-08). ' +
        'Remove aem_priority or move event out of PHI scope.',
    },
    schema: [],
  },

  create(context) {
    return {
      'Program:exit'(programNode) {
        // Only act on src/lib/analytics/events.ts
        const filename = context.filename ?? context.getFilename?.() ?? '';
        if (!filename.endsWith('src/lib/analytics/events.ts')) return;

        // ---------------------------------------------------------------------------
        // Phase 33 D-08: PHI+AEM cross-check (structural invariant — runs always,
        // even when there is no HEAD version to diff against).
        // ---------------------------------------------------------------------------
        checkPhiAemConflicts(programNode, programNode, context);

        // Get current source text
        const currentSource =
          (context.sourceCode?.text) ??
          (context.getSourceCode?.()?.text) ??
          '';

        // Get the git cwd (testable via env var)
        const gitCwd = process.env.LEANSHOT_GIT_CWD ?? resolve(__dirname, '..');

        // Read the committed HEAD version
        let headSource;
        try {
          headSource = execSync('git show HEAD:src/lib/analytics/events.ts', {
            cwd: gitCwd,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          // File doesn't exist at HEAD (first commit) — allow freely
          return;
        }

        if (!headSource || !headSource.trim()) return;

        // Parse both ASTs
        const prevAst = parseSource(headSource);
        const currAst = parseSource(currentSource);

        if (!prevAst || !currAst) return;

        // Extract event payload maps
        const prevEventsObj = findEventsObject(prevAst);
        const currEventsObj = findEventsObject(currAst);

        if (!prevEventsObj || !currEventsObj) return;

        const prevPayloads = extractEventPayloads(prevEventsObj);
        const currPayloads = extractEventPayloads(currEventsObj);

        // Compare: for each event in HEAD, check current has all fields with same types
        for (const [eventName, prevFields] of prevPayloads) {
          const currFields = currPayloads.get(eventName);
          if (!currFields) {
            // Entire event removed — but we only report field-level; event removal is a future rule
            continue;
          }

          for (const [fieldName, prevType] of prevFields) {
            if (!currFields.has(fieldName)) {
              // Field removed
              context.report({
                node: programNode,
                messageId: 'event-payload-field-removed',
                data: { eventName, fieldName },
              });
            } else {
              const currType = currFields.get(fieldName);
              if (prevType !== currType && prevType !== 'unknown' && currType !== 'unknown') {
                // Type changed
                context.report({
                  node: programNode,
                  messageId: 'event-payload-type-changed',
                  data: { eventName, fieldName, prevType, currType },
                });
              }
            }
          }
        }
      },
    };
  },
};
