/**
 * index.test.ts — Deno integration tests for rag-tip-of-day-generate/index.ts
 *
 * Phase 60 Plan 60-11 Task 4 (TDD RED → GREEN).
 *
 * Tests the exported `handler()` function with all external dependencies
 * stubbed via dependency injection (deps parameter pattern).
 *
 * Tests:
 *   1. Happy path → wrote: true, push_dispatched: true
 *   2. k-anon drop → wrote: false, refusal_reason: 'kanon_floor'
 *   3. PHARMA-02 drop → wrote: false, refusal_reason: 'pharma_02_carveout'
 *   4. Prescriptive-verb refusal → wrote: false, refusal_reason: 'prescriptive_verb'
 *   5. Out-of-corpus → wrote: false, refusal_reason: 'no_chunk_eligible'
 *   6. Cost gate breach → 429 cost_envelope_breached
 *   7. Idempotency → wrote: false, refusal_reason: 'already_written'
 *   8. Auth: anon JWT returns 401
 *   9. import.meta.main guard confirmed (no port-bind on import)
 *
 * Run: $HOME/.deno/bin/deno test --no-check --allow-env --allow-net \
 *   supabase/functions/rag-tip-of-day-generate/__tests__/index.test.ts
 */

// Set env vars before any imports
Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('OPENROUTER_API_KEY', 'test-openrouter-key');
Deno.env.set('POSTHOG_PROJECT_KEY', '');

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler, type TipDeps } from '../index.ts';
import type { RagRetrieveResult } from '../../_shared/rag-retrieve.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const SERVICE_ROLE_KEY = 'test-service-role-key';

const BASE_CHUNK = {
  chunk_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  source_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  source_type: 'fda_label' as const,
  tier: 'A' as const,
  topic_tag: 'glp1-mechanism',
  source_text_excerpt:
    'GLP-1 receptor agonists slow gastric emptying, which can affect oral medication absorption in clinical trials.',
  summary: 'GLP-1 agonists affect gastric emptying.',
  similarity: 0.9,
  rerank_score: 0.95,
  evidence_date: '2024-01-15',
  freshness_reweight_applied: false,
  public_visibility: true,
};

const GOOD_SYNTH_TEXT =
  'GLP-1 receptor agonists slow gastric emptying, which can affect oral medication absorption.';

