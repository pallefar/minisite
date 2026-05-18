/**
 * Phase 27 Plan 27-02 — Cohort rule-tree zod schema (CONTEXT D-05).
 *
 * Mirrors the verbatim header docblock pattern from leanshot/src/lib/page-builder/
 * block-schema.ts: a pure type-only + runtime-schema module imported by both the
 * UI builder (CohortRuleNode) and the server-call wrapper (api.ts), so the SAME
 * validation runs at every TS-boundary.
 *
 *   - `RuleField`  — 15-literal union mirrored from FIELD_ALLOWLIST.
 *   - `RuleOp`     — 9-literal union of allowed comparison ops.
 *   - `RuleLeaf`   — zod object for a single condition.
 *   - `RuleBranch` — zod lazy/recursive AND/OR branch (max 50 children).
 *   - `RuleNode`   — discriminated union (`op: 'and'|'or'` → branch, else leaf).
 *   - `MAX_DEPTH`  — 8 (CONTEXT + threat T-27-02-03).
 *   - `ruleTreeSchema` — top-level parser with `.superRefine()` depth-walk.
 *
 * Constraints (defense-in-depth layer #2):
 *   - Leaf `field` must be in FIELD_ALLOWLIST_SET (zod enum).
 *   - Tree depth ≤ 8 (refine-walked; reject ZodError).
 *   - Branch children ≤ 50 (DoS bound per T-27-02-03).
 *   - `is_null`/`is_not_null` leaves: value MUST be omitted/null.
 *   - `in` leaves: value MUST be a non-empty array.
 *   - All other ops: value MUST be a primitive (string|number|boolean).
 *
 * Per CONTEXT D-05 + D-06 + Pattern S8.
 */
import { z } from 'zod';
import { FIELD_ALLOWLIST, type RuleField } from './field-allowlist';

export type { RuleField } from './field-allowlist';
export { FIELD_ALLOWLIST } from './field-allowlist';

/** Hard ceiling on tree nesting depth (CONTEXT + threat T-27-02-03). */
export const MAX_DEPTH = 8;

/** Hard ceiling on per-branch children (DoS bound). */
export const MAX_CHILDREN = 50;

/** All ops supported by both the TS translator and the plpgsql validator. */
export const RULE_OPS = [
  '=',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  'in',
  'is_null',
  'is_not_null',
] as const;

export type RuleOp = (typeof RULE_OPS)[number];

/** Branch combinator ops — separate union so the discriminator works. */
export const BRANCH_OPS = ['and', 'or'] as const;
export type BranchOp = (typeof BRANCH_OPS)[number];

// ─── Leaf primitive value ──────────────────────────────────────────────────
// `=`, `!=`, `>`, `<`, `>=`, `<=` take a primitive.
// `in` takes a non-empty array of primitives.
// `is_null` and `is_not_null` take no value.
const leafPrimitive = z.union([z.string(), z.number(), z.boolean()]);

const leafBaseShape = {
  field: z.enum(FIELD_ALLOWLIST as readonly [RuleField, ...RuleField[]]),
};

const leafComparison = z.object({
  ...leafBaseShape,
  op: z.enum(['=', '!=', '>', '<', '>=', '<='] as const),
  value: leafPrimitive,
});

const leafIn = z.object({
  ...leafBaseShape,
  op: z.literal('in'),
  value: z.array(leafPrimitive).min(1),
});

const leafNullCheck = z.object({
  ...leafBaseShape,
  op: z.enum(['is_null', 'is_not_null'] as const),
  // value omitted; allow undefined/null both
  value: z.union([z.null(), z.undefined()]).optional(),
});

export const ruleLeafSchema = z.union([leafComparison, leafIn, leafNullCheck]);
export type RuleLeaf = z.infer<typeof ruleLeafSchema>;

// ─── Recursive branch ──────────────────────────────────────────────────────
// zod can't infer recursive types from `.lazy()` alone — we declare the
// TypeScript type up front and tell zod about it via `z.ZodType<RuleBranch>`.

export interface RuleBranch {
  readonly op: BranchOp;
  readonly children: readonly RuleNode[];
}

export type RuleNode = RuleLeaf | RuleBranch;

export const ruleBranchSchema: z.ZodType<RuleBranch> = z.lazy(() =>
  z.object({
    op: z.enum(BRANCH_OPS),
    children: z.array(ruleNodeSchema).min(1).max(MAX_CHILDREN),
  }),
);

export const ruleNodeSchema: z.ZodType<RuleNode> = z.lazy(() =>
  z.union([ruleLeafSchema, ruleBranchSchema]),
);

// ─── Depth walker (custom refine) ──────────────────────────────────────────

function walkDepth(node: RuleNode, currentDepth: number): number {
  if (!('children' in node)) return currentDepth;
  if (node.children.length === 0) return currentDepth;
  return Math.max(...node.children.map((c) => walkDepth(c, currentDepth + 1)));
}

/** Top-level cohort-rule-tree schema with depth-bound superRefine. */
export const ruleTreeSchema = ruleNodeSchema.superRefine((node, ctx) => {
  const depth = walkDepth(node, 1);
  if (depth > MAX_DEPTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Tree depth ${depth} exceeds MAX_DEPTH ${MAX_DEPTH}`,
    });
  }
});

/** Convenience: discriminator helper for renderers. */
export function isBranch(node: RuleNode): node is RuleBranch {
  return 'children' in node && Array.isArray((node as RuleBranch).children);
}

export function isLeaf(node: RuleNode): node is RuleLeaf {
  return !isBranch(node);
}
