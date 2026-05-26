/**
 * Phase 62 eval — 2-person review rule (INSIGHTS-07).
 *
 * Source-level assertion: publish_research RPC in migration
 * 20290102000006_insights_secdef_rpcs.sql MUST contain:
 *   1. Literal substring 'SELF_REVIEW_REJECTED' (UI toast matches on this)
 *   2. 'v_created_by' variable (captures publication author for comparison)
 *   3. 'auth.uid()' call (captures reviewer identity)
 *   4. 'FOR UPDATE' row lock (T-62-02-02 race condition mitigation)
 *
 * This is the CI (third) layer of the 3-layer 2-person rule invariant:
 *   Layer 1 (DB)  — publish_research raises SELF_REVIEW_REJECTED when auth.uid() = created_by
 *   Layer 2 (UI)  — Publish button fully removed from DOM when isSelfCreated (Plan 62-05)
 *   Layer 3 (CI)  — THIS TEST — source-level grep enforces invariant on every PR
 *
 * Live execute-as-different-user RPC test is deferred to 62-08 close-out smoke
 * (requires live Supabase instance with two distinct admin sessions).
 *
 * RED state before Task 2 creates the migration: file does not exist → test fails.
 * GREEN state after Task 2: all assertions pass.
 *
 * Resolves path from __dirname (eval/phase62/) → ../../ = git root.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const GIT_ROOT = path.resolve(__dirname, '..', '..');
const SECDEF_RPCS_FILE = path.join(
  GIT_ROOT,
  'supabase',
  'migrations',
  '20290102000006_insights_secdef_rpcs.sql',
);

describe('publish_research 2-person rule (INSIGHTS-07)', () => {
  it('SECDEF RPCs migration file exists', () => {
    // This test is RED until Task 2 creates the migration.
    expect(
      fs.existsSync(SECDEF_RPCS_FILE),
      `Migration does not exist yet: ${SECDEF_RPCS_FILE}\n` +
        'RED state expected before Task 2 (publish_research SECDEF RPCs) is executed.',
    ).toBe(true);
  });

  it('publish_research contains SELF_REVIEW_REJECTED literal string', () => {
    const body = fs.readFileSync(SECDEF_RPCS_FILE, 'utf-8');
    expect(body).toContain('SELF_REVIEW_REJECTED');
  });

  it('publish_research declares v_created_by variable', () => {
    const body = fs.readFileSync(SECDEF_RPCS_FILE, 'utf-8');
    expect(body).toMatch(/v_created_by\s+uuid/i);
  });

  it('publish_research compares v_created_by with auth.uid()', () => {
    const body = fs.readFileSync(SECDEF_RPCS_FILE, 'utf-8');
    expect(body).toMatch(/v_created_by\s*=\s*auth\.uid\(\)/i);
  });

  it('publish_research uses FOR UPDATE row lock (race-condition mitigation T-62-02-02)', () => {
    const body = fs.readFileSync(SECDEF_RPCS_FILE, 'utf-8');
    expect(body).toMatch(/for\s+update/i);
  });

  it('publish_research inserts into public.rag_chunks (INSIGHTS-09 RAG feedback loop)', () => {
    const body = fs.readFileSync(SECDEF_RPCS_FILE, 'utf-8').toLowerCase();
    expect(body).toContain('insert into public.rag_chunks');
  });

  it('publish_research resolves leanshot_research rag_sources row (source_type lookup)', () => {
    const body = fs.readFileSync(SECDEF_RPCS_FILE, 'utf-8');
    expect(body).toMatch(/source_type\s*=\s*'leanshot_research'/i);
  });

  it('migration contains rag_topics seed with tag=leanshot_research', () => {
    const body = fs.readFileSync(SECDEF_RPCS_FILE, 'utf-8');
    expect(body).toMatch(/tag\s*=?\s*'leanshot_research'/i);
  });

  it('migration contains additive ALTER TABLE for markdown_body column', () => {
    const body = fs.readFileSync(SECDEF_RPCS_FILE, 'utf-8');
    expect(body).toMatch(/alter\s+table\s+public\.research_publications\s+add\s+column\s+if\s+not\s+exists\s+markdown_body/i);
  });
});
