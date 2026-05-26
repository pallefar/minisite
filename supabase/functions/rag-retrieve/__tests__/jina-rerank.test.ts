/**
 * jina-rerank.test.ts — Unit tests for JinaRerankClient.
 *
 * Phase 60 Plan 60-06. 5 behavior cases from plan spec.
 * Mocks fetch globally — NO live API calls.
 */

import { JinaRerankClient, RerankError } from '../jina-rerank.ts';
import { CohereRerankClient } from '../cohere-rerank.ts';
import type { RerankResult } from '../cohere-rerank.ts';

const DUMMY_API_KEY = 'test-jina-key-not-real';
const NO_SLEEP = () => Promise.resolve();
const EPSILON = 1e-9;

function assertClose(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > EPSILON) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function makeMockFetch(responses: Array<{ status: number; body?: unknown }>): typeof fetch {
  let callIndex = 0;
  return ((_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const resp = responses[callIndex];
    if (!resp) {
      throw new Error(`Unexpected fetch call #${callIndex + 1} — no mock configured`);
    }
    callIndex++;
    return Promise.resolve(
      new Response(resp.body !== undefined ? JSON.stringify(resp.body) : '', {
        status: resp.status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
}

// ──────────────────────────────────────────────────────────────────────────────

Deno.test('throws empty_docs on 0 documents', async () => {
  const client = new JinaRerankClient(DUMMY_API_KEY, makeMockFetch([]), NO_SLEEP);
  let threw = false;
  try {
    await client.rerank({ query: 'test', documents: [], topN: 3 });
  } catch (err) {
    if (err instanceof RerankError && err.code === 'empty_docs') {
      threw = true;
    } else {
      throw err;
    }
  }
  if (!threw) throw new Error('Expected RerankError with code=empty_docs');
});

Deno.test('throws too_many_docs on 21 documents', async () => {
  const docs = Array.from({ length: 21 }, (_, i) => `doc ${i}`);
  const client = new JinaRerankClient(DUMMY_API_KEY, makeMockFetch([]), NO_SLEEP);
  let threw = false;
  try {
    await client.rerank({ query: 'test', documents: docs, topN: 3 });
  } catch (err) {
    if (err instanceof RerankError && err.code === 'too_many_docs') {
      threw = true;
    } else {
      throw err;
    }
  }
  if (!threw) throw new Error('Expected RerankError with code=too_many_docs');
});

Deno.test('returns results + cost computed from tokens on success', async () => {
  const mockResponse = {
    results: [{ index: 0, relevance_score: 0.88 }],
    usage: { total_tokens: 500 },
  };
  const client = new JinaRerankClient(
    DUMMY_API_KEY,
    makeMockFetch([{ status: 200, body: mockResponse }]),
    NO_SLEEP,
  );
  const result = await client.rerank({ query: 'test', documents: ['doc1', 'doc2'], topN: 1 });

  // costUsd = 0.000018 * 500 / 1000 = 0.000009
  assertClose(result.costUsd, 0.000009, 'Jina cost from 500 tokens');
  if (result.model !== 'jina-reranker-v2-base-multilingual') {
    throw new Error(`Expected model='jina-reranker-v2-base-multilingual'; got '${result.model}'`);
  }
  if (result.tokensUsed !== 500) {
    throw new Error(`Expected tokensUsed=500; got ${result.tokensUsed}`);
  }
  if (result.results.length !== 1) {
    throw new Error(`Expected 1 result; got ${result.results.length}`);
  }
  assertClose(result.results[0].score, 0.88, 'relevance_score');
});

Deno.test('retries 3x with backoff on 503', async () => {
  const mockResponse = {
    results: [{ index: 0, relevance_score: 0.75 }],
    usage: { total_tokens: 200 },
  };
  let callCount = 0;
  const mockFetch: typeof fetch = ((_url: string | URL | Request, _init?: RequestInit) => {
    callCount++;
    if (callCount < 3) {
      return Promise.resolve(new Response('service unavailable', { status: 503 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;

  const client = new JinaRerankClient(DUMMY_API_KEY, mockFetch, NO_SLEEP);
  const result = await client.rerank({ query: 'test', documents: ['doc1', 'doc2'], topN: 1 });

  if (callCount !== 3) {
    throw new Error(`Expected 3 fetch calls; got ${callCount}`);
  }
  if (result.results.length !== 1) {
    throw new Error(`Expected 1 result; got ${result.results.length}`);
  }
});

Deno.test('returns same-shaped RerankResult as Cohere (sibling-API compat)', async () => {
  // Type-level compatibility test: both clients return Promise<RerankResult>
  // Compile-time check via assignment to typed variable.
  const mockJinaResponse = {
    results: [{ index: 0, relevance_score: 0.9 }],
    usage: { total_tokens: 100 },
  };
  const mockCohereResponse = {
    results: [{ index: 0, relevance_score: 0.9 }],
  };

  const jinaClient = new JinaRerankClient(
    DUMMY_API_KEY,
    makeMockFetch([{ status: 200, body: mockJinaResponse }]),
    NO_SLEEP,
  );
  const cohereClient = new CohereRerankClient(
    DUMMY_API_KEY,
    makeMockFetch([{ status: 200, body: mockCohereResponse }]),
    NO_SLEEP,
  );

  const jinaResult: RerankResult = await jinaClient.rerank({ query: 'q', documents: ['d1'], topN: 1 });
  const cohereResult: RerankResult = await cohereClient.rerank({ query: 'q', documents: ['d1'], topN: 1 });

  // Both have same shape
  const jinaKeys = Object.keys(jinaResult).sort();
  const cohereKeys = Object.keys(cohereResult).sort();
  if (JSON.stringify(jinaKeys) !== JSON.stringify(cohereKeys)) {
    throw new Error(`Shape mismatch: Jina=${jinaKeys} Cohere=${cohereKeys}`);
  }
  if (typeof jinaResult.results !== 'object') throw new Error('Jina: missing results');
  if (typeof jinaResult.costUsd !== 'number') throw new Error('Jina: missing costUsd');
  if (typeof jinaResult.model !== 'string') throw new Error('Jina: missing model');
  if (typeof cohereResult.results !== 'object') throw new Error('Cohere: missing results');
  if (typeof cohereResult.costUsd !== 'number') throw new Error('Cohere: missing costUsd');
});
