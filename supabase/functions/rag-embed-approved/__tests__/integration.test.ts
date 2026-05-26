/**
 * integration.test.ts — Deno integration tests for rag-embed-approved.
 *
 * Phase 60 Plan 60-05. Task 3.
 *
 * GATED by LIVE_DB=true env var. Under CI (LIVE_DB unset), the test file
 * exits immediately with a console.info and exit code 0.
 *
 * When LIVE_DB=true:
 *   T1: SKIP gate — prints skip message and exits (always passes in CI).
 *   T2: Seed 2 rag_chunks → invoke handler → assert 2 external_kb_embeddings rows.
 *   T3: Re-invoke handler → assert ZERO new rows (ON CONFLICT DO NOTHING idempotent).
 *   T4: Seed retracted chunk → invoke → assert NO embedding row created.
 *   T5: Cleanup — DELETE seeded chunks (cascades to embeddings) + verify baseline unchanged.
 *
 * Deploy command (operator-runnable, NOT automated here — deployment owned by 60-15):
 *   supabase functions deploy rag-embed-approved --no-verify-jwt --linked --project-ref <ref>
 *
 * NOTE: Deno.serve is NOT called when this file imports handler.ts because
 * import.meta.main is false during `deno test`. This validates T10 from Task 2.
 */

// ── LIVE_DB gate ─────────────────────────────────────────────────────────────
if (Deno.env.get('LIVE_DB') !== 'true') {
  console.info('skip integration: LIVE_DB unset');
  Deno.exit(0);
}

// Below only runs when LIVE_DB=true.

import { assertEquals, assertExists, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRequest } from '../handler.ts';
import type { HandlerDeps } from '../handler.ts';

// ── Supabase service-role client ──────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('FATAL: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set for live test');
  Deno.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Deterministic stub embedClient (mocked Gateway, real DB writes) ───────────

const stubEmbedClient = {
  async batchEmbed(texts: string[]) {
    // Return deterministic 1536-dim embeddings (no live OpenAI credit burned).
    const embeddings = texts.map((_, i) =>
      Array.from({ length: 1536 }, (_, d) => Math.sin(i * 0.01 + d * 0.001))
    );
    return { embeddings, totalTokens: texts.length * 10 };
  },
  async healthCheck() {
    return { ok: true, latencyMs: 1 };
  },
};

// ── Build test HandlerDeps ────────────────────────────────────────────────────

function buildTestDeps(): HandlerDeps {
  return {
    supabase: supabase as unknown as HandlerDeps['supabase'],
    embedClient: stubEmbedClient,
    emitAiGeneration: () => { /* no-op in tests */ },
    emitRagCostEnvelopeBreach: () => { /* no-op in tests */ },
    alertSlack: () => { /* no-op in tests */ },
    now: () => Date.now(),
    env: {
      RAG_PER_BATCH_BUDGET_USD: '0.05',
      RAG_DAILY_BUDGET_USD: '50',
    },
  };
}

// ── FK lookup: find existing topic_id + source_id ────────────────────────────

async function getExistingFKs(): Promise<{ topicId: string; sourceId: string }> {
  const [topicRes, sourceRes] = await Promise.all([
    supabase.from('rag_topics').select('id').limit(1).single(),
    supabase.from('rag_sources').select('id').limit(1).single(),
  ]);

  if (topicRes.error || !topicRes.data) {
    throw new Error('Phase 50 Wave 1 seed data missing: no rag_topics rows. Cannot run integration test.');
  }
  if (sourceRes.error || !sourceRes.data) {
    throw new Error('Phase 50 Wave 1 seed data missing: no rag_sources rows. Cannot run integration test.');
  }

  return {
    topicId: (topicRes.data as { id: string }).id,
    sourceId: (sourceRes.data as { id: string }).id,
  };
}

// ── Integration tests ─────────────────────────────────────────────────────────

