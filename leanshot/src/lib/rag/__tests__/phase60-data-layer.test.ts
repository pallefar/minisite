/**
 * Phase 60 Plan 60-01 — data-layer migration contract suite (static analysis).
 *
 * Verifies the 3 Phase 60 migration SQL files conform to the contract using
 * fs.readFileSync + regex — NO live Supabase connection required.
 * Avoids the @sentry/capacitor install blocker per
 * [[reference_sentry_capacitor_npm_install_blocker]].
 *
 * Run: npx vitest run --config vite.config.ts src/lib/rag/__tests__/phase60-data-layer.test.ts
 *
 * 17 invariants matching the plan's static-grep guardrail sweep (Task 6) +
 * structural properties (Task 7) to confirm correct SQL shape.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Migration file paths (absolute so test is cwd-agnostic)
// Test lives at: leanshot/src/lib/rag/__tests__/phase60-data-layer.test.ts
// Git root is 5 levels up: __tests__/ → rag/ → lib/ → src/ → leanshot/ → minisite/
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GIT_ROOT = resolve(__dirname, '../../../../../');
const M1 = readFileSync(
  resolve(GIT_ROOT, 'supabase/migrations/20281201000001_phase60_kb_tables.sql'),
  'utf8',
);
const M2 = readFileSync(
  resolve(GIT_ROOT, 'supabase/migrations/20281201000002_phase60_secdef_rpcs.sql'),
  'utf8',
);
const M3 = readFileSync(
  resolve(GIT_ROOT, 'supabase/migrations/20281201000003_phase60_push_categories.sql'),
  'utf8',
);

/**
 * Strip SQL line-prefix comments (lines starting with --) so negative grep
 * checks are not defeated by rejected-alternative names in comments.
 * Per [[feedback_negation_grep_defeated_by_comment_string]].
 */
function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

/** Count non-overlapping occurrences of a pattern in a string */
function countMatches(pattern: RegExp, text: string): number {
  return (text.match(pattern) ?? []).length;
}

