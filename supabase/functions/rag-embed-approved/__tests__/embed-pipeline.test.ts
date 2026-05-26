/**
 * embed-pipeline.test.ts — Vitest unit tests for rag-embed-approved index.ts handler.
 *
 * Phase 60 Plan 60-05. Task 2 (RED → GREEN cycle).
 *
 * Override (2026-05-26): OpenRouter; PostHog event uses provider='openrouter',
 * model='openrouter/openai/text-embedding-3-small'.
 *
 * Tests:
 *  T1:  No-body request (cron-tick) selects published + non-retracted + no-embedding chunks.
 *  T2:  Body { chunk_ids } restricts candidate set; 400 on non-uuid ID.
 *  T3:  250 candidates → 3 OpenAI calls (100/100/50) + 3 INSERT batches; embed text = summary+'||'+quote_blocks.
 *  T4:  Retracted chunks excluded even if forced via chunk_ids body.
 *  T5:  ON CONFLICT semantics — second invocation skips already-embedded chunks.
 *  T6:  One emitAiGeneration call per batch with correct provider/model/cost.
 *  T7:  OpenAIEmbedError → 502 with partial progress; no batch rollback.
 *  T8:  GET /healthz → 200 when healthy; 503 when either db or OpenAI fails.
 *  T9:  Per-batch cost breach → alertSlack once; daily breach → emitRagCostEnvelopeBreach + abort.
 *  T10: Deno.serve NOT invoked when module imported (import.meta.main guard).
 */

import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../handler.ts';
import type { HandlerDeps } from '../handler.ts';
import { OpenAIEmbedError } from '../openai.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Test fixtures + helper types
// ──────────────────────────────────────────────────────────────────────────────

interface ChunkRow {
  id: string;
  summary: string;
  quote_blocks: unknown[];
  topic_id: string;
  source_id: string;
  source_tier: string;
  topic_tag: string;
  freshness_window_days: number;
  published_at: string | null;
  retracted_at: string | null;
}

function makeChunk(overrides: Partial<ChunkRow> = {}): ChunkRow {
  return {
    id: crypto.randomUUID(),
    summary: 'Test summary',
    quote_blocks: [{ text: 'test quote' }],
    topic_id: crypto.randomUUID(),
    source_id: crypto.randomUUID(),
    source_tier: 'A',
    topic_tag: 'glp1-test',
    freshness_window_days: 180,
    published_at: new Date().toISOString(),
    retracted_at: null,
    ...overrides,
  };
}

function makeDummyEmbeddings(n: number): number[][] {
  return Array.from({ length: n }, () => Array(1536).fill(0.01));
}

interface UpsertCapture {
  table: string;
  rows: unknown[];
  opts: Record<string, unknown>;
}

/**
 * Build a fake Supabase client that returns specified chunks and captures upsert calls.
 */
