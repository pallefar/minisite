/**
 * Phase 50 Plan 50-02 — rag_topic_telemetry_7d() honest-contract test (D-11).
 *
 * The function returns one row per active topic. Real columns:
 *   - docs_ingested = count of published rag_chunks per topic
 *   - tier_a/b/c_count = count of published chunks per tier (sums to docs_ingested)
 *
 * Placeholder columns (return 0 until Plan 50-08):
 *   - rag_hits_7d, tip_impressions_7d, tip_clicks_7d, newsletter_inclusions_7d
 *
 * File-scoped TEST_SLUG_PREFIX per [[feedback_rls_per_file_slug_prefix]].
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUserAccessToken } from '../../../../tests/rls/helpers/admin-session';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const TEST_SLUG_PREFIX = `p50-tel-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;

interface TelRow {
  topic_id: string;
  tag: string;
  docs_ingested: number;
  rag_hits_7d: number;
  tip_impressions_7d: number;
  tip_clicks_7d: number;
  newsletter_inclusions_7d: number;
  tier_a_count: number;
  tier_b_count: number;
  tier_c_count: number;
}

describeIfLive('Phase 50 Plan 50-02 — rag_topic_telemetry_7d()', () => {
  let admin: SupabaseClient;
  let superClient: SupabaseClient;
  const createdUserIds: string[] = [];
  let topicId: string;
  let aSourceId: string | undefined;
  let bSourceId: string | undefined;

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

    const { data: topic, error: topicErr } = await admin
      .from('rag_topics')
      .insert({ query: `${TEST_SLUG_PREFIX}-tel-topic`, tag: TEST_SLUG_PREFIX })
      .select('id')
      .single();
    if (topicErr) throw topicErr;
    topicId = topic!.id;

    // Pick a Tier-A and Tier-B source from the seed allowlist
    const { data: tierA } = await admin
      .from('rag_sources')
      .select('id')
      .eq('tier', 'A')
      .limit(1)
      .maybeSingle();
    const { data: tierB } = await admin
      .from('rag_sources')
      .select('id')
      .eq('tier', 'B')
      .limit(1)
      .maybeSingle();
    aSourceId = tierA?.id;
    bSourceId = tierB?.id;

    if (aSourceId) {
      await admin.from('rag_chunks').insert({
        topic_id: topicId,
        source_id: aSourceId,
        canonical_url: `https://${TEST_SLUG_PREFIX}.test/a-1`,
        source_text_excerpt: 'x',
        summary: 'x',
        content_hash: `${TEST_SLUG_PREFIX}-a-1`,
        topic_tag: TEST_SLUG_PREFIX,
        source_tier: 'A',
        status: 'approved',
        published_at: new Date().toISOString(),
      });
      await admin.from('rag_chunks').insert({
        topic_id: topicId,
        source_id: aSourceId,
        canonical_url: `https://${TEST_SLUG_PREFIX}.test/a-2`,
        source_text_excerpt: 'x',
        summary: 'x',
        content_hash: `${TEST_SLUG_PREFIX}-a-2`,
        topic_tag: TEST_SLUG_PREFIX,
        source_tier: 'A',
        status: 'approved',
        published_at: new Date().toISOString(),
      });
    }
    if (bSourceId) {
      await admin.from('rag_chunks').insert({
        topic_id: topicId,
        source_id: bSourceId,
        canonical_url: `https://${TEST_SLUG_PREFIX}.test/b-1`,
        source_text_excerpt: 'x',
        summary: 'x',
        content_hash: `${TEST_SLUG_PREFIX}-b-1`,
        topic_tag: TEST_SLUG_PREFIX,
        source_tier: 'B',
        status: 'approved',
        published_at: new Date().toISOString(),
      });
    }
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from('rag_topics').delete().like('query', `${TEST_SLUG_PREFIX}%`);
    for (const uid of createdUserIds) {
      await admin.auth.admin.deleteUser(uid).catch(() => undefined);
    }
  });

  async function getOurRow(): Promise<TelRow | undefined> {
    const { data, error } = await superClient.rpc('rag_topic_telemetry_7d');
    expect(error).toBeNull();
    return (data as TelRow[] | null)?.find((r) => r.topic_id === topicId);
  }

  it('rag_topic_telemetry_7d returns one row per active topic', async () => {
    const { data, error } = await superClient.rpc('rag_topic_telemetry_7d');
    expect(error).toBeNull();
    const rows = (data as TelRow[] | null) ?? [];
    const mine = rows.filter((r) => r.topic_id === topicId);
    expect(mine.length).toBe(1);
  });

  it('docs_ingested counts published chunks per topic', async () => {
    const row = await getOurRow();
    expect(row).toBeTruthy();
    const expected = (aSourceId ? 2 : 0) + (bSourceId ? 1 : 0);
    expect(row!.docs_ingested).toBe(expected);
  });

  it('tier mix sums to docs_ingested', async () => {
    const row = await getOurRow();
    expect(row).toBeTruthy();
    const tierSum = row!.tier_a_count + row!.tier_b_count + row!.tier_c_count;
    expect(tierSum).toBe(row!.docs_ingested);
  });

  it('placeholder columns rag_hits_7d / tip_impressions_7d / tip_clicks_7d / newsletter_inclusions_7d return 0 until Plan 50-08', async () => {
    const row = await getOurRow();
    expect(row).toBeTruthy();
    expect(row!.rag_hits_7d).toBe(0);
    expect(row!.tip_impressions_7d).toBe(0);
    expect(row!.tip_clicks_7d).toBe(0);
    expect(row!.newsletter_inclusions_7d).toBe(0);
  });
});
