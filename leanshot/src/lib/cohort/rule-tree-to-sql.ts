/**
 * Phase 27 Plan 27-02 — Recursive rule-tree → parameterized SQL translator.
 *
 * Emits a SQL WHERE fragment (no `WHERE` keyword) plus a parallel `params`
 * array. The translator NEVER inlines user-supplied values into the SQL string
 * — values always flow through numbered placeholders (`$1`, `$2`, ...). This
 * is the load-bearing mitigation for threat T-27-02-01 (SQL injection via
 * rule.value); unit-test (f) in rule-tree-to-sql.test.ts asserts the malicious
 * string ends up in `params[0]` verbatim and never inside `sql`.
 *
 * Output shape:
 *   { sql: '(p.tier = $1 AND p.country = $2)', params: ['pro', 'US'], nextOffset: 2 }
 *
 * Each `field` maps to a SQL expression via FIELD_SQL_EXPR — the table alias
 * is `p` and columns are read from the `cohort_profile_view` view (migration
 * 10) which exposes all 15 fields with null-coalesced fallbacks for columns
 * that don't yet exist on `public.profiles` (active_streak_days pre-P35,
 * has_org pre-P28, etc.). Mismatch between FIELD_ALLOWLIST and FIELD_SQL_EXPR
 * is impossible at TS-compile time because Record<RuleField, ...> exhaustively
 * keys on the literal union.
 *
 * Per CONTEXT D-05 + Pattern S8.
 */
import type { RuleField } from './field-allowlist';
import {
  isBranch,
  isLeaf,
  type RuleBranch,
  type RuleLeaf,
  type RuleNode,
} from './rule-tree-schema';

/**
 * field → SQL expression that runs against the `cohort_profile_view` view
 * (aliased `p` by the rebuild routine). Each expression is a column reference
 * (NOT a function call on user data) — the only user-controlled bit is the
 * comparison value, which always flows through a numbered placeholder.
 */
export const FIELD_SQL_EXPR: Record<RuleField, string> = {
  tier: 'p.tier',
  role: 'p.role',
  days_since_signup: 'p.days_since_signup',
  days_since_last_login: 'p.days_since_last_login',
  total_paid_amount_cents: 'p.total_paid_amount_cents',
  active_streak_days: 'p.active_streak_days',
  has_active_subscription: 'p.has_active_subscription',
  signup_source: 'p.signup_source',
  country: 'p.country',
  language: 'p.language',
  has_org: 'p.has_org',
  has_completed_onboarding: 'p.has_completed_onboarding',
  is_affiliate: 'p.is_affiliate',
  anomaly_flagged: 'p.anomaly_flagged',
  account_state: 'p.account_state',
};

export interface CompiledSql {
  /** SQL WHERE fragment WITHOUT the leading `WHERE` keyword. */
  sql: string;
  /** Positional params, in placeholder order ($1 = params[0], etc). */
  params: unknown[];
  /** Next free placeholder number (caller can chain). */
  nextOffset: number;
}

/**
 * Recursive translator. `paramOffset` is the number of placeholders already
 * consumed by an outer caller (so a chained translator can pick up at $N+1).
 * Top-level callers pass 0 (the default).
 */
export function ruleTreeToSql(node: RuleNode, paramOffset = 0): CompiledSql {
  if (isLeaf(node)) {
    return leafToSql(node, paramOffset);
  }
  if (isBranch(node)) {
    return branchToSql(node, paramOffset);
  }
  // Unreachable if input was schema-parsed first.
  throw new Error('ruleTreeToSql: node is neither leaf nor branch');
}

function leafToSql(leaf: RuleLeaf, paramOffset: number): CompiledSql {
  const col = FIELD_SQL_EXPR[leaf.field];
  if (!col) {
    // Schema-parse should prevent this, but defense-in-depth.
    throw new Error(`ruleTreeToSql: unknown field '${leaf.field}'`);
  }

  const op = leaf.op;

  // Null-check ops emit no placeholder + no params entry.
  if (op === 'is_null') {
    return { sql: `${col} IS NULL`, params: [], nextOffset: paramOffset };
  }
  if (op === 'is_not_null') {
    return { sql: `${col} IS NOT NULL`, params: [], nextOffset: paramOffset };
  }

  // `in` op: value is a non-empty array → ANY($N::<type>[])
  if (op === 'in') {
    const value = leaf.value;
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`ruleTreeToSql: 'in' requires non-empty array value`);
    }
    const placeholder = paramOffset + 1;
    const elementType = arrayPgType(value);
    return {
      sql: `${col} = ANY($${placeholder}::${elementType}[])`,
      params: [value],
      nextOffset: placeholder,
    };
  }

  // All other comparison ops: emit `col OP $N` with a single placeholder.
  const placeholder = paramOffset + 1;
  return {
    sql: `${col} ${op} $${placeholder}`,
    params: [leaf.value],
    nextOffset: placeholder,
  };
}

function branchToSql(branch: RuleBranch, paramOffset: number): CompiledSql {
  if (branch.children.length === 0) {
    throw new Error(`ruleTreeToSql: branch '${branch.op}' has zero children`);
  }
  const joiner = branch.op === 'and' ? ' AND ' : ' OR ';
  const parts: string[] = [];
  const params: unknown[] = [];
  let offset = paramOffset;
  for (const child of branch.children) {
    const compiled = ruleTreeToSql(child, offset);
    parts.push(compiled.sql);
    params.push(...compiled.params);
    offset = compiled.nextOffset;
  }
  return {
    sql: `(${parts.join(joiner)})`,
    params,
    nextOffset: offset,
  };
}

/** Pick the Postgres element-type cast for an `in` value array. */
function arrayPgType(values: unknown[]): string {
  const first = values[0];
  if (typeof first === 'number') return 'numeric';
  if (typeof first === 'boolean') return 'boolean';
  return 'text';
}
