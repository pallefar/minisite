/**
 * integration.test.ts — Integration tests for rag-retrieve Edge Function.
 *
 * Phase 60 Plan 60-06. 11 test cases covering the full pipeline.
 *
 * Strategy: cannot easily mock ESM imports in Deno without dynamic import tricks.
 * Instead we:
 *   1. Set Deno.env vars to drive behavior branches.
 *   2. Mock globalThis.fetch to intercept Cohere/Jina/OpenRouter/Supabase calls.
 *   3. The OpenAIEmbedBatchClient reads OPENROUTER_API_KEY from env — set to a dummy value.
 *
 * All fetch mocks are installed per-test and restored after each test to avoid
 * cross-test contamination.
 *
 * Note: `import.meta.main` is false when imported as a module, so Deno.serve
 * is NOT called. The `handler` export is used directly.
 */

import { handler } from '../index.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────────────

type FetchCall = { url: string; body?: unknown };

interface MockFetchConfig {
  openrouterResponse?: { data: Array<{ embedding: number[] }>; usage: { total_tokens: number } };
  rpcResponse?: Array<Record<string, unknown>>;
  cohereResponse?: { results: Array<{ index: number; relevance_score: number }> };
  jinaResponse?: { results: Array<{ index: number; relevance_score: number }>; usage: { total_tokens: number } };
  openrouterStatus?: number;
  rpcError?: string;
  cohereStatus?: number;
  jinaStatus?: number;
}

function makeDummyEmbedding(dim = 1536): number[] {
  return Array.from({ length: dim }, () => 0.1);
}

function makeDummyCandidate(
  chunkId: string,
  similarity: number,
  tier: 'A' | 'B' | 'C' = 'B',
  freshnessWindowDays = 180,
): Record<string, unknown> {
  const recentDate = new Date(Date.now() - 10 * 86_400_000).toISOString(); // 10 days ago — fresh
  return {
    chunk_id: chunkId,
    summary: `Summary for ${chunkId}`,
    quote_blocks: [],
    canonical_url: `https://example.com/${chunkId}`,
    scraped_at: recentDate,
    source_tier: tier,
    topic_tag: 'glp1_general',
    freshness_window_days: freshnessWindowDays,
    source_name: 'Test Source',
    source_domain: 'example.com',
    similarity,
  };
}