function makeRequest(body: unknown, authorized = true): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authorized) {
    headers['Authorization'] = `Bearer ${SERVICE_ROLE_KEY}`;
  }
  return new Request('https://test.supabase.co/functions/v1/rag-tip-of-day-generate', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function makeOkRetrieveResult(chunks = [BASE_CHUNK]): RagRetrieveResult {
  return {
    refused: false,
    refusal_reason: null,
    chunks,
    trace_id: 'trace-test-001',
    reranker_provider: 'cohere',
    embed_cost_usd: 0.0001,
    rerank_cost_usd: 0.0002,
  };
}

/** Create a minimal mock Supabase client. */
function makeMockSupabase(opts: {
  existingRow?: boolean;
  writeSuccess?: boolean;
} = {}) {
  const { existingRow = false, writeSuccess = true } = opts;

  return {
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { drug: 'tirzepatide', active_themes: ['muscle-loss'] },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'kb_tip_of_day') {
        return {
          select: () => ({
            eq: (_col1: string, _v1: string) => ({
              eq: (_col2: string, _v2: string) => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: existingRow ? { id: 'existing-id' } : null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({ error: null }),
          }),
        };
      }
      return {};
    },
    rpc: async (_fn: string, _params: unknown) => ({
      data: writeSuccess ? 'new-row-id' : null,
      error: null,
    }),
    functions: {
      invoke: async (_fn: string, _opts: unknown) => ({
        data: { sent: 1, failed: 0, pruned: 0, skipped_quiet_hours: false },
        error: null,
      }),
    },
  };
}

/** Create a mock gateOrThrow that either passes or throws. */
function makeGateOrThrow(shouldThrow: boolean) {
  return async (_client: unknown, _vendor: string) => {
    if (shouldThrow) {
      const err = new Error('cost_envelope_breached');
      err.name = 'CostCapExceededError';
      throw err;
    }
  };
}

/** Create mock posthog emitters. */
function makeMockEmitters() {
  return {
    emitAiGeneration: async (_args: unknown) => {},
    emitRefusalEmitted: async (_args: unknown) => {},
    emitTipImpression: async (_args: unknown) => {},
    logVendorCost: async (_client: unknown, _args: unknown) => {},
    sendSlackGuardrailAlert: async (_channel: unknown, _payload: unknown) => {},
  };
}

/** Build a full deps object for happy-path testing. */
function makeHappyDeps(opts: {
  synthText?: string;
  retrieveResult?: RagRetrieveResult;
  existingRow?: boolean;
  gateShouldThrow?: boolean;
} = {}): TipDeps {
  const {
    synthText = GOOD_SYNTH_TEXT,
    retrieveResult = makeOkRetrieveResult(),
    existingRow = false,
    gateShouldThrow = false,
  } = opts;

  return {
    supabase: makeMockSupabase({ existingRow }) as never,
    ragRetrieve: async (_opts: unknown) => retrieveResult,
    openrouterGenerate: async (_opts: unknown) => ({
      text: synthText,
      usage: { prompt_tokens: 150, completion_tokens: 40 },
    }),
    gateOrThrow: makeGateOrThrow(gateShouldThrow),
    ...makeMockEmitters(),
    isPharma02Gated: (_chunk: unknown) => false,
    now: new Date('2026-05-26T10:00:00Z'),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Test 9: import.meta.main guard — no port-bind on import
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('handler is exported (import.meta.main guard confirmed)', () => {
  assertEquals(typeof handler, 'function');
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 8: auth — unauthorized returns 401
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('unauthorized request returns 401', async () => {
  const req = makeRequest(
    { user_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', date_utc: '2026-05-26' },
    false, // no auth header
  );
  const res = await handler(req, makeHappyDeps());
  assertEquals(res.status, 401);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 7: idempotency — row already exists returns already_written
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('already-written row returns wrote:false, refusal_reason:already_written', async () => {
  const req = makeRequest({ user_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', date_utc: '2026-05-26' });
  const deps = makeHappyDeps({ existingRow: true });
  const res = await handler(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.wrote, false);
  assertEquals(body.refusal_reason, 'already_written');
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 6: cost gate breach → 429
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('cost gate breach returns 429 cost_envelope_breached', async () => {
  const req = makeRequest({ user_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', date_utc: '2026-05-26' });
  const deps = makeHappyDeps({ gateShouldThrow: true });
  const res = await handler(req, deps);
  assertEquals(res.status, 429);
  const body = await res.json();
  assertEquals(body.error, 'cost_envelope_breached');
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 5: out-of-corpus — empty results
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('empty retrieve results returns wrote:false, refusal_reason:no_chunk_eligible', async () => {
  const req = makeRequest({ user_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', date_utc: '2026-05-26' });
  const refusedResult: RagRetrieveResult = {
    refused: true,
    refusal_reason: 'out_of_corpus',
    chunks: [],
    trace_id: 'trace-empty',
    reranker_provider: 'none',
    embed_cost_usd: 0,
    rerank_cost_usd: 0,
  };
  const deps = makeHappyDeps({ retrieveResult: refusedResult });
  const res = await handler(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.wrote, false);
  assertEquals(body.refusal_reason, 'no_chunk_eligible');
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 3: PHARMA-02 drop
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('PHARMA-02 gated chunk returns wrote:false, refusal_reason:pharma_02_carveout', async () => {
  const req = makeRequest({ user_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', date_utc: '2026-05-26' });
  const pharmChunk = { ...BASE_CHUNK, topic_tag: 'compounded-glp1-dosing' };
  const deps: TipDeps = {
    ...makeHappyDeps({ retrieveResult: makeOkRetrieveResult([pharmChunk]) }),
    isPharma02Gated: (_chunk: unknown) => true,
  };
  const res = await handler(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.wrote, false);
  assertEquals(body.refusal_reason, 'pharma_02_carveout');
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 2: k-anon drop
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('leanshot_research chunk with cohort_n<5 returns wrote:false, refusal_reason:kanon_floor', async () => {
  const req = makeRequest({ user_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', date_utc: '2026-05-26' });
  const kanonChunk = { ...BASE_CHUNK, source_type: 'leanshot_research' as const, cohort_n: 3 };
  const retrieveResult = {
    ...makeOkRetrieveResult(),
    chunks: [kanonChunk],
  };
  // Note: cohort_n is not in RagRetrievedChunk schema but can be in the actual response
  const deps = makeHappyDeps({ retrieveResult: retrieveResult as never });
  const res = await handler(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.wrote, false);
  assertEquals(body.refusal_reason, 'kanon_floor');
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 4: prescriptive-verb refusal-to-emit
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('prescriptive-verb in synth output returns wrote:false, refusal_reason:prescriptive_verb', async () => {
  const req = makeRequest({ user_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', date_utc: '2026-05-26' });
  const deps = makeHappyDeps({
    synthText: 'Take 0.5mg weekly to start your treatment.',
  });
  const res = await handler(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.wrote, false);
  // Could be prescriptive_verb or dose_number — either refusal is valid
  assertExists(body.refusal_reason);
  assertEquals(['prescriptive_verb', 'dose_number_in_push'].includes(body.refusal_reason), true);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 1: happy path
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('happy path returns wrote:true, push_dispatched:true', async () => {
  const req = makeRequest({ user_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', date_utc: '2026-05-26' });
  const deps = makeHappyDeps();
  const res = await handler(req, deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.wrote, true);
  assertExists(body.chunk_id);
  assertEquals(body.push_dispatched, true);
  assertEquals(body.refusal_reason, null);
});
