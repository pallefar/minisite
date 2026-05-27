/**
 * Phase 50 Plan 50-02 — soft-delete semantics (D-13).
 *
 * Soft-deleted topics:
 *   - Disappear from `WHERE deleted_at IS NULL` filtered lists.
 *   - Are revealed by `WHERE deleted_at IS NOT NULL`.
 *   - Their child rag_chunks remain in place (no cascade — preserves audit
 *     trail and historical retrievals if a topic is later restored).
 *
 * One retrieval test is DEFERRED to Plan 50-07 (retrieval Edge Fn does not
 * exist yet). Skipped per [[reference_vitest_skip_fixme]].
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUserAccessToken } from '../../../../tests/rls/helpers/admin-session';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const TEST_SLUG_PREFIX = `p50-soft-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;

describeIfLive('Phase 50 Plan 50-02 — soft-delete semantics', () => {
  let admin: SupabaseClient;
  let superClient: SupabaseClient;
  const createdUserIds: string[] = [];
  let topicId: string;
  let sourceId: string;
  let chunkId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const password = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;
    const email = `${TEST_SLUG_PREFIX}-super@leanshot.test`;
    const res = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (res.error) throw res.error;
    createdUserIds.push(res.data.user!.id);
    await admin.from('profiles').upsert({ id: res.data.user!.id, admin_role: 'superadmin' });
    const token = await getUserAccessToken(email);
    superClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        storageKey: `${TEST_SLUG_PREFIX}-super`,
      },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // Seed: 1 topic + 1 published chunk on the topic via service_role.
    const { data: topic, error: topicErr } = await admin
      .from('rag_topics')
      .insert({ query: `${TEST_SLUG_PREFIX}-soft-topic`, tag: TEST_SLUG_PREFIX })
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

    const { data: chunk, error: chErr } = await admin
      .from('rag_chunks')
      .insert({
        topic_id: topicId,
        source_id: sourceId,
        canonical_url: `https://${TEST_SLUG_PREFIX}.test/c`,
        source_text_excerpt: 'x',
        summary: 'x',
        content_hash: `${TEST_SLUG_PREFIX}-c-1`,
        topic_tag: TEST_SLUG_PREFIX,
        source_tier: 'A',
        status: 'approved',
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (chErr) throw chErr;
    chunkId = chunk!.id;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from('rag_topics').delete().like('query', `${TEST_SLUG_PREFIX}%`);
    for (const uid of createdUserIds) {
      await admin.auth.admin.deleteUser(uid).catch(() => undefined);
    }
  });

  it('soft-deleted topic excluded from default list', async () => {
    const { error: delErr } = await superClient.rpc('rag_topic_soft_delete', {
      p_topic_id: topicId,
    });
    expect(delErr).toBeNull();
    const { data, error } = await superClient
      .from('rag_topics')
      .select('id')
      .eq('id', topicId)
      .is('deleted_at', null);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it('soft-deleted topic chunks remain in rag_chunks', async () => {
    const { data, error } = await admin
      .from('rag_chunks')
      .select('id')
      .eq('id', chunkId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
  });

  it('restore makes topic visible again', async () => {
    const { error: restErr } = await superClient.rpc('rag_topic_restore', {
      p_topic_id: topicId,
    });
    expect(restErr).toBeNull();
    const { data, error } = await superClient
      .from('rag_topics')
      .select('id')
      .eq('id', topicId)
      .is('deleted_at', null);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
  });

  // DEFERRED: retrieval Edge Fn ignores soft-deleted topics. Lands in Plan 50-07.
  // `it.skip` instead of `it.fixme` per [[reference_vitest_skip_fixme]].
  it.skip(
    'retrieval Edge Fn placeholder query ignores deleted_at flag [DEFERRED — see Plan 50-07]',
    () => {
    // Plan 50-07 will assert: retrieval RPC returns 0 rows when the only matching
    // topic has deleted_at != null, even if its rag_chunks are published.
  });
});
