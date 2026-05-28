/**
 * Phase 50 Plan 50-01 — rag_chunks enum + CHECK + dedup invariants.
 *
 * Verifies, against the live cloud DB, that:
 *   T1: rag_chunk_status enum has the 5 expected values
 *   T2: rag_reject_reason enum has the 6 expected values
 *   T3: CHECK constraint rejects status='rejected' WITHOUT reject_reason
 *   T4: CHECK constraint rejects status='retracted' WITHOUT retracted_at
 *   T5: dedup unique on (topic_id, source_id, content_hash) blocks duplicates
 *
 * Pattern: service_role client. Inserts use TEST_SLUG_PREFIX-tagged content_hash
 * and bypass RLS via service_role. afterAll cleans up by content_hash prefix.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const TEST_SLUG_PREFIX = `p50-tierchk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describeIfLive('Phase 50 Plan 50-01 — rag_chunks invariants', () => {
  const admin = getAdmin();
  let topicId: string;
  let sourceId: string;

  beforeAll(async () => {
    // Create a one-off topic + reuse an existing source for inserts
    const { data: topic, error: topicErr } = await admin
      .from('rag_topics')
      .insert({ query: `${TEST_SLUG_PREFIX}-topic`, tag: TEST_SLUG_PREFIX })
      .select('id')
      .single();
    if (topicErr) throw topicErr;
    topicId = topic!.id;

    const { data: src, error: srcErr } = await admin
      .from('rag_sources')
      .select('id')
      .limit(1)
      .single();
    if (srcErr) throw srcErr;
    sourceId = src!.id;
  });

  afterAll(async () => {
    // Cleanup: chunks cascade on topic delete; remove topic by prefix
    if (topicId) {
      await admin.from('rag_chunks').delete().eq('topic_id', topicId);
      await admin.from('rag_topics').delete().eq('id', topicId);
    }
  });

  it('rag_chunk_status enum has 5 expected values', async () => {
    const { data, error } = await admin
      .rpc('rag_mtd_spend_by_vendor')
      .then(
        () => ({ data: null, error: null }),
        () => ({ data: null, error: null }),
      )
      .catch(() => ({ data: null, error: null }));
    // Use direct SQL via supabase-js sql tag — fall back to executing via PostgREST view
    // since pg-meta isn't exposed; instead validate via attempting valid insert of each.
    void data;
    void error;

    const statuses = ['queued', 'approved', 'rejected', 'retracted', 're-queued'] as const;
    for (const status of statuses) {
      const insert: Record<string, unknown> = {
        topic_id: topicId,
        source_id: sourceId,
        canonical_url: `https://${TEST_SLUG_PREFIX}.test/${status}`,
        source_text_excerpt: `excerpt for ${status}`,
        summary: `summary for ${status}`,
        content_hash: `${TEST_SLUG_PREFIX}-status-${status}`,
        topic_tag: TEST_SLUG_PREFIX,
        source_tier: 'A',
        status,
      };
      if (status === 'rejected') insert.reject_reason = 'off-topic';
      if (status === 'retracted') insert.retracted_at = new Date().toISOString();

      const { error: insErr } = await admin.from('rag_chunks').insert(insert);
      expect(insErr, `status ${status} should be accepted`).toBeNull();
    }
  });

  it('rag_reject_reason enum has 6 expected values', async () => {
    const reasons = [
      'off-topic',
      'factually-wrong',
      'off-label',
      'low-quality',
      'duplicate',
      'safety-concern',
    ] as const;

    for (const reason of reasons) {
      const { error: insErr } = await admin.from('rag_chunks').insert({
        topic_id: topicId,
        source_id: sourceId,
        canonical_url: `https://${TEST_SLUG_PREFIX}.test/reason/${reason}`,
        source_text_excerpt: `excerpt for ${reason}`,
        summary: `summary for ${reason}`,
        content_hash: `${TEST_SLUG_PREFIX}-reason-${reason}`,
        topic_tag: TEST_SLUG_PREFIX,
        source_tier: 'B',
        status: 'rejected',
        reject_reason: reason,
      });
      expect(insErr, `reason ${reason} should be accepted`).toBeNull();
    }
  });

  it('CHECK: rejected chunk requires reject_reason', async () => {
    const { error: insErr } = await admin.from('rag_chunks').insert({
      topic_id: topicId,
      source_id: sourceId,
      canonical_url: `https://${TEST_SLUG_PREFIX}.test/no-reason`,
      source_text_excerpt: 'x',
      summary: 'x',
      content_hash: `${TEST_SLUG_PREFIX}-no-reason`,
      topic_tag: TEST_SLUG_PREFIX,
      source_tier: 'A',
      status: 'rejected',
      // reject_reason intentionally omitted
    });
    expect(insErr).not.toBeNull();
    expect(insErr?.message ?? '').toMatch(/check|constraint/i);
  });

  it('CHECK: retracted chunk requires retracted_at', async () => {
    const { error: insErr } = await admin.from('rag_chunks').insert({
      topic_id: topicId,
      source_id: sourceId,
      canonical_url: `https://${TEST_SLUG_PREFIX}.test/no-retracted-at`,
      source_text_excerpt: 'x',
      summary: 'x',
      content_hash: `${TEST_SLUG_PREFIX}-no-retracted-at`,
      topic_tag: TEST_SLUG_PREFIX,
      source_tier: 'A',
      status: 'retracted',
      // retracted_at intentionally omitted
    });
    expect(insErr).not.toBeNull();
    expect(insErr?.message ?? '').toMatch(/check|constraint/i);
  });

  it('dedup unique: cannot insert same (topic_id, source_id, content_hash) twice', async () => {
    const hash = `${TEST_SLUG_PREFIX}-dedup-${Math.random().toString(36).slice(2, 8)}`;
    const row = {
      topic_id: topicId,
      source_id: sourceId,
      canonical_url: `https://${TEST_SLUG_PREFIX}.test/dedup`,
      source_text_excerpt: 'x',
      summary: 'x',
      content_hash: hash,
      topic_tag: TEST_SLUG_PREFIX,
      source_tier: 'A' as const,
      status: 'queued' as const,
    };

    const { error: firstErr } = await admin.from('rag_chunks').insert(row);
    expect(firstErr).toBeNull();

    const { error: secondErr } = await admin.from('rag_chunks').insert(row);
    expect(secondErr).not.toBeNull();
    expect(secondErr?.message ?? '').toMatch(/duplicate|unique/i);
  });
});
