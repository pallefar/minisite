/**
 * Phase 50 Plan 50-01 — RLS impersonation matrix for all rag_* tables.
 *
 * Fixtures (created with admin.generateLink + /auth/v1/verify per
 * [[reference_rls_fixture_gotrueclient_flake]]; ES256-compatible):
 *   - super-admin user  (profiles.admin_role = 'superadmin')
 *   - plain admin user  (profiles.admin_role = 'admin')
 *   - regular user      (no admin_role)
 *   - anon              (no JWT)
 *
 * Matrix assertions (subset enumerated in plan acceptance):
 *   • super-admin CAN SELECT/INSERT rag_topics
 *   • plain admin CANNOT INSERT rag_topics (403 / 0 rows)
 *   • regular user CANNOT SELECT rag_topics
 *   • anon CAN SELECT published rag_chunks (published_at set, retracted_at null)
 *   • anon CANNOT SELECT queued rag_chunks
 *   • regular user CAN SELECT/UPDATE own newsletter row
 *   • regular user CANNOT SELECT/UPDATE another user's newsletter row
 *
 * File-scoped TEST_SLUG_PREFIX (no shared global) per
 * [[feedback_rls_per_file_slug_prefix]].
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUserAccessToken } from '../../../../tests/rls/helpers/admin-session';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const TEST_SLUG_PREFIX = `p50-rls-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function buildUserClient(accessToken: string, storageKey: string): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

function buildAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey: `${TEST_SLUG_PREFIX}-anon` },
  });
}

describeIfLive('Phase 50 Plan 50-01 — RLS impersonation matrix', () => {
  const admin = SHOULD_RUN ? getAdmin() : null!;
  const createdUserIds: string[] = [];
  let superId: string;
  let adminUserId: string;
  let regularUserId: string;
  let otherUserId: string;
  let superClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let regularClient: SupabaseClient;
  let publishedChunkId: string;
  let queuedChunkId: string;
  let topicIdSeed: string;
  let sourceIdSeed: string;

  beforeAll(async () => {
    const password = `Pass1234-${crypto.randomUUID().slice(0, 8)}`;

    async function createUser(label: string): Promise<string> {
      const email = `${TEST_SLUG_PREFIX}-${label}@leanshot.test`;
      const res = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (res.error) throw res.error;
      const id = res.data.user!.id;
      createdUserIds.push(id);
      return id;
    }

    superId       = await createUser('super');
    adminUserId   = await createUser('admin');
    regularUserId = await createUser('regular');
    otherUserId   = await createUser('other');

    // Promote via service_role direct profiles update
    await admin.from('profiles').upsert({ id: superId,     admin_role: 'superadmin' });
    await admin.from('profiles').upsert({ id: adminUserId, admin_role: 'admin' });

    const superToken   = await getUserAccessToken(`${TEST_SLUG_PREFIX}-super@leanshot.test`);
    const adminToken   = await getUserAccessToken(`${TEST_SLUG_PREFIX}-admin@leanshot.test`);
    const regularToken = await getUserAccessToken(`${TEST_SLUG_PREFIX}-regular@leanshot.test`);

    superClient   = buildUserClient(superToken,   `${TEST_SLUG_PREFIX}-super`);
    adminClient   = buildUserClient(adminToken,   `${TEST_SLUG_PREFIX}-admin`);
    regularClient = buildUserClient(regularToken, `${TEST_SLUG_PREFIX}-regular`);

    // Seed a topic + chunk pair via service_role so rag_chunks anon-read assertion
    // has a concrete published row to look up.
    const { data: topic, error: topicErr } = await admin
      .from('rag_topics')
      .insert({ query: `${TEST_SLUG_PREFIX}-topic`, tag: TEST_SLUG_PREFIX })
      .select('id')
      .single();
    if (topicErr) throw topicErr;
    topicIdSeed = topic!.id;

    const { data: src, error: srcErr } = await admin
      .from('rag_sources')
      .select('id')
      .limit(1)
      .single();
    if (srcErr) throw srcErr;
    sourceIdSeed = src!.id;

    const { data: pubChunk, error: pubErr } = await admin
      .from('rag_chunks')
      .insert({
        topic_id: topicIdSeed,
        source_id: sourceIdSeed,
        canonical_url: `https://${TEST_SLUG_PREFIX}.test/published`,
        source_text_excerpt: 'x',
        summary: 'x',
        content_hash: `${TEST_SLUG_PREFIX}-pub`,
        topic_tag: TEST_SLUG_PREFIX,
        source_tier: 'A',
        status: 'approved',
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (pubErr) throw pubErr;
    publishedChunkId = pubChunk!.id;

    const { data: qChunk, error: qErr } = await admin
      .from('rag_chunks')
      .insert({
        topic_id: topicIdSeed,
        source_id: sourceIdSeed,
        canonical_url: `https://${TEST_SLUG_PREFIX}.test/queued`,
        source_text_excerpt: 'x',
        summary: 'x',
        content_hash: `${TEST_SLUG_PREFIX}-queued`,
        topic_tag: TEST_SLUG_PREFIX,
        source_tier: 'A',
        status: 'queued',
      })
      .select('id')
      .single();
    if (qErr) throw qErr;
    queuedChunkId = qChunk!.id;
  }, 60_000);

  afterAll(async () => {
    if (!SHOULD_RUN) return;
    if (topicIdSeed) {
      await admin.from('rag_topics').delete().eq('id', topicIdSeed);
    }
    // Clean up newsletter rows for our test users
    if (createdUserIds.length > 0) {
      await admin.from('rag_newsletter_subscriptions').delete().in('user_id', createdUserIds);
    }
    // Delete any rag_topics we may have created via super-admin client
    await admin.from('rag_topics').delete().like('query', `${TEST_SLUG_PREFIX}%`);
    for (const uid of createdUserIds) {
      await admin.auth.admin.deleteUser(uid).catch(() => undefined);
    }
  });

  // -------------------------------------------------------------------------
  // rag_topics matrix
  // -------------------------------------------------------------------------

  it('super-admin CAN SELECT rag_topics', async () => {
    const { data, error } = await superClient.from('rag_topics').select('id').limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('super-admin CAN INSERT rag_topics', async () => {
    const { error } = await superClient
      .from('rag_topics')
      .insert({ query: `${TEST_SLUG_PREFIX}-super-insert`, tag: TEST_SLUG_PREFIX });
    expect(error).toBeNull();
  });

  it('plain admin CANNOT INSERT rag_topics', async () => {
    const { error } = await adminClient
      .from('rag_topics')
      .insert({ query: `${TEST_SLUG_PREFIX}-admin-insert`, tag: TEST_SLUG_PREFIX });
    expect(error).not.toBeNull();
  });

  it('regular user CANNOT SELECT rag_topics (empty result, no rows visible)', async () => {
    const { data, error } = await regularClient.from('rag_topics').select('id');
    // RLS-blocked SELECT returns empty array, not an error
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  // -------------------------------------------------------------------------
  // rag_chunks anon-read matrix
  // -------------------------------------------------------------------------

  it('anon CAN SELECT a published rag_chunks row', async () => {
    const anon = buildAnonClient();
    const { data, error } = await anon
      .from('rag_chunks')
      .select('id, status, published_at, retracted_at')
      .eq('id', publishedChunkId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(publishedChunkId);
    expect(data?.published_at).not.toBeNull();
    expect(data?.retracted_at).toBeNull();
  });

  it('anon CANNOT SELECT a queued rag_chunks row', async () => {
    const anon = buildAnonClient();
    const { data, error } = await anon
      .from('rag_chunks')
      .select('id, status, published_at')
      .eq('id', queuedChunkId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  // -------------------------------------------------------------------------
  // rag_newsletter_subscriptions ownership matrix
  // -------------------------------------------------------------------------

  it('regular user CAN INSERT + SELECT own newsletter subscription row', async () => {
    const { error: insErr } = await regularClient
      .from('rag_newsletter_subscriptions')
      .insert({ user_id: regularUserId, frequency: 'weekly', tags_followed: [TEST_SLUG_PREFIX] });
    expect(insErr).toBeNull();

    const { data, error } = await regularClient
      .from('rag_newsletter_subscriptions')
      .select('id, frequency')
      .eq('user_id', regularUserId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.frequency).toBe('weekly');
  });

  it("regular user CANNOT SELECT another user's newsletter row", async () => {
    // Seed the other user's row via service_role
    await admin
      .from('rag_newsletter_subscriptions')
      .insert({ user_id: otherUserId, frequency: 'weekly', tags_followed: [] });

    const { data, error } = await regularClient
      .from('rag_newsletter_subscriptions')
      .select('id')
      .eq('user_id', otherUserId);
    // RLS owner-policy filters out other rows
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  it("regular user CANNOT UPDATE another user's newsletter row", async () => {
    const { error, data } = await regularClient
      .from('rag_newsletter_subscriptions')
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq('user_id', otherUserId)
      .select();
    // Update either errors or affects 0 rows
    expect((data?.length ?? 0)).toBe(0);
    // Don't assert error shape — some Postgrest versions return null + 0 rows
    void error;
  });

  it('regular user CAN UPDATE own newsletter row (set unsubscribed_at)', async () => {
    const { data, error } = await regularClient
      .from('rag_newsletter_subscriptions')
      .update({ unsubscribed_at: new Date().toISOString(), frequency: 'off' })
      .eq('user_id', regularUserId)
      .select();
    expect(error).toBeNull();
    expect((data?.length ?? 0)).toBeGreaterThanOrEqual(1);
  });
});
