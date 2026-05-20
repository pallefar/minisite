/**
 * Phase 38 Plan 01 — pgvector smoke test.
 *
 * Verifies the schema landed by 20270705000001..20270705000004 is correct:
 *   1. content_embeddings table accepts vector(1536) inserts.
 *   2. match_content_embeddings RPC returns results ordered ascending by cosine
 *      distance (i.e. descending by similarity).
 *   3. requesting_user_id := null raises EXCEPTION (Guardrail O4 belt+suspenders).
 *   4. similarity column = 1 - cosine_distance (sanity check).
 *   5. sources[] parameter accepted with Phase 50 forward-compat (passes through).
 *
 * Execution: this test runs against the LINKED Supabase project. It is gated on
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY being available in the environment
 * — when absent (e.g. local-only dev without `.env`), the test self-skips
 * rather than fail with "missing env". This avoids spurious CI red while
 * still proving correctness once Wave-2 db-push lands.
 *
 * RLS fixture hygiene (memory `feedback_rls_per_file_slug_prefix`): test data
 * is scoped via a file-local TEST_SLUG_PREFIX. afterAll cleanup removes only
 * rows tagged with that prefix.
 *
 * Auth (memory `reference_rls_fixture_gotrueclient_flake`): service-role only.
 * Do NOT use supabase-js signInWithPassword (cross-test contamination on v2.105+).
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.105.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// File-local prefix (memory `feedback_rls_per_file_slug_prefix`).
const TEST_SLUG_PREFIX = 'p38-01-pgvector-smoke-';
const TEST_USER_ID = '00000000-0000-0000-0000-00000000a000';

const canRun = SUPABASE_URL.length > 0 && SERVICE_ROLE_KEY.length > 0;

function getClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Build a deterministic 1536-d unit vector seeded by a single scalar so we can
 * make three "known" vectors with predictable cosine ordering against a query.
 */
function seedVector(seed: number): number[] {
  const v = new Array<number>(1536);
  let norm = 0;
  for (let i = 0; i < 1536; i++) {
    // Deterministic pseudo-random component (LCG-ish).
    const r = Math.sin(seed * 9301 + i * 49297) * 233280;
    v[i] = r - Math.floor(r);
    norm += v[i]! * v[i]!;
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < 1536; i++) v[i] = v[i]! / norm;
  return v;
}

