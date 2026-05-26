/**
 * rag-retrieve.test.ts — Deno tests for _shared/rag-retrieve.ts
 *
 * Phase 60 Plan 60-02.
 *
 * All tests stub `globalThis.fetch` — no real network or Supabase connection.
 *
 * Behaviors tested:
 *  1. Happy path: stub returns valid envelope → typed result returned.
 *  2. Refusal passes through, no throw.
 *  3. Retry on 5xx then success: fetch called twice, valid result returned.
 *  4. Throws RagRetrieveNetworkError after 2× 5xx.
 *  5. 4xx throws immediately, no retry.
 *  6. Malformed body throws RagRetrieveSchemaError.
 *  7. Auth header switches on userJwt vs SUPABASE_SERVICE_ROLE_KEY.
 *  8. k defaults to 8 when omitted.
 */

import { assertEquals, assertInstanceOf, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { RagRetrieveNetworkError, RagRetrieveSchemaError, retrieveRagChunks } from './rag-retrieve.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Test fixture: minimal valid RagRetrieveResult
// ──────────────────────────────────────────────────────────────────────────────

const VALID_CHUNK = {
  chunk_id: '00000000-0000-0000-0000-000000000001',
  source_id: '00000000-0000-0000-0000-000000000002',
  source_type: 'fda_label',
  tier: 'A',
  topic_tag: 'tirzepatide.titration',
  source_text_excerpt: 'lorem ipsum',
  summary: 'ipsum dolor',
  similarity: 0.82,
  rerank_score: 0.91,
  evidence_date: '2025-01-15',
  freshness_reweight_applied: false,
  public_visibility: true,
};

const VALID_ENVELOPE = {
  refused: false,
  refusal_reason: null,
  chunks: [VALID_CHUNK],
  trace_id: 't1',
  reranker_provider: 'cohere',
  embed_cost_usd: 0.00002,
  rerank_cost_usd: 0.002,
};

const REFUSAL_ENVELOPE = {
  refused: true,
  refusal_reason: 'out_of_corpus',
  chunks: [],
  trace_id: 't2',
  reranker_provider: 'none',
  embed_cost_usd: 0.00002,
  rerank_cost_usd: 0,
};

function setEnv() {
  Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'svc-key-xyz');
}

function clearEnv() {
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('1. happy path returns typed result', async () => {
  setEnv();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(VALID_ENVELOPE), { status: 200 });

  try {
    const result = await retrieveRagChunks({ query: 'tirzepatide dosing', userJwt: 'user-jwt' });
    assertEquals(result.refused, false);
    assertEquals(result.chunks.length, 1);
    assertEquals(result.chunks[0].source_type, 'fda_label');
    assertEquals(result.reranker_provider, 'cohere');
  } finally {
    globalThis.fetch = origFetch;
    clearEnv();
  }
});

Deno.test('2. refusal passes through, no throw', async () => {
  setEnv();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(REFUSAL_ENVELOPE), { status: 200 });

  try {
    const result = await retrieveRagChunks({ query: 'compounded semaglutide dose', userJwt: 'user-jwt' });
    assertEquals(result.refused, true);
    assertEquals(result.refusal_reason, 'out_of_corpus');
    assertEquals(result.chunks.length, 0);
  } finally {
    globalThis.fetch = origFetch;
    clearEnv();
  }
});

Deno.test('3. retry on 5xx then success — fetch called twice', async () => {
  setEnv();
  const origFetch = globalThis.fetch;

  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) return new Response('Server Error', { status: 500 });
    return new Response(JSON.stringify(VALID_ENVELOPE), { status: 200 });
  };

  try {
    const result = await retrieveRagChunks({ query: 'q', userJwt: 'jwt' });
    assertEquals(callCount, 2, 'fetch must be called exactly twice (1 retry)');
    assertEquals(result.refused, false);
    assertEquals(result.chunks.length, 1);
  } finally {
    globalThis.fetch = origFetch;
    clearEnv();
  }
});

Deno.test('4. throws RagRetrieveNetworkError after 2× 5xx', async () => {
  setEnv();
  const origFetch = globalThis.fetch;

  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return new Response('Server Error', { status: 500 });
  };

  try {
    await assertRejects(
      () => retrieveRagChunks({ query: 'q', userJwt: 'jwt' }),
      RagRetrieveNetworkError,
    );
    assertEquals(callCount, 2, 'fetch must be called exactly 2 times before giving up');
  } finally {
    globalThis.fetch = origFetch;
    clearEnv();
  }
});

Deno.test('5. 4xx throws immediately, no retry', async () => {
  setEnv();
  const origFetch = globalThis.fetch;

  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return new Response('Bad Request', { status: 400 });
  };

  try {
    await assertRejects(
      () => retrieveRagChunks({ query: 'q', userJwt: 'jwt' }),
      RagRetrieveNetworkError,
    );
    assertEquals(callCount, 1, 'fetch must be called exactly once on 4xx (no retry)');
  } finally {
    globalThis.fetch = origFetch;
    clearEnv();
  }
});

Deno.test('6. malformed body throws RagRetrieveSchemaError', async () => {
  setEnv();
  const origFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ refused: false, refusal_reason: null, chunks: 'NOT_AN_ARRAY' }),
      { status: 200 },
    );

  try {
    const err = await assertRejects(
      () => retrieveRagChunks({ query: 'q', userJwt: 'jwt' }),
    );
    assertInstanceOf(err, RagRetrieveSchemaError);
  } finally {
    globalThis.fetch = origFetch;
    clearEnv();
  }
});

Deno.test('7. auth header switches on userJwt vs SUPABASE_SERVICE_ROLE_KEY', async () => {
  setEnv();
  const origFetch = globalThis.fetch;

  const capturedHeaders: string[] = [];
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const authHeader = (init?.headers as Record<string, string>)?.['Authorization'] ?? '';
    capturedHeaders.push(authHeader);
    return new Response(JSON.stringify(VALID_ENVELOPE), { status: 200 });
  };

  try {
    // Call 1: userJwt provided → should use user JWT
    await retrieveRagChunks({ query: 'q', userJwt: 'user-jwt-abc' });
    assertEquals(capturedHeaders[0], 'Bearer user-jwt-abc', 'Must use userJwt when provided');

    // Call 2: no userJwt → should use service role key from env
    await retrieveRagChunks({ query: 'q' });
    assertEquals(capturedHeaders[1], 'Bearer svc-key-xyz', 'Must use SUPABASE_SERVICE_ROLE_KEY when userJwt absent');
  } finally {
    globalThis.fetch = origFetch;
    clearEnv();
  }
});

Deno.test('8. k defaults to 8 when omitted', async () => {
  setEnv();
  const origFetch = globalThis.fetch;

  let capturedK: number | undefined;
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    capturedK = body.k;
    return new Response(JSON.stringify(VALID_ENVELOPE), { status: 200 });
  };

  try {
    await retrieveRagChunks({ query: 'q', userJwt: 'jwt' }); // no k
    assertEquals(capturedK, 8, 'k must default to 8 when not provided');
  } finally {
    globalThis.fetch = origFetch;
    clearEnv();
  }
});