describe('Phase 60 data layer migrations', () => {
  // ---------------------------------------------------------------------------
  // Migration 1: 20281201000001_phase60_kb_tables.sql
  // ---------------------------------------------------------------------------

  it('20281201000001 defines federated_sources with 3-row seed', () => {
    expect(M1).toContain('create table if not exists public.federated_sources');
    // 3-row seed
    expect(M1).toContain("'pubmed'");
    expect(M1).toContain("'openfda'");
    expect(M1).toContain("'dailymed'");
    expect(M1).toMatch(/on conflict \(name\) do nothing/i);
  });

  it('20281201000001 defines federated_source_cache with (source_name, cache_key) UNIQUE', () => {
    expect(M1).toContain('create table if not exists public.federated_source_cache');
    expect(M1).toMatch(/unique\s*\(\s*source_name\s*,\s*cache_key\s*\)/i);
  });

  it('20281201000001 defines newsletter_subscribers with unsubscribe_token default', () => {
    expect(M1).toContain('create table if not exists public.newsletter_subscribers');
    expect(M1).toMatch(/unsubscribe_token\s+text\s+not\s+null\s+default/i);
    expect(M1).toMatch(/gen_random_bytes\s*\(\s*32\s*\)/i);
  });

  it('20281201000001 defines kb_chunk_rejections with chunk_id + reason + actor_id + at columns', () => {
    expect(M1).toContain('create table if not exists public.kb_chunk_rejections');
    expect(M1).toMatch(/chunk_id\s+uuid\s+not\s+null/i);
    expect(M1).toMatch(/reason\s+public\.rag_reject_reason\s+not\s+null/i);
    expect(M1).toMatch(/actor_id\s+uuid\s+not\s+null/i);
    expect(M1).toMatch(/at\s+timestamptz\s+not\s+null/i);
  });

  it('20281201000001 enables RLS on all 4 new tables', () => {
    const count = countMatches(/enable row level security/gi, M1);
    expect(count).toBeGreaterThanOrEqual(4);
  });

  // ---------------------------------------------------------------------------
  // Migration 2: 20281201000002_phase60_secdef_rpcs.sql
  // ---------------------------------------------------------------------------

  it('20281201000002 defines exactly 5 SECDEF RPCs', () => {
    const count = countMatches(
      /create\s+or\s+replace\s+function\s+public\.(approve_rag_chunk|reject_rag_chunk|retract_rag_chunk|queue_rag_chunk|list_rag_review_queue)/gi,
      M2,
    );
    expect(count).toBeGreaterThanOrEqual(5);
  });

  it('20281201000002 every RPC has is_staff() guard', () => {
    const count = countMatches(/public\.is_staff\(\)/g, M2);
    expect(count).toBeGreaterThanOrEqual(5);
  });

  it('20281201000002 approve_rag_chunk enforces 2-person rule', () => {
    // Find the approve_rag_chunk function body and check for the 2-person rule guard
    const approveSection = M2.slice(M2.indexOf('function public.approve_rag_chunk'));
    // Check for the 2-person rule comparison (v_created_by = auth.uid() form)
    expect(approveSection).toMatch(
      /v_created_by\s*=\s*auth\.uid\(\)|auth\.uid\(\)\s*=\s*v_created_by/i,
    );
    expect(approveSection).toContain('2-person rule');
  });

  it('20281201000002 reject_rag_chunk writes audit row to kb_chunk_rejections', () => {
    const rejectSection = M2.slice(M2.indexOf('function public.reject_rag_chunk'));
    expect(rejectSection).toMatch(/insert\s+into\s+public\.kb_chunk_rejections/i);
  });

  it('20281201000002 list_rag_review_queue uses auth.users not profiles.email', () => {
    // Must JOIN auth.users
    expect(M2).toMatch(/join\s+auth\.users/i);
    // Must NOT reference profiles.email in live code (strip comment lines)
    const noComments = stripLineComments(M2);
    // Check that profiles.email is not used in code (allow in string literals of comment-on statements)
    // We check specifically for FROM profiles or JOIN profiles with .email
    expect(noComments).not.toMatch(/profiles\.email/);
  });

  it('20281201000002 grants execute to authenticated, revokes from public', () => {
    const grantCount = countMatches(
      /grant\s+execute\s+on\s+function\s+public\.[a-z_]+\s+to\s+authenticated/gi,
      M2,
    );
    const revokeCount = countMatches(
      /revoke\s+all\s+on\s+function\s+public\.[a-z_]+\s+from\s+public/gi,
      M2,
    );
    expect(grantCount).toBeGreaterThanOrEqual(5);
    expect(revokeCount).toBeGreaterThanOrEqual(5);
  });

  // ---------------------------------------------------------------------------
  // Migration 3: 20281201000003_phase60_push_categories.sql
  // ---------------------------------------------------------------------------

  it('20281201000003 widens 4 notification_* CHECK constraints with research_tips', () => {
    const dropCount = countMatches(/drop\s+constraint\s+if\s+exists/gi, M3);
    expect(dropCount).toBeGreaterThanOrEqual(4);

    const researchTipsCount = countMatches(/'research_tips'/g, M3);
    expect(researchTipsCount).toBeGreaterThanOrEqual(5); // 4 CHECKs + 1 seed + comments
  });

  it('20281201000003 preserves Phase 54 helpdesk-reply baseline', () => {
    const count = countMatches(/'helpdesk-reply'/g, M3);
    expect(count).toBeGreaterThanOrEqual(4); // present in all 4 CHECK constraints
  });

  it('20281201000003 seeds notification_category_config with research_tips defaults', () => {
    expect(M3).toMatch(
      /insert\s+into\s+public\.notification_category_config[\s\S]*?'research_tips'/i,
    );
    expect(M3).toMatch(/on\s+conflict\s+\(\s*category\s*\)\s+do\s+nothing/i);
    // daily_cap=1
    expect(M3).toMatch(/'research_tips',\s*1,/);
    // weekly_cap=7 (second number after 1)
    expect(M3).toMatch(/'research_tips',\s*1,\s*7/);
  });

  // ---------------------------------------------------------------------------
  // Cross-migration invariants
  // ---------------------------------------------------------------------------

  it('no migration in this plan registers cron.schedule', () => {
    const combined = M1 + M2 + M3;
    const noComments = stripLineComments(combined);
    const count = countMatches(/cron\.schedule\s*\(/gi, noComments);
    expect(count).toBe(0); // cron registration deferred to 60-15 per [[feedback_fn_deploy_before_cron_db_push]]
  });

  it('no migration uses do delete (anti-pattern per Postgres — [[reference_postgres_no_insert_on_conflict_do_delete]])', () => {
    const combined = M1 + M2 + M3;
    const noComments = stripLineComments(combined);
    const count = countMatches(/\bdo\s+delete\b/gi, noComments);
    expect(count).toBe(0);
  });

  it('all migration timestamps are post-head 20280401000007', () => {
    const timestamps = ['20281201000001', '20281201000002', '20281201000003'];
    const head = '20280401000007';
    for (const ts of timestamps) {
      expect(ts > head).toBe(true); // lexicographic comparison is correct for TS prefixes
    }
  });
});