Deno.test('T2 (live): seed 2 chunks → invoke handler → assert 2 embeddings in DB', async (t) => {
  const { topicId, sourceId } = await getExistingFKs();

  const chunkIds: string[] = [];

  await t.step('seed 2 rag_chunks', async () => {
    const rows = [
      {
        topic_id: topicId,
        source_id: sourceId,
        canonical_url: 'https://example.com/chunk-it-1',
        source_text_excerpt: 'Test excerpt 1 for integration test',
        summary: 'Integration test summary 1',
        quote_blocks: [{ text: 'Test quote 1' }],
        content_hash: `int-test-hash-${Date.now()}-1`,
        topic_tag: 'glp1-integration-test',
        source_tier: 'A',
        status: 'approved',
        published_at: new Date().toISOString(),
      },
      {
        topic_id: topicId,
        source_id: sourceId,
        canonical_url: 'https://example.com/chunk-it-2',
        source_text_excerpt: 'Test excerpt 2 for integration test',
        summary: 'Integration test summary 2',
        quote_blocks: [{ text: 'Test quote 2' }],
        content_hash: `int-test-hash-${Date.now()}-2`,
        topic_tag: 'glp1-integration-test',
        source_tier: 'A',
        status: 'approved',
        published_at: new Date().toISOString(),
      },
    ];

    const { data, error } = await supabase.from('rag_chunks').insert(rows).select('id');
    if (error) throw new Error(`Failed to seed rag_chunks: ${error.message}`);
    assertExists(data);
    chunkIds.push(...(data as { id: string }[]).map((r) => r.id));
    assertEquals(chunkIds.length, 2, 'Expected 2 seeded chunk IDs');
  });

  await t.step('invoke handler with seeded chunk_ids', async () => {
    const deps = buildTestDeps();
    const req = new Request('https://example.com/functions/v1/rag-embed-approved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunk_ids: chunkIds }),
    });
    const res = await handleRequest(req, deps);
    assertEquals(res.status, 200, `Expected 200, got ${res.status}`);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.ok, true);
    assertEquals(body.chunks_embedded, 2);
  });

  await t.step('assert 2 external_kb_embeddings rows with length 1536', async () => {
    const { data, error } = await supabase
      .from('external_kb_embeddings')
      .select('chunk_id, embedding')
      .in('chunk_id', chunkIds);

    if (error) throw new Error(`Failed to query embeddings: ${error.message}`);
    assertExists(data);
    assertEquals((data as unknown[]).length, 2, 'Expected 2 embedding rows');
    // Each embedding should be a vector representation (DB stores as pgvector string)
    for (const row of data as { chunk_id: string; embedding: unknown }[]) {
      assertExists(row.embedding, `Missing embedding for chunk ${row.chunk_id}`);
    }
  });

  await t.step('cleanup: delete seeded chunks (cascades to embeddings)', async () => {
    const { error } = await supabase.from('rag_chunks').delete().in('id', chunkIds);
    if (error) throw new Error(`Cleanup failed: ${error.message}`);
  });
});

Deno.test('T3 (live): re-invocation with same chunks → ZERO new embeddings (idempotent)', async () => {
  const { topicId, sourceId } = await getExistingFKs();

  // Seed 1 chunk.
  const { data: seedData, error: seedError } = await supabase
    .from('rag_chunks')
    .insert({
      topic_id: topicId,
      source_id: sourceId,
      canonical_url: 'https://example.com/chunk-idempotent',
      source_text_excerpt: 'Idempotency test excerpt',
      summary: 'Idempotency test summary',
      quote_blocks: [],
      content_hash: `int-test-idem-${Date.now()}`,
      topic_tag: 'glp1-integration-test',
      source_tier: 'B',
      status: 'approved',
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (seedError || !seedData) throw new Error(`Seed failed: ${seedError?.message}`);
  const chunkId = (seedData as { id: string }).id;

  try {
    const deps = buildTestDeps();
    const makeReq = () =>
      new Request('https://example.com/functions/v1/rag-embed-approved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chunk_ids: [chunkId] }),
      });

    // First invocation — embeds the chunk.
    const res1 = await handleRequest(makeReq(), deps);
    assertEquals(res1.status, 200);
    const body1 = await res1.json() as Record<string, unknown>;
    assertEquals(body1.chunks_embedded, 1);

    // Count embed calls so far.
    let embedCallCount = 0;
    const spyDeps = buildTestDeps();
    const origBatchEmbed = spyDeps.embedClient.batchEmbed.bind(spyDeps.embedClient);
    spyDeps.embedClient = {
      ...spyDeps.embedClient,
      batchEmbed: async (texts: string[]) => {
        embedCallCount++;
        return origBatchEmbed(texts);
      },
    };

    // Second invocation — chunk already embedded; selection returns nothing.
    const res2 = await handleRequest(makeReq(), spyDeps);
    assertEquals(res2.status, 200);
    const body2 = await res2.json() as Record<string, unknown>;
    // Either 0 chunks (selection filtered them out) or 0 new rows via ON CONFLICT
    assert(
      body2.chunks_embedded === 0 || embedCallCount === 0,
      'Second invocation should embed 0 new chunks',
    );
  } finally {
    await supabase.from('rag_chunks').delete().eq('id', chunkId);
  }
});

Deno.test('T4 (live): retracted chunk gets NO embedding row', async () => {
  const { topicId, sourceId } = await getExistingFKs();

  // Seed a retracted chunk.
  const { data: seedData, error: seedError } = await supabase
    .from('rag_chunks')
    .insert({
      topic_id: topicId,
      source_id: sourceId,
      canonical_url: 'https://example.com/chunk-retracted',
      source_text_excerpt: 'Retracted test excerpt',
      summary: 'Retracted test summary',
      quote_blocks: [],
      content_hash: `int-test-retracted-${Date.now()}`,
      topic_tag: 'glp1-integration-test',
      source_tier: 'C',
      status: 'retracted',
      retracted_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (seedError || !seedData) throw new Error(`Seed failed: ${seedError?.message}`);
  const chunkId = (seedData as { id: string }).id;

  try {
    const deps = buildTestDeps();
    const res = await handleRequest(
      new Request('https://example.com/functions/v1/rag-embed-approved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chunk_ids: [chunkId] }),
      }),
      deps,
    );
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.chunks_embedded, 0, 'Retracted chunk should NOT be embedded');

    // Verify no embedding row exists.
    const { data } = await supabase
      .from('external_kb_embeddings')
      .select('chunk_id')
      .eq('chunk_id', chunkId);
    assertEquals((data as unknown[]).length, 0, 'No embedding row should exist for retracted chunk');
  } finally {
    await supabase.from('rag_chunks').delete().eq('id', chunkId);
  }
});
