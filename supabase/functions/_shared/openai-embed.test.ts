/**
 * Phase 38 Plan 38-02 — tests for openai-embed.ts.
 *
 * Coverage:
 *  T1: embed POSTs to ${BASE}/embeddings with {model, input}, returns data[0].embedding
 *  T2: embed honors 429 Retry-After + retries up to 3
 *  T3: embed throws on non-2xx with bounded error string
 *  Pre-embed scrub: dose-change phrasing is replaced before fetch
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@^1';
import { embed } from './openai-embed.ts';

interface FetchCapture {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function makeMockFetch(
  responder: (call: number) => Response | Promise<Response>,
  capture: FetchCapture[],
): typeof fetch {
  let callCount = 0;
  return (input: RequestInfo | URL, init?: RequestInit) => {
    callCount++;
    const url = String(input);
    const bodyStr = (init?.body ?? '{}') as string;
    capture.push({ url, init: init ?? {}, body: JSON.parse(bodyStr) });
    const res = responder(callCount);
    return Promise.resolve(res);
  };
}

function setEnv() {
  Deno.env.set('AI_GATEWAY_API_KEY_CONSUMER', 'sb_consumer_test_key');
  Deno.env.set('AI_GATEWAY_BASE_URL', 'https://ai-gateway.vercel.sh/v1');
  Deno.env.set('OPENAI_EMBED_MODEL', 'openai/text-embedding-3-small');
}

function makeEmbeddingResponse(): Response {
  const embedding = Array.from({ length: 1536 }, (_, i) => Math.sin(i) * 0.01);
  return new Response(JSON.stringify({ data: [{ embedding }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── T1 ────────────────────────────────────────────────────────────────────

Deno.test('T1: embed POSTs to /embeddings with {model, input}; returns 1536-d vector', async () => {
  setEnv();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeMockFetch(() => makeEmbeddingResponse(), capture);

  const vec = await embed('GLP-1 user with weight loss goal in escalation phase.', { fetchImpl });

  assertEquals(vec.length, 1536);
  assertEquals(capture.length, 1);
  assertStringIncludes(capture[0]!.url, '/embeddings');
  assertEquals(capture[0]!.body.model, 'openai/text-embedding-3-small');
  assertEquals(typeof capture[0]!.body.input, 'string');
  // Authorization header should be the consumer test key.
  const headers = capture[0]!.init.headers as Record<string, string>;
  assertEquals(headers.Authorization, 'Bearer sb_consumer_test_key');
});

// ─── T2: 429 Retry-After + retry ──────────────────────────────────────────

Deno.test('T2: embed honors 429 Retry-After (1s) and retries successfully', async () => {
  setEnv();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeMockFetch((n) => {
    if (n === 1) {
      return new Response('rate limited', {
        status: 429,
        headers: { 'Retry-After': '1' },
      });
    }
    return makeEmbeddingResponse();
  }, capture);

  const t0 = Date.now();
  const vec = await embed('benign user-context text', { fetchImpl, timeoutMs: 5_000 });
  const elapsed = Date.now() - t0;
  assertEquals(vec.length, 1536);
  assertEquals(capture.length, 2, 'should retry after 429');
  // 1s minimum backoff per Retry-After.
  assert(elapsed >= 900, `expected ≥1s backoff, got ${elapsed}ms`);
});

Deno.test('T2b: embed retries up to 3x on persistent 429 then throws', async () => {
  setEnv();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeMockFetch(
    () =>
      new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } }),
    capture,
  );

  await assertRejects(
    () => embed('benign text', { fetchImpl, timeoutMs: 5_000 }),
    Error,
  );
  assertEquals(capture.length, 3, 'should exhaust 3 retries');
});

// ─── T3: non-2xx throws bounded error ─────────────────────────────────────

Deno.test('T3: embed throws on non-2xx with status + bounded body slice', async () => {
  setEnv();
  const capture: FetchCapture[] = [];
  const longBody = 'x'.repeat(500);
  const fetchImpl = makeMockFetch(() => new Response(longBody, { status: 500 }), capture);

  await assertRejects(
    () => embed('benign text', { fetchImpl, timeoutMs: 5_000 }),
    Error,
    'embed failed: 500',
  );
});

// ─── Pre-embed scrub: dose-change phrasing replaced before fetch ─────────

Deno.test('Pre-embed scrub: dose-change phrasing replaced before fetch (RESEARCH Pitfall #9)', async () => {
  setEnv();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeMockFetch(() => makeEmbeddingResponse(), capture);

  // This text matches isDoseChangeAdvice (stem "increase" + med-noun "Ozempic dose").
  const adversarial = 'You should increase your Ozempic dose to 2mg.';
  await embed(adversarial, { fetchImpl });

  assertEquals(capture.length, 1);
  const sentInput = capture[0]!.body.input as string;
  // Original adversarial phrasing MUST NOT reach the embed endpoint.
  assert(!sentInput.includes('Ozempic'), 'must scrub drug name');
  assert(!sentInput.includes('2mg'), 'must scrub dose value');
  assertStringIncludes(sentInput, 'redacted');
});

Deno.test('Pre-embed scrub: benign user-context text passes through unchanged', async () => {
  setEnv();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeMockFetch(() => makeEmbeddingResponse(), capture);

  const benign =
    'GLP-1 user with weight loss goal, currently in escalation phase. 4 injections in the last 30 days.';
  await embed(benign, { fetchImpl });

  assertEquals(capture[0]!.body.input, benign);
});

Deno.test('skipScrub option bypasses refusal check (cron content-embed path)', async () => {
  setEnv();
  const capture: FetchCapture[] = [];
  const fetchImpl = makeMockFetch(() => makeEmbeddingResponse(), capture);

  // Even dose-change phrasing goes through verbatim when caller opts out.
  const text = 'You should increase your Ozempic dose to 2mg.';
  await embed(text, { fetchImpl, skipScrub: true });

  assertEquals(capture[0]!.body.input, text);
});

// ─── Missing env handling ─────────────────────────────────────────────────

Deno.test('embed throws when AI_GATEWAY_BASE_URL is unset', async () => {
  Deno.env.set('AI_GATEWAY_API_KEY_CONSUMER', 'sb_x');
  Deno.env.delete('AI_GATEWAY_BASE_URL');
  Deno.env.set('OPENAI_EMBED_MODEL', 'm');
  await assertRejects(() => embed('text'), Error, 'AI_GATEWAY_BASE_URL');
  // Restore.
  Deno.env.set('AI_GATEWAY_BASE_URL', 'https://ai-gateway.vercel.sh/v1');
});
