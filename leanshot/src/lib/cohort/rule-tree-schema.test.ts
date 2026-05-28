/**
 * Phase 27 Plan 27-02 — rule-tree-schema unit tests.
 *
 * Covers the zod parser contract: enum-bound `field`, op-discriminated value
 * shape, MAX_DEPTH=8, MAX_CHILDREN=50.
 */
import { describe, expect, it } from 'vitest';
import {
  FIELD_ALLOWLIST,
  MAX_CHILDREN,
  MAX_DEPTH,
  RULE_OPS,
  type RuleNode,
  ruleTreeSchema,
} from '@/lib/cohort/rule-tree-schema';

describe('rule-tree-schema (Phase 27 Plan 27-02)', () => {
  it('(a) parses a valid simple leaf', () => {
    const tree = { field: 'tier', op: '=', value: 'pro' };
    const parsed = ruleTreeSchema.parse(tree);
    expect(parsed).toEqual(tree);
  });

  it('(b) parses a valid nested AND/OR tree', () => {
    const tree: RuleNode = {
      op: 'and',
      children: [
        { field: 'tier', op: '=', value: 'free' },
        {
          op: 'or',
          children: [
            { field: 'days_since_signup', op: '>', value: 7 },
            { field: 'country', op: '=', value: 'US' },
          ],
        },
      ],
    };
    expect(ruleTreeSchema.parse(tree)).toEqual(tree);
  });

  it("(c) rejects a leaf with field='unknown_field'", () => {
    const tree = { field: 'unknown_field', op: '=', value: 'x' };
    const result = ruleTreeSchema.safeParse(tree);
    expect(result.success).toBe(false);
  });

  it('(d) rejects a tree deeper than MAX_DEPTH', () => {
    // Build a chain of nested `and` branches one deeper than MAX_DEPTH.
    let node: RuleNode = { field: 'tier', op: '=', value: 'pro' };
    for (let i = 0; i < MAX_DEPTH; i++) {
      node = { op: 'and', children: [node] };
    }
    // Now total depth = MAX_DEPTH + 1
    const result = ruleTreeSchema.safeParse(node);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message.includes(`exceeds MAX_DEPTH ${MAX_DEPTH}`)),
      ).toBe(true);
    }
  });

  it('(e) rejects a branch with more than MAX_CHILDREN children', () => {
    const children: RuleNode[] = [];
    for (let i = 0; i < MAX_CHILDREN + 1; i++) {
      children.push({ field: 'tier', op: '=', value: 'free' });
    }
    const tree: RuleNode = { op: 'and', children };
    const result = ruleTreeSchema.safeParse(tree);
    expect(result.success).toBe(false);
  });

  it('(f) parses all 9 op literals', () => {
    // For each op, build a leaf that the schema should accept.
    for (const op of RULE_OPS) {
      let leaf: unknown;
      if (op === 'in') {
        leaf = { field: 'tier', op, value: ['free', 'pro'] };
      } else if (op === 'is_null' || op === 'is_not_null') {
        leaf = { field: 'has_org', op };
      } else {
        leaf = { field: 'days_since_signup', op, value: 1 };
      }
      const result = ruleTreeSchema.safeParse(leaf);
      expect(result.success, `op=${op}`).toBe(true);
    }
  });

  it('(g) FIELD_ALLOWLIST is exactly 15 unique entries', () => {
    expect(FIELD_ALLOWLIST.length).toBe(15);
    expect(new Set<string>(FIELD_ALLOWLIST).size).toBe(15);
  });

  it("(h) rejects 'in' op with an empty array", () => {
    const tree = { field: 'tier', op: 'in', value: [] };
    const result = ruleTreeSchema.safeParse(tree);
    expect(result.success).toBe(false);
  });
});