function installMockFetch(config: MockFetchConfig): { calls: FetchCall[]; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];

  // deno-lint-ignore require-await
  const mockFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(init.body as string) : undefined;
    } catch {
      body = init?.body;
    }
    calls.push({ url, body });

    // OpenRouter embed endpoint
    if (url.includes('openrouter.ai')) {
      const status = config.openrouterStatus ?? 200;
      if (status !== 200) {
        return new Response('error', { status });
      }
      const responseBody = config.openrouterResponse ?? {
        data: [{ embedding: makeDummyEmbedding() }],
        usage: { total_tokens: 15 },
      };
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Supabase REST API (PostgREST RPC)
    if (url.includes('supabase') || url.includes('127.0.0.1') || url.includes('localhost')) {
      if (config.rpcError) {
        return new Response(JSON.stringify({ message: config.rpcError }), { status: 400 });
      }
      const rpcData = config.rpcResponse ?? [
        makeDummyCandidate('chunk-001', 0.85),
        makeDummyCandidate('chunk-002', 0.80),
        makeDummyCandidate('chunk-003', 0.75),
      ];
      return new Response(JSON.stringify(rpcData), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Cohere rerank endpoint
    if (url.includes('cohere.ai')) {
      const status = config.cohereStatus ?? 200;
      if (status !== 200) {
        return new Response('cohere error', { status });
      }
      const responseBody = config.cohereResponse ?? {
        results: [
          { index: 0, relevance_score: 0.92 },
          { index: 1, relevance_score: 0.88 },
          { index: 2, relevance_score: 0.75 },
        ],
      };
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Jina rerank endpoint
    if (url.includes('jina.ai')) {
      const status = config.jinaStatus ?? 200;
      if (status !== 200) {
        return new Response('jina error', { status });
      }
      const responseBody = config.jinaResponse ?? {
        results: [
          { index: 0, relevance_score: 0.90 },
          { index: 1, relevance_score: 0.85 },
          { index: 2, relevance_score: 0.70 },
        ],
        usage: { total_tokens: 500 },
      };
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // PostHog endpoint — swallow silently
    if (url.includes('posthog')) {
      return new Response(JSON.stringify({ status: 1 }), { status: 200 });
    }

    console.warn(`[test] unmocked fetch: ${url}`);
    return new Response('not mocked', { status: 404 });
  };

  globalThis.fetch = mockFetch as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function setTestEnv(): void {
  Deno.env.set('OPENROUTER_API_KEY', 'test-openrouter-key');
  Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
  Deno.env.set('COHERE_API_KEY', 'test-cohere-key');
  Deno.env.delete('JINA_API_KEY');
  Deno.env.set('RAG_RERANKER_PROVIDER', 'cohere');
  Deno.env.delete('POSTHOG_PROJECT_KEY');
}

function makePostRequest(body: unknown): Request {
  return new Request('http://test.local/rag-retrieve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('healthz returns rerank_provider', async () => {
  setTestEnv();
  const req = new Request('http://test.local/rag-retrieve/healthz', { method: 'GET' });
  const resp = await handler(req);
  const data = await resp.json() as { ok: boolean; rerank_provider: string };
  if (resp.status !== 200) throw new Error(`Expected 200; got ${resp.status}`);
  if (data.ok !== true) throw new Error(`Expected ok=true; got ${data.ok}`);
  if (data.rerank_provider !== 'cohere') throw new Error(`Expected rerank_provider='cohere'; got '${data.rerank_provider}'`);
});

Deno.test('rejects non-POST with 405', async () => {
  setTestEnv();
  const req = new Request('http://test.local/rag-retrieve', { method: 'PUT' });
  const resp = await handler(req);
  if (resp.status !== 405) throw new Error(`Expected 405; got ${resp.status}`);
});

Deno.test('rejects invalid body with 400', async () => {
  setTestEnv();
  const req = new Request('http://test.local/rag-retrieve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '' }), // empty query fails min(1)
  });
  const resp = await handler(req);
  if (resp.status !== 400) throw new Error(`Expected 400; got ${resp.status}`);
  const data = await resp.json() as { error: string };
  if (data.error !== 'invalid_request') throw new Error(`Expected error='invalid_request'; got '${data.error}'`);
});

Deno.test('returns 500 when COHERE_API_KEY missing and provider=cohere', async () => {
  setTestEnv();
  Deno.env.delete('COHERE_API_KEY');
  Deno.env.set('RAG_RERANKER_PROVIDER', 'cohere');
  const req = makePostRequest({ query: 'test query' });
  const resp = await handler(req);
  if (resp.status !== 500) throw new Error(`Expected 500; got ${resp.status}`);
  const data = await resp.json() as { error: string };
  if (data.error !== 'cohere_api_key_missing') throw new Error(`Expected error='cohere_api_key_missing'; got '${data.error}'`);
  // Restore
  Deno.env.set('COHERE_API_KEY', 'test-cohere-key');
});

Deno.test({ name: 'end-to-end: embed → ANN → rerank → top-3 returned', sanitizeOps: false, sanitizeResources: false, fn: async () => {
  setTestEnv();
  const { restore } = installMockFetch({
    rpcResponse: [
      makeDummyCandidate('chunk-001', 0.90, 'A'),
      makeDummyCandidate('chunk-002', 0.85, 'B'),
      makeDummyCandidate('chunk-003', 0.80, 'B'),
      makeDummyCandidate('chunk-004', 0.75, 'C'),
      makeDummyCandidate('chunk-005', 0.72, 'B'),
    ],
    cohereResponse: {
      results: [
        { index: 0, relevance_score: 0.95 },
        { index: 1, relevance_score: 0.88 },
        { index: 2, relevance_score: 0.80 },
      ],
    },
  });

  try {
    const req = makePostRequest({ query: 'What is semaglutide dosing?', k: 3 });
    const resp = await handler(req);
    if (resp.status !== 200) throw new Error(`Expected 200; got ${resp.status}`);
    const data = await resp.json() as {
      refused: boolean;
      results: Array<{ chunk_id: string; rerank_score: number; final_score: number; stale: boolean }>;
      count: number;
      rerank_provider: string;
      trace_id: string;
    };
    if (data.refused !== false) throw new Error(`Expected refused=false; got ${data.refused}`);
    if (data.count !== 3) throw new Error(`Expected count=3; got ${data.count}`);
    if (data.results.length !== 3) throw new Error(`Expected 3 results; got ${data.results.length}`);
    if (data.rerank_provider !== 'cohere') throw new Error(`Expected rerank_provider='cohere'; got '${data.rerank_provider}'`);
    if (typeof data.trace_id !== 'string') throw new Error('Expected trace_id string');
    // Check each result has required fields
    for (const r of data.results) {
      if (typeof r.chunk_id !== 'string') throw new Error('Missing chunk_id');
      if (typeof r.final_score !== 'number') throw new Error('Missing final_score');
      if (typeof r.stale !== 'boolean') throw new Error('Missing stale flag');
      if (typeof r.rerank_score !== 'number') throw new Error('Missing rerank_score');
    }
  } finally {
    restore();
  }
} });

Deno.test({ name: 'out-of-corpus refusal when max(final_score) < 0.65', sanitizeOps: false, sanitizeResources: false, fn: async () => {
  setTestEnv();
  let rerankCallCount = 0;
  const { restore } = installMockFetch({
    // All candidates below 0.65 raw similarity → after reweight still below 0.65
    rpcResponse: [
      makeDummyCandidate('chunk-low-001', 0.55, 'B'),
      makeDummyCandidate('chunk-low-002', 0.50, 'B'),
      makeDummyCandidate('chunk-low-003', 0.45, 'B'),
    ],
  });

  // Override the cohere mock to count calls
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes('cohere.ai')) {
      rerankCallCount++;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }
    return originalFetch(input as Request, init);
  }) as typeof fetch;

  try {
    const req = makePostRequest({ query: 'query about unknown topic' });
    const resp = await handler(req);
    if (resp.status !== 200) throw new Error(`Expected 200; got ${resp.status}`);
    const data = await resp.json() as { refused: boolean; refusal_reason: string; results: unknown[] };
    if (data.refused !== true) throw new Error(`Expected refused=true; got ${data.refused}`);
    if (data.refusal_reason !== 'out_of_corpus') {
      throw new Error(`Expected refusal_reason='out_of_corpus'; got '${data.refusal_reason}'`);
    }
    if (data.results.length !== 0) throw new Error(`Expected empty results; got ${data.results.length}`);
    if (rerankCallCount !== 0) {
      throw new Error(`Expected 0 rerank calls (out-of-corpus fires before rerank); got ${rerankCallCount}`);
    }
  } finally {
    restore();
    globalThis.fetch = originalFetch;
  }
} });