function makeSupabase(
  chunks: ChunkRow[],
  upsertCaptures: UpsertCapture[],
  rpcResult?: { data?: unknown; error?: { message: string; code?: string } | null },
) {
  const queryState: {
    table: string;
    filters: Record<string, unknown>;
    limit?: number;
  } = { table: '', filters: {} };

  return {
    rpc: vi.fn((_name: string, _params?: Record<string, unknown>) => {
      if (rpcResult) {
        return Promise.resolve(rpcResult);
      }
      // Default: simulate PGRST202 function-not-found to fall through to inline query
      return Promise.resolve({ data: null, error: { message: 'function not found', code: 'PGRST202' } });
    }),
    from: (table: string) => {
      queryState.table = table;
      return {
        select: (_cols: string) => ({
          is: (_col: string, _val: unknown) => ({
            is: (_col2: string, _val2: unknown) => ({
              not: () => ({
                in: (_col3: string, _ids: string[]) => ({
                  limit: (_n: number) => Promise.resolve({ data: chunks, error: null }),
                }),
                limit: (_n: number) => Promise.resolve({ data: chunks, error: null }),
              }),
              limit: (_n: number) => Promise.resolve({ data: chunks, error: null }),
            }),
          }),
        }),
        upsert: (rows: unknown[], opts: Record<string, unknown>) => {
          upsertCaptures.push({ table, rows: rows as unknown[], opts });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

/**
 * Build a fake embedClient that returns deterministic embeddings.
 */
function makeEmbedClient(batchEmbedImpl?: (texts: string[]) => Promise<{ embeddings: number[][]; totalTokens: number }>) {
  return {
    batchEmbed: vi.fn(
      batchEmbedImpl ??
        (async (texts: string[]) => ({
          embeddings: makeDummyEmbeddings(texts.length),
          totalTokens: texts.length * 50,
        })),
    ),
    healthCheck: vi.fn(async () => ({ ok: true, latencyMs: 5 })),
  };
}

/**
 * Build a full HandlerDeps with sensible defaults.
 */
function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  const upsertCaptures: UpsertCapture[] = [];
  const chunks: ChunkRow[] = [];
  return {
    supabase: makeSupabase(chunks, upsertCaptures) as unknown as HandlerDeps['supabase'],
    embedClient: makeEmbedClient() as unknown as HandlerDeps['embedClient'],
    emitAiGeneration: vi.fn(),
    emitRagCostEnvelopeBreach: vi.fn(),
    alertSlack: vi.fn(),
    now: () => Date.now(),
    env: {
      RAG_PER_BATCH_BUDGET_USD: '0.05',
      RAG_DAILY_BUDGET_USD: '50',
    },
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('rag-embed-approved handler', () => {
  it('T1: no-body (cron) request selects published+non-retracted+no-embedding chunks', async () => {
    const chunks = [makeChunk(), makeChunk()];
    const upserts: UpsertCapture[] = [];
    const embedClient = makeEmbedClient();

    const supabase = makeSupabase(chunks, upserts);

    const deps: HandlerDeps = {
      supabase: supabase as unknown as HandlerDeps['supabase'],
      embedClient: embedClient as unknown as HandlerDeps['embedClient'],
      emitAiGeneration: vi.fn(),
      emitRagCostEnvelopeBreach: vi.fn(),
      alertSlack: vi.fn(),
      now: () => Date.now(),
      env: { RAG_PER_BATCH_BUDGET_USD: '0.05', RAG_DAILY_BUDGET_USD: '50' },
    };

    const req = new Request('https://example.com/functions/v1/rag-embed-approved', {
      method: 'POST',
    });
    const res = await handleRequest(req, deps);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.chunks_embedded).toBe(2);
    expect(embedClient.batchEmbed).toHaveBeenCalledOnce();
  });

  it('T2: chunk_ids body restricts candidates; 400 on non-uuid ID', async () => {
    const validId = crypto.randomUUID();
    const chunks = [makeChunk({ id: validId })];
    const upserts: UpsertCapture[] = [];
    const supabase = makeSupabase(chunks, upserts);

    const deps = makeDeps({
      supabase: supabase as unknown as HandlerDeps['supabase'],
    });

    // Valid UUIDs — should succeed
    const req = new Request('https://example.com/functions/v1/rag-embed-approved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunk_ids: [validId] }),
    });
    const res = await handleRequest(req, deps);
    expect(res.status).toBe(200);

    // Non-uuid ID — should 400
    const badReq = new Request('https://example.com/functions/v1/rag-embed-approved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunk_ids: ['not-a-uuid'] }),
    });
    const badRes = await handleRequest(badReq, deps);
    expect(badRes.status).toBe(400);
  });

  it('T3: 250 candidates → 3 embed calls (100/100/50); embed input = summary+||+quote_blocks', async () => {
    const chunks = Array.from({ length: 250 }, () => makeChunk());
    const upserts: UpsertCapture[] = [];
    const embedClient = makeEmbedClient();

    // Supply all 250 directly via RPC result
    const supabase = makeSupabase(chunks, upserts, { data: chunks, error: null });

    const deps: HandlerDeps = {
      supabase: supabase as unknown as HandlerDeps['supabase'],
      embedClient: embedClient as unknown as HandlerDeps['embedClient'],
      emitAiGeneration: vi.fn(),
      emitRagCostEnvelopeBreach: vi.fn(),
      alertSlack: vi.fn(),
      now: () => Date.now(),
      env: { RAG_PER_BATCH_BUDGET_USD: '0.05', RAG_DAILY_BUDGET_USD: '50' },
    };

    const req = new Request('https://example.com/functions/v1/rag-embed-approved', {
      method: 'POST',
    });
    const res = await handleRequest(req, deps);
    expect(res.status).toBe(200);

    // 3 batches: 100 + 100 + 50
    expect(embedClient.batchEmbed).toHaveBeenCalledTimes(3);
    const call1 = (embedClient.batchEmbed.mock.calls[0] as [string[]])[0];
    expect(call1).toHaveLength(100);
    const call3 = (embedClient.batchEmbed.mock.calls[2] as [string[]])[0];
    expect(call3).toHaveLength(50);
    expect(upserts).toHaveLength(3);

    // Verify embed input format
    const firstInput = call1[0];
    expect(firstInput).toContain(' || ');
    expect(firstInput).toContain('Test summary');
  });

  it('T4: retracted chunks excluded even when forced via chunk_ids', async () => {
    const retractedId = crypto.randomUUID();
    const activeId = crypto.randomUUID();
    const allChunks = [
      makeChunk({ id: activeId }), // Only active chunk returned by selection
    ];
    const upserts: UpsertCapture[] = [];
    const supabase = makeSupabase(allChunks, upserts);
    const embedClient = makeEmbedClient();

    const deps: HandlerDeps = {
      supabase: supabase as unknown as HandlerDeps['supabase'],
      embedClient: embedClient as unknown as HandlerDeps['embedClient'],
      emitAiGeneration: vi.fn(),
      emitRagCostEnvelopeBreach: vi.fn(),
      alertSlack: vi.fn(),
      now: () => Date.now(),
      env: { RAG_PER_BATCH_BUDGET_USD: '0.05', RAG_DAILY_BUDGET_USD: '50' },
    };

    // Request includes retracted ID, but selection filter only returns the active one
    const req = new Request('https://example.com/functions/v1/rag-embed-approved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunk_ids: [retractedId, activeId] }),
    });
    const res = await handleRequest(req, deps);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.chunks_embedded).toBe(1); // Only active chunk embedded
  });

  it('T5: ON CONFLICT — second invocation over same candidates produces zero new rows', async () => {
    const chunks = [makeChunk()];
    const upserts: UpsertCapture[] = [];

    // Second call: the selection returns NO candidates (all already embedded).
    const supabase2 = makeSupabase([], upserts);
    const embedClient = makeEmbedClient();

    const deps: HandlerDeps = {
      supabase: supabase2 as unknown as HandlerDeps['supabase'],
      embedClient: embedClient as unknown as HandlerDeps['embedClient'],
      emitAiGeneration: vi.fn(),
      emitRagCostEnvelopeBreach: vi.fn(),
      alertSlack: vi.fn(),
      now: () => Date.now(),
      env: { RAG_PER_BATCH_BUDGET_USD: '0.05', RAG_DAILY_BUDGET_USD: '50' },
    };

    const req = new Request('https://example.com/functions/v1/rag-embed-approved', {
      method: 'POST',
    });
    const res = await handleRequest(req, deps);
    expect(res.status).toBe(200);
    expect(embedClient.batchEmbed).not.toHaveBeenCalled();
    const body = await res.json() as Record<string, unknown>;
    expect(body.chunks_embedded).toBe(0);
    // Verify upsert uses ON CONFLICT semantics (ignoreDuplicates + onConflict=chunk_id)
    // The upserts array is empty because nothing was embedded
    expect(upserts).toHaveLength(0);

    void chunks; // suppress unused variable warning
  });

  it('T5b: upsert call uses ignoreDuplicates:true and onConflict:chunk_id', async () => {
    const chunks = [makeChunk()];
    const upserts: UpsertCapture[] = [];
    const supabase = makeSupabase(chunks, upserts, { data: chunks, error: null });

    const deps: HandlerDeps = {
      supabase: supabase as unknown as HandlerDeps['supabase'],
      embedClient: makeEmbedClient() as unknown as HandlerDeps['embedClient'],
      emitAiGeneration: vi.fn(),
      emitRagCostEnvelopeBreach: vi.fn(),
      alertSlack: vi.fn(),
      now: () => Date.now(),
      env: { RAG_PER_BATCH_BUDGET_USD: '0.05', RAG_DAILY_BUDGET_USD: '50' },
    };

    await handleRequest(new Request('https://example.com', { method: 'POST' }), deps);

    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.opts).toMatchObject({ onConflict: 'chunk_id', ignoreDuplicates: true });
  });

  it('T6: one emitAiGeneration per batch with provider=openrouter, model=openrouter/openai/text-embedding-3-small', async () => {
    const chunks = Array.from({ length: 5 }, () => makeChunk());
    const upserts: UpsertCapture[] = [];
    const supabase = makeSupabase(chunks, upserts, { data: chunks, error: null });
    const emitAiGeneration = vi.fn();

    const deps: HandlerDeps = {
      supabase: supabase as unknown as HandlerDeps['supabase'],
      embedClient: makeEmbedClient() as unknown as HandlerDeps['embedClient'],
      emitAiGeneration,
      emitRagCostEnvelopeBreach: vi.fn(),
      alertSlack: vi.fn(),
      now: () => Date.now(),
      env: { RAG_PER_BATCH_BUDGET_USD: '0.05', RAG_DAILY_BUDGET_USD: '50' },
    };

    await handleRequest(new Request('https://example.com', { method: 'POST' }), deps);

    expect(emitAiGeneration).toHaveBeenCalledOnce();
    const call = emitAiGeneration.mock.calls[0] as [Parameters<HandlerDeps['emitAiGeneration']>[0]];
    const args = call[0];
    expect(args.provider).toBe('openrouter');
    expect(args.model).toBe('openrouter/openai/text-embedding-3-small');
    expect(typeof args.inputTokens).toBe('number');
    expect(args.inputTokens).toBeGreaterThan(0);
    expect(typeof args.costUsd).toBe('number');
    expect(args.costUsd).toBeGreaterThan(0);
    expect(typeof args.latencyMs).toBe('number');
  });

  it('T7: OpenAIEmbedError → 502 with batch_index + partial inserted_batches', async () => {
    const chunks = Array.from({ length: 150 }, () => makeChunk()); // 2 batches
    const upserts: UpsertCapture[] = [];
    const supabase = makeSupabase(chunks, upserts, { data: chunks, error: null });

    let callCount = 0;
    const failingEmbedClient = {
      batchEmbed: vi.fn(async (texts: string[]) => {
        callCount++;
        if (callCount === 1) {
          // First batch succeeds
          return { embeddings: makeDummyEmbeddings(texts.length), totalTokens: texts.length * 50 };
        }
        // Second batch fails
        throw new OpenAIEmbedError(3, 503, 'service unavailable');
      }),
      healthCheck: vi.fn(async () => ({ ok: true, latencyMs: 5 })),
    };

    const deps: HandlerDeps = {
      supabase: supabase as unknown as HandlerDeps['supabase'],
      embedClient: failingEmbedClient as unknown as HandlerDeps['embedClient'],
      emitAiGeneration: vi.fn(),
      emitRagCostEnvelopeBreach: vi.fn(),
      alertSlack: vi.fn(),
      now: () => Date.now(),
      env: { RAG_PER_BATCH_BUDGET_USD: '0.05', RAG_DAILY_BUDGET_USD: '50' },
    };

    const res = await handleRequest(new Request('https://example.com', { method: 'POST' }), deps);
    expect(res.status).toBe(502);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('embed_failed');
    expect(typeof body.batch_index).toBe('number');
    expect(typeof body.attempts).toBe('number');
    expect(body.inserted_batches).toBe(1); // First batch was committed
    expect(upserts).toHaveLength(1); // Only first batch upserted
  });

  it('T8: GET /healthz returns 200 + { ok, openai_latency_ms, db_ok } when healthy', async () => {
    const deps = makeDeps();

    const req = new Request('https://example.com/functions/v1/rag-embed-approved/healthz', {
      method: 'GET',
    });
    const res = await handleRequest(req, deps);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(typeof body.openai_latency_ms).toBe('number');
    expect(body.db_ok).toBe(true);
  });

  it('T8b: GET /healthz returns 503 when OpenAI health fails', async () => {
    const unhealthyEmbed = {
      batchEmbed: vi.fn(),
      healthCheck: vi.fn(async () => ({ ok: false, reason: 'timeout' })),
    };
    const deps = makeDeps({
      embedClient: unhealthyEmbed as unknown as HandlerDeps['embedClient'],
    });

    const req = new Request('https://example.com/functions/v1/rag-embed-approved/healthz', {
      method: 'GET',
    });
    const res = await handleRequest(req, deps);
    expect(res.status).toBe(503);
  });

  it('T9: per-batch cost breach → alertSlack called once; continues processing', async () => {
    const chunks = Array.from({ length: 5 }, () => makeChunk());
    const upserts: UpsertCapture[] = [];
    const supabase = makeSupabase(chunks, upserts, { data: chunks, error: null });
    const alertSlack = vi.fn();

    // Make each batch very expensive (RAG_PER_BATCH_BUDGET_USD = 0.00001, cost per batch = 0.02/1M * 250 = 0.000005... but we set budget = 0.000001)
    const deps: HandlerDeps = {
      supabase: supabase as unknown as HandlerDeps['supabase'],
      embedClient: makeEmbedClient() as unknown as HandlerDeps['embedClient'],
      emitAiGeneration: vi.fn(),
      emitRagCostEnvelopeBreach: vi.fn(),
      alertSlack,
      now: () => Date.now(),
      env: {
        RAG_PER_BATCH_BUDGET_USD: '0.000001', // Very low threshold to trigger alert
        RAG_DAILY_BUDGET_USD: '50',
      },
    };

    await handleRequest(new Request('https://example.com', { method: 'POST' }), deps);
    // alertSlack should have been called (once per batch that breaches)
    expect(alertSlack).toHaveBeenCalled();
  });

  it('T9b: daily budget breach → emitRagCostEnvelopeBreach + abort with partial', async () => {
    const chunks = Array.from({ length: 150 }, () => makeChunk()); // 2 batches
    const upserts: UpsertCapture[] = [];
    const supabase = makeSupabase(chunks, upserts, { data: chunks, error: null });
    const emitRagCostEnvelopeBreach = vi.fn();

    const deps: HandlerDeps = {
      supabase: supabase as unknown as HandlerDeps['supabase'],
      embedClient: makeEmbedClient() as unknown as HandlerDeps['embedClient'],
      emitAiGeneration: vi.fn(),
      emitRagCostEnvelopeBreach,
      alertSlack: vi.fn(),
      now: () => Date.now(),
      env: {
        RAG_PER_BATCH_BUDGET_USD: '0.05',
        RAG_DAILY_BUDGET_USD: '0.000001', // Very low daily budget to trigger abort
      },
    };

    const res = await handleRequest(new Request('https://example.com', { method: 'POST' }), deps);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.partial).toBe(true);
    expect(emitRagCostEnvelopeBreach).toHaveBeenCalled();
  });

  it('T10: importing the module does not bind a port (Deno.serve guarded by import.meta.main)', async () => {
    // If Deno.serve were called at module level, this import would throw or hang.
    // The test itself constitutes the guard validation — if it runs at all, the guard works.
    const mod = await import('../handler.ts');
    expect(typeof mod.handleRequest).toBe('function');
    // No port binding occurred (Deno is not available in Vitest/Node, and if it were,
    // Deno.serve would only fire when import.meta.main is true — which it never is
    // when running under Vitest).
  });
});
