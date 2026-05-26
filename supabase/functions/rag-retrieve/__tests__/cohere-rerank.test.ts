/**
 * cohere-rerank.test.ts — Unit tests for CohereRerankClient.
 *
 * Phase 60 Plan 60-06. 5 behavior cases from plan spec.
 * Mocks fetch globally — NO live API calls.
 */

import { CohereRerankClient, RerankError } from '../cohere-rerank.ts';

const DUMMY_API_KEY = 'test-cohere-key-not-real';
const NO_SLEEP = () => Promise.resolve();

function makeMockFetch(responses: Array<{ status: number; body?: unknown }>): typeof fetch {
  let callIndex = 0;
  return ((_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const resp = responses[callIndex];
    if (!resp) {
      throw new Error(`Unexpected fetch call #${callIndex + 1} — no mock response configured`);
    }
    callIndex++;
    const bodyStr = resp.body !== undefined ? JSON.stringify(resp.body) : '';
    return Promise.resolve(
      new Response(bodyStr, {
        status: resp.status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
}

// ──────────────────────────────────────────────────────────────────────────────

Deno.test('throws empty_docs on 0 documents', async () => {
  const client = new CohereRerankClient(DUMMY_API_KEY, makeMockFetch([]), NO_SLEEP);
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
  const client = new CohereRerankClient(DUMMY_API_KEY, makeMockFetch([]), NO_SLEEP);
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

Deno.test('returns results + cost 0.002 on success', async () => {
  const mockResponse = {
    results: [{ index: 0, relevance_score: 0.92 }, { index: 1, relevance_score: 0.78 }],
  };
  const client = new CohereRerankClient(
    DUMMY_API_KEY,
    makeMockFetch([{ status: 200, body: mockResponse }]),
    NO_SLEEP,
  );
  const result = await client.rerank({ query: 'test query', documents: ['doc1', 'doc2'], topN: 2 });

  if (Math.abs(result.costUsd - 0.002) > 1e-9) {
    throw new Error(`Expected costUsd=0.002; got ${result.costUsd}`);
  }
  if (result.model !== 'rerank-v3.5') {
    throw new Error(`Expected model='rerank-v3.5'; got '${result.model}'`);
  }
  if (result.results.length !== 2) {
    throw new Error(`Expected 2 results; got ${result.results.length}`);
  }
  if (Math.abs(result.results[0].score - 0.92) > 1e-9) {
    throw new Error(`Expected results[0].score=0.92; got ${result.results[0].score}`);
  }
  if (result.results[0].index !== 0) {
    throw new Error(`Expected results[0].index=0; got ${result.results[0].index}`);
  }
});

Deno.test('retries 3x with backoff on 429 — succeeds on 3rd attempt', async () => {
  const mockResponse = {
    results: [{ index: 0, relevance_score: 0.85 }],
  };
  let callCount = 0;
  const mockFetch: typeof fetch = ((_url: string | URL | Request, _init?: RequestInit) => {
    callCount++;
    if (callCount < 3) {
      return Promise.resolve(new Response('rate limited', { status: 429 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;

  const client = new CohereRerankClient(DUMMY_API_KEY, mockFetch, NO_SLEEP);
  const result = await client.rerank({ query: 'test', documents: ['doc1', 'doc2'], topN: 1 });

  if (callCount !== 3) {
    throw new Error(`Expected 3 fetch calls; got ${callCount}`);
  }
  if (result.results.length !== 1) {
    throw new Error(`Expected 1 result; got ${result.results.length}`);
  }
});

Deno.test('throws api_error after 3 failed attempts (all 500)', async () => {
  let callCount = 0;
  const mockFetch: typeof fetch = ((_url: string | URL | Request, _init?: RequestInit) => {
    callCount++;
    return Promise.resolve(new Response('internal error', { status: 500 }));
  }) as typeof fetch;

  const client = new CohereRerankClient(DUMMY_API_KEY, mockFetch, NO_SLEEP);
  let threw = false;
  try {
    await client.rerank({ query: 'test', documents: ['doc1', 'doc2'], topN: 1 });
  } catch (err) {
    if (err instanceof RerankError && err.code === 'api_error') {
      threw = true;
    } else {
      throw err;
    }
  }
  if (!threw) throw new Error('Expected RerankError with code=api_error after 3 failed attempts');
  if (callCount !== 3) {
    throw new Error(`Expected exactly 3 fetch attempts; got ${callCount}`);
  }
});