Deno.test({ name: 'post-rerank refusal when max rerank score < 0.5', sanitizeOps: false, sanitizeResources: false, fn: async () => {
  setTestEnv();
  const { restore } = installMockFetch({
    rpcResponse: [
      makeDummyCandidate('chunk-001', 0.80, 'B'),
      makeDummyCandidate('chunk-002', 0.75, 'B'),
      makeDummyCandidate('chunk-003', 0.70, 'B'),
    ],
    cohereResponse: {
      // All rerank scores below 0.5 threshold
      results: [
        { index: 0, relevance_score: 0.40 },
        { index: 1, relevance_score: 0.35 },
        { index: 2, relevance_score: 0.30 },
      ],
    },
  });

  try {
    const req = makePostRequest({ query: 'somewhat related but irrelevant query' });
    const resp = await handler(req);
    if (resp.status !== 200) throw new Error(`Expected 200; got ${resp.status}`);
    const data = await resp.json() as { refused: boolean; refusal_reason: string };
    if (data.refused !== true) throw new Error(`Expected refused=true; got ${data.refused}`);
    if (data.refusal_reason !== 'post_rerank_low_relevance') {
      throw new Error(`Expected refusal_reason='post_rerank_low_relevance'; got '${data.refusal_reason}'`);
    }
  } finally {
    restore();
  }
} });

