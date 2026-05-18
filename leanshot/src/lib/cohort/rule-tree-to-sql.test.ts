/**
 * Phase 27 Plan 27-02 — rule-tree-to-sql unit tests.
 *
 * Covers the translator contract: per-op SQL fragment shape, parameterized
 * output (no user value ever inlined into SQL), correct param-offset
 * accounting across nested branches, and the load-bearing SQL-injection
 * probe (threat T-27-02-01 mitigation).
 */
import { describe, expect, it } from 'vitest';
import type { RuleNode } from '@/lib/cohort/rule-tree-schema';
import { ruleTreeToSql } from '@/lib/cohort/rule-tree-to-sql';

describe('rule-tree-to-sql (Phase 27 Plan 27-02)', () => {
  it("(a) leaf field='tier' op='=' value='pro'", () => {
    const out = ruleTreeToSql({ field: 'tier', op: '=', value: 'pro' });
    expect(out.sql).toBe('p.tier = $1');
    expect(out.params).toEqual(['pro']);
    expect(out.nextOffset).toBe(1);
  });

  it("(b) leaf op='is_null' emits no placeholder", () => {
    const out = ruleTreeToSql({ field: 'has_org', op: 'is_null' });
    expect(out.sql).toBe('p.has_org IS NULL');
    expect(out.params).toEqual([]);
    expect(out.nextOffset).toBe(0);
  });

  it("(c) leaf op='in' value=['free','pro'] emits ANY($1::text[])", () => {
    const out = ruleTreeToSql({ field: 'tier', op: 'in', value: ['free', 'pro'] });
    expect(out.sql).toBe('p.tier = ANY($1::text[])');
    expect(out.params).toEqual([['free', 'pro']]);
    expect(out.nextOffset).toBe(1);
  });

  it('(d) branch AND with 2 leaves', () => {
    const tree: RuleNode = {
      op: 'and',
      children: [
        { field: 'tier', op: '=', value: 'free' },
        { field: 'country', op: '=', value: 'US' },
      ],
    };
    const out = ruleTreeToSql(tree);
    expect(out.sql).toBe('(p.tier = $1 AND p.country = $2)');
    expect(out.params).toEqual(['free', 'US']);
    expect(out.nextOffset).toBe(2);
  });

  it('(e) nested OR-of-ANDs depth 3 → correct parens + correct param offsets', () => {
    const tree: RuleNode = {
      op: 'or',
      children: [
        {
          op: 'and',
          children: [
            { field: 'tier', op: '=', value: 'free' },
            { field: 'days_since_signup', op: '>', value: 7 },
          ],
        },
        {
          op: 'and',
          children: [
            { field: 'tier', op: '=', value: 'pro' },
            { field: 'has_active_subscription', op: '=', value: true },
          ],
        },
      ],
    };
    const out = ruleTreeToSql(tree);
    expect(out.sql).toBe(
      '((p.tier = $1 AND p.days_since_signup > $2) OR (p.tier = $3 AND p.has_active_subscription = $4))',
    );
    expect(out.params).toEqual(['free', 7, 'pro', true]);
    expect(out.nextOffset).toBe(4);
  });

  it("(f) SQL injection probe: value=\"'; DROP TABLE--\" ends up in params, not SQL", () => {
    const malicious = "'; DROP TABLE profiles; --";
    const out = ruleTreeToSql({ field: 'tier', op: '=', value: malicious });
    expect(out.sql).toBe('p.tier = $1');
    expect(out.sql).not.toContain('DROP');
    expect(out.sql).not.toContain(';');
    expect(out.params).toEqual([malicious]);
  });

  it("(g) leaf op='>=' value=100 → numeric placeholder", () => {
    const out = ruleTreeToSql({
      field: 'total_paid_amount_cents',
      op: '>=',
      value: 100,
    });
    expect(out.sql).toBe('p.total_paid_amount_cents >= $1');
    expect(out.params).toEqual([100]);
  });

  it("(h) leaf op='is_not_null' emits IS NOT NULL", () => {
    const out = ruleTreeToSql({ field: 'has_org', op: 'is_not_null' });
    expect(out.sql).toBe('p.has_org IS NOT NULL');
    expect(out.params).toEqual([]);
    expect(out.nextOffset).toBe(0);
  });
});