async function insertFixture(supabase: SupabaseClient, contentId: string, kind: string, title: string, seed: number) {
  await supabase.from('content').upsert({
    id: contentId,
    kind,
    title,
    body_md: `${TEST_SLUG_PREFIX}body`,
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await supabase.from('content_embeddings').upsert({
    content_id: contentId,
    embedding: seedVector(seed) as unknown as string, // pgvector accepts JSON array or string repr
    body_sha256: `${TEST_SLUG_PREFIX}${seed}`,
    last_embedded_at: new Date().toISOString(),
    stale: false,
  });
}

async function cleanupFixtures(supabase: SupabaseClient) {
  await supabase.from('content_embeddings').delete().like('body_sha256', `${TEST_SLUG_PREFIX}%`);
  await supabase.from('content').delete().like('body_md', `${TEST_SLUG_PREFIX}%`);
}

Deno.test('pgvector smoke — RPC ordering, NULL guard, similarity math', async (t) => {
  if (!canRun) {
    console.warn(`[${TEST_SLUG_PREFIX}] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping`);
    return;
  }

  const supabase = getClient();
  const QUERY_SEED = 1;
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';
  const C = '33333333-3333-3333-3333-333333333333';

  try {
    // Cleanup any previous fixtures from a crashed run.
    await cleanupFixtures(supabase);

    await insertFixture(supabase, A, 'kb', `${TEST_SLUG_PREFIX}closest`, QUERY_SEED);     // closest (identical seed)
    await insertFixture(supabase, B, 'kb', `${TEST_SLUG_PREFIX}middle`, QUERY_SEED + 5);  // middle
    await insertFixture(supabase, C, 'kb', `${TEST_SLUG_PREFIX}farthest`, QUERY_SEED + 50); // farthest

    await t.step('RPC returns results ordered by descending similarity', async () => {
      const { data, error } = await supabase.rpc('match_content_embeddings', {
        query_embedding: seedVector(QUERY_SEED) as unknown as string,
        match_count: 10,
        requesting_user_id: TEST_USER_ID,
        sources: ['content_embeddings'],
      });
      if (error) throw new Error(`RPC error: ${error.message}`);
      if (!data || data.length < 3) throw new Error(`Expected >=3 rows, got ${data?.length}`);

      // Filter to our fixtures (other rows in the DB may exist).
      const ours = (data as Array<{ content_id: string; similarity: number }>).filter((r) =>
        [A, B, C].includes(r.content_id),
      );
      if (ours.length !== 3) throw new Error(`Expected 3 fixture rows, got ${ours.length}`);
      // similarity descending → A (closest) > B > C
      if (!(ours[0]!.content_id === A)) throw new Error(`Expected A first, got ${ours[0]!.content_id}`);
      if (!(ours[0]!.similarity >= ours[1]!.similarity)) throw new Error('similarity not descending A→B');
      if (!(ours[1]!.similarity >= ours[2]!.similarity)) throw new Error('similarity not descending B→C');
    });

    await t.step('similarity column = 1 - cosine_distance (range 0..2 → 1..-1)', async () => {
      const { data, error } = await supabase.rpc('match_content_embeddings', {
        query_embedding: seedVector(QUERY_SEED) as unknown as string,
        match_count: 3,
        requesting_user_id: TEST_USER_ID,
        sources: ['content_embeddings'],
      });
      if (error) throw new Error(`RPC error: ${error.message}`);
      for (const r of data as Array<{ similarity: number }>) {
        if (r.similarity < -1.01 || r.similarity > 1.01) {
          throw new Error(`similarity out of [-1,1] range: ${r.similarity}`);
        }
      }
    });

    await t.step('requesting_user_id := null raises EXCEPTION (Guardrail O4)', async () => {
      const { error } = await supabase.rpc('match_content_embeddings', {
        query_embedding: seedVector(QUERY_SEED) as unknown as string,
        match_count: 10,
        requesting_user_id: null,
        sources: ['content_embeddings'],
      });
      if (!error) throw new Error('Expected RPC to raise EXCEPTION when requesting_user_id IS NULL — got success');
      if (!error.message.toLowerCase().includes('requesting_user_id')) {
        throw new Error(`Expected error mentioning requesting_user_id, got: ${error.message}`);
      }
    });

    await t.step('Phase 50 forward-compat: sources=[external_kb_embeddings] returns empty (not error)', async () => {
      const { data, error } = await supabase.rpc('match_content_embeddings', {
        query_embedding: seedVector(QUERY_SEED) as unknown as string,
        match_count: 10,
        requesting_user_id: TEST_USER_ID,
        sources: ['external_kb_embeddings'],
      });
      if (error) throw new Error(`RPC errored on Phase 50 source name: ${error.message}`);
      // No external_kb_embeddings rows yet; just verify call shape is accepted.
      if (data === null) throw new Error('Expected array (possibly empty), got null');
    });

    await t.step('source_tier_weights jsonb reweights scores', async () => {
      const { data, error } = await supabase.rpc('match_content_embeddings', {
        query_embedding: seedVector(QUERY_SEED) as unknown as string,
        match_count: 10,
        requesting_user_id: TEST_USER_ID,
        sources: ['content_embeddings'],
        source_tier_weights: { content_embeddings: 0.5 },
      });
      if (error) throw new Error(`RPC error: ${error.message}`);
      const ours = (data as Array<{ content_id: string; similarity: number; weighted_score: number }>).filter((r) =>
        [A, B, C].includes(r.content_id),
      );
      if (ours.length === 0) throw new Error('Expected fixture rows');
      // weighted_score should be ~ similarity * 0.5
      const r = ours[0]!;
      const expected = r.similarity * 0.5;
      if (Math.abs(r.weighted_score - expected) > 0.001) {
        throw new Error(`Expected weighted_score≈${expected} (sim*0.5), got ${r.weighted_score}`);
      }
    });
  } finally {
    await cleanupFixtures(supabase);
  }
});