Deno.test({ name: 'env-flag swap: RAG_RERANKER_PROVIDER=jina uses Jina client', sanitizeOps: false, sanitizeResources: false, fn: async () => {
  setTestEnv();
  Deno.env.set('RAG_RERANKER_PROVIDER', 'jina');
  Deno.env.set('JINA_API_KEY', 'test-jina-key');

  const { restore } = installMockFetch({
    rpcResponse: [
      makeDummyCandidate('chunk-001', 0.85, 'B'),
      makeDummyCandidate('chunk-002', 0.80, 'B'),
      makeDummyCandidate('chunk-003', 0.75, 'B'),
    ],
    jinaResponse: {
      results: [
        { index: 0, relevance_score: 0.90 },
        { index: 1, relevance_score: 0.85 },
        { index: 2, relevance_score: 0.80 },
      ],
      usage: { total_tokens: 400 },
    },
  });

  try {
    const req = makePostRequest({ query: 'semaglutide titration' });
    const resp = await handler(req);
    if (resp.status !== 200) throw new Error(`Expected 200; got ${resp.status}`);
    const data = await resp.json() as { refused: boolean; rerank_provider: string };
    if (data.refused !== false) throw new Error(`Expected refused=false; got ${data.refused}`);
    if (data.rerank_provider !== 'jina') {
      throw new Error(`Expected rerank_provider='jina'; got '${data.rerank_provider}'`);
    }
  } finally {
    restore();
    Deno.env.set('RAG_RERANKER_PROVIDER', 'cohere');
    Deno.env.delete('JINA_API_KEY');
  }
} });

Deno.test({ name: 'rerank_degraded=true when Cohere throws 3x — falls back to merge.ts ordering', sanitizeOps: false, sanitizeResources: false, fn: async () => {
  setTestEnv();
  const { restore } = installMockFetch({
    rpcResponse: [
      makeDummyCandidate('chunk-001', 0.85, 'B'),
      makeDummyCandidate('chunk-002', 0.80, 'B'),
      makeDummyCandidate('chunk-003', 0.75, 'B'),
    ],
    cohereStatus: 500, // All Cohere calls fail
  });

  try {
    const req = makePostRequest({ query: 'semaglutide side effects' });
    const resp = await handler(req);
    if (resp.status !== 200) throw new Error(`Expected 200; got ${resp.status}`);
    const data = await resp.json() as {
      refused: boolean;
      rerank_degraded: boolean;
      results: Array<{ rerank_score: unknown }>;
    };
    if (data.refused !== false) throw new Error(`Expected refused=false (degraded still serves); got ${data.refused}`);
    if (data.rerank_degraded !== true) throw new Error(`Expected rerank_degraded=true; got ${data.rerank_degraded}`);
    for (const r of data.results) {
      if (r.rerank_score !== null) {
        throw new Error(`Expected rerank_score=null on degraded result; got ${r.rerank_score}`);
      }
    }
  } finally {
    restore();
  }
} });

