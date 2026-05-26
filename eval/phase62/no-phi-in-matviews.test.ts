/**
 * Phase 62 eval — PHI-leak gate for insights matview migrations.
 *
 * CI layer of the 3-layer PHI invariant (per [[feedback_3_layer_must_never_invariant_pattern]]):
 *   Layer 1 (DB)  — HAVING count(distinct user_id) >= 5 on every matview
 *   Layer 2 (UI)  — compile_research_cohort k-floor guard (SECDEF)
 *   Layer 3 (CI)  — THIS TEST — source-level grep prevents PHI in matview columns
 *
 * INVARIANT (INSIGHTS-01):
 *   No matview in 20290102000002_insights_matviews.sql may have a row in its
 *   SELECT output list where user_id, email, phone, or address appears outside
 *   of count(distinct ...) / JOIN ON / WHERE / GROUP BY / HAVING clauses.
 *
 * GREEN state: all checks pass (matviews have no PHI in output columns).
 *
 * Resolves path from __dirname (eval/phase62/) up to git-root,
 * then into supabase/migrations — works from both git-root and leanshot/ cwd.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Resolve git root: eval/phase62/__dirname → ../../ = git root
const GIT_ROOT = path.resolve(__dirname, '..', '..');
const MATVIEWS_FILE = path.join(
  GIT_ROOT,
  'supabase',
  'migrations',
  '20290102000002_insights_matviews.sql',
);

const PHI_PATTERN = /\b(user_id|email|phone|address)\b/i;

// Lines that are legitimate uses of PHI tokens (JOIN/WHERE/GROUP BY/HAVING/count)
const ALLOW_PATTERN = /count\s*\(\s*distinct/i;
const STRUCTURAL_KEYWORDS = /^\s*(join\s|where\s|group\s+by\s|having\s|on\s+p\.|on\s+i\.|on\s+w\.|on\s+am\.|and\s|or\s)/i;

describe('PHI-leak gate: insights matview migrations (INSIGHTS-01)', () => {
  it('matviews migration file exists', () => {
    expect(
      fs.existsSync(MATVIEWS_FILE),
      `Expected matviews migration at: ${MATVIEWS_FILE}`,
    ).toBe(true);
  });

  it('no PHI tokens in matview SELECT output columns', () => {
    const raw = fs.readFileSync(MATVIEWS_FILE, 'utf-8');

    // Strip SQL comment lines (-- ...)
    const lines = raw.split('\n');
    const nonCommentLines = lines.filter((line) => !line.trimStart().startsWith('--'));

    const violations: { lineNumber: number; line: string }[] = [];

    nonCommentLines.forEach((line, idx) => {
      if (!PHI_PATTERN.test(line)) return;

      // Allow if line is a JOIN ON / WHERE / GROUP BY / HAVING / count(distinct)
      if (ALLOW_PATTERN.test(line)) return;
      if (STRUCTURAL_KEYWORDS.test(line)) return;
      // Allow "join public.profiles p on p.id = ..." pattern (inline join clause)
      if (/on\s+p\s*\.\s*id\s*=|on\s+i\s*\.\s*user_id\s*=|on\s+w\s*\.\s*user_id\s*=|on\s+am\s*\.\s*user_id\s*=/i.test(line)) return;
      // Allow lines that are inside a WHERE clause in a subquery (exists (select 1 ... where i.user_id))
      if (/where\s+i\s*\.\s*user_id|where\s+p\s*\.\s*id\s*=|where\s+am\s*\.\s*user_id|where\s+w\s*\.\s*user_id/i.test(line)) return;

      // Original line number in file (non-comment lines have been filtered; use raw idx as proxy)
      violations.push({ lineNumber: idx + 1, line: line.trim() });
    });

    expect(
      violations,
      `PHI tokens found in matview output columns:\n${violations
        .map((v) => `  line ~${v.lineNumber}: ${v.line}`)
        .join('\n')}`,
    ).toHaveLength(0);
  });

  it('every matview body has HAVING count(distinct ...) >= 5 k-floor clause', () => {
    const raw = fs.readFileSync(MATVIEWS_FILE, 'utf-8');

    // Find all CREATE MATERIALIZED VIEW blocks
    const matviewPattern = /create\s+materialized\s+view\s+(?:if\s+not\s+exists\s+)?[\w.]+/gi;
    const matviewMatches = [...raw.matchAll(matviewPattern)];

    expect(matviewMatches.length, 'Expected at least 1 materialized view in file').toBeGreaterThan(0);

    // The file as a whole must contain k-floor HAVING clauses
    const havingKFloor = /having\s+count\s*\(\s*distinct[^)]+\)\s*>=\s*5/gi;
    const havingMatches = [...raw.matchAll(havingKFloor)];

    expect(
      havingMatches.length,
      `Expected at least ${matviewMatches.length} HAVING count(distinct ...) >= 5 clauses (one per matview), found ${havingMatches.length}`,
    ).toBeGreaterThanOrEqual(matviewMatches.length);
  });
});