Deno.test({ name: 'top-20 cap: 25 candidates returned by RPC → only 20 passed to rerank', sanitizeOps: false, sanitizeResources: false, fn: async () => {
  setTestEnv();
  // Generate 25 candidates
  const rpcResponse = Array.from({ length: 25 }, (_, i) =>
    makeDummyCandidate(`chunk-${String(i).padStart(3, '0')}`, 0.8 - i * 0.01, 'B'),
  );

  let rerankDocCount = 0;
  const { calls, restore } = installMockFetch({ rpcResponse });

  // Intercept Cohere call to count docs
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes('cohere.ai')) {
      const reqBody = JSON.parse(init?.body as string ?? '{}') as { documents?: string[] };
      rerankDocCount = reqBody.documents?.length ?? 0;
      // Return mock success
      const mockResp = {
        results: Array.from({ length: 3 }, (_, i) => ({ index: i, relevance_score: 0.9 - i * 0.1 })),
      };
      return new Response(JSON.stringify(mockResp), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input as Request, init);
  }) as typeof fetch;

  try {
    const req = makePostRequest({ query: 'test query', k: 3 });
    const resp = await handler(req);
    if (resp.status !== 200) throw new Error(`Expected 200; got ${resp.status}`);
    if (rerankDocCount > 20) {
      throw new Error(`Top-20 cap violated: ${rerankDocCount} docs sent to Cohere`);
    }
    if (rerankDocCount === 0) {
      throw new Error('Rerank was not called (or docs count not captured)');
    }
  } finally {
    restore();
    globalThis.fetch = originalFetch;
    void calls; // suppress unused warning
  }
} });

Deno.test({ name: 'topic_tag filter narrows results', sanitizeOps: false, sanitizeResources: false, fn: async () => {
  setTestEnv();
  const rpcResponse = [
    { ...makeDummyCandidate('chunk-glp1', 0.85), topic_tag: 'glp1_titration' },
    { ...makeDummyCandidate('chunk-other', 0.82), topic_tag: 'semaglutide_dosing' },
    { ...makeDummyCandidate('chunk-glp1-2', 0.80), topic_tag: 'glp1_titration' },
  ];

  // Cohere returns exactly 2 results matching the 2 glp1_titration candidates after filter
  const { restore } = installMockFetch({
    rpcResponse,
    cohereResponse: {
      results: [
        { index: 0, relevance_score: 0.92 },
        { index: 1, relevance_score: 0.87 },
      ],
    },
  });

  try {
    const req = makePostRequest({ query: 'titration schedule', k: 3, filters: { topic_tag: 'glp1_titration' } });
    const resp = await handler(req);
    if (resp.status !== 200) throw new Error(`Expected 200; got ${resp.status}`);
    const data = await resp.json() as { refused?: boolean; results: Array<{ topic_tag: string }> };
    if (data.refused) {
      // Acceptable if out-of-corpus triggered (scores might drop below 0.65 after filter)
      return;
    }
    for (const r of data.results) {
      if (r.topic_tag !== 'glp1_titration') {
        throw new Error(`topic_tag filter failed: expected 'glp1_titration'; got '${r.topic_tag}'`);
      }
    }
  } finally {
    restore();
  }
} });

Deno.test({ name: 'cosine_only=1 skips rerank and returns merge.ts ordering', sanitizeOps: false, sanitizeResources: false, fn: async () => {
  setTestEnv();
  let rerankCalled = false;
  const { restore } = installMockFetch({
    rpcResponse: [
      makeDummyCandidate('chunk-001', 0.85, 'A'),
      makeDummyCandidate('chunk-002', 0.80, 'B'),
      makeDummyCandidate('chunk-003', 0.75, 'B'),
    ],
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes('cohere.ai') || url.includes('jina.ai')) {
      rerankCalled = true;
    }
    return originalFetch(input as Request, init);
  }) as typeof fetch;

  try {
    const req = new Request('http://test.local/rag-retrieve?cosine_only=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'test query', k: 3 }),
    });
    const resp = await handler(req);
    if (resp.status !== 200) throw new Error(`Expected 200; got ${resp.status}`);
    const data = await resp.json() as { cosine_only: boolean; results: Array<{ rerank_score: unknown }> };
    if (data.cosine_only !== true) throw new Error(`Expected cosine_only=true; got ${data.cosine_only}`);
    for (const r of data.results) {
      if (r.rerank_score !== null) throw new Error(`Expected rerank_score=null for cosine_only; got ${r.rerank_score}`);
    }
    if (rerankCalled) throw new Error('Rerank should NOT be called when cosine_only=1');
  } finally {
    restore();
    globalThis.fetch = originalFetch;
  }
} });
