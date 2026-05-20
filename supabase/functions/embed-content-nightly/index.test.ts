/**
 * Deno tests for `embed-content-nightly` Edge Function — Phase 38 Plan 38-04.
 *
 * Covers 8 behaviors per PLAN.md:
 *   T1. Pending content (no row) → embed + insert with body_sha256.
 *   T2. Stale row + sha matches → mark stale=false WITHOUT re-embedding (dedup).
 *   T3. Stale row + sha differs → re-embed + update embedding + sha + last_embedded_at.
 *   T4. Batches up to 100 inputs/call (input: string[]).
 *   T5. 429 + Retry-After honored; 3 retries; on persistent 429 emits embed.rate_limit_429 + skips row.
 *   T6. Calls SELECT public.cleanup_content_embeddings_soft_deleted() at end.
 *   T7. Emits embed.batch_complete telemetry with rows_embedded / rows_dedup_skipped / errors_count.
 *   T8. Caller auth: user JWT (or no bearer) → 403; service_role bearer → proceeds.
 *
 * File naming follows `reference_deno_test_discovery.md`: <name>.test.ts.
 */

import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

const { handleRun, setAdminForTest, resetAdminForTest } = __internal;

// ─── Env setup ────────────────────────────────────────────────────────────

const ORIGINAL_ENV: Record<string, string | undefined> = {
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  AI_GATEWAY_API_KEY_CONSUMER: Deno.env.get('AI_GATEWAY_API_KEY_CONSUMER'),
  AI_GATEWAY_BASE_URL: Deno.env.get('AI_GATEWAY_BASE_URL'),
  OPENAI_EMBED_MODEL: Deno.env.get('OPENAI_EMBED_MODEL'),
};

function setEnv() {
  Deno.env.set('SUPABASE_URL', 'https://stub.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'sb_service_test_key');
  Deno.env.set('AI_GATEWAY_API_KEY_CONSUMER', 'sb_consumer_test_key');
  Deno.env.set('AI_GATEWAY_BASE_URL', 'https://ai-gateway.test/v1');
  Deno.env.set('OPENAI_EMBED_MODEL', 'openai/text-embedding-3-small');
}

function restoreEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

interface ContentFixture {
  id: string;
  title: string;
  body_md: string;
  stored_sha: string | null;
  stale: boolean | null;
}

interface UpsertCall {
  content_id: string;
  embedding?: number[];
  body_sha256?: string;
  stale?: boolean;
  embedding_model_id?: string;
}

interface UpdateStaleCall {
  content_id: string;
  patch: Record<string, unknown>;
}

interface RpcCall {
  fn: string;
  args: unknown;
}

interface MockAdminState {
  fixtures: ContentFixture[];
  upserts: UpsertCall[];
  staleUpdates: UpdateStaleCall[];
  rpcs: RpcCall[];
}

function makeMockAdmin(fixtures: ContentFixture[]): {
  client: unknown;
  state: MockAdminState;
} {
  const state: MockAdminState = {
    fixtures,
    upserts: [],
    staleUpdates: [],
    rpcs: [],
  };

  // The Fn calls admin.rpc('select_pending_or_stale_content', ...) OR a raw select
  // chain. We model the simplest direct-RPC path used in the implementation.
  const client = {
    rpc: (fn: string, args: unknown = {}) => {
      state.rpcs.push({ fn, args });
      if (fn === 'select_pending_or_stale_content_for_embed') {
        // Return the fixture array as the candidate set.
        return Promise.resolve({
          data: state.fixtures.map((f) => ({
            content_id: f.id,
            title: f.title,
            body_md: f.body_md,
            stored_sha: f.stored_sha,
            stale: f.stale,
          })),
          error: null,
        });
      }
      if (fn === 'cleanup_content_embeddings_soft_deleted') {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      if (table === 'content_embeddings') {
        return {
          upsert: (row: UpsertCall | UpsertCall[]) => {
            const rows = Array.isArray(row) ? row : [row];
            for (const r of rows) state.upserts.push(r);
            return {
              select: () => Promise.resolve({ data: rows, error: null }),
              // Some callers don't chain .select() — make the upsert itself awaitable.
              then: (resolve: (v: { data: UpsertCall[]; error: null }) => void) =>
                resolve({ data: rows, error: null }),
            };
          },
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, val: string) => {
              state.staleUpdates.push({ content_id: val, patch });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      return {};
    },
  };

  return { client, state };
}

function fakeEmbedding(seed: number): number[] {
  return Array.from({ length: 1536 }, (_, i) => Math.sin(i + seed) * 0.01);
}

function makeEmbeddingsResponse(count: number): Response {
  const data = Array.from({ length: count }, (_, i) => ({ embedding: fakeEmbedding(i) }));
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface FetchCapture {
  url: string;
  body: { model?: string; input?: string | string[] };
}

function makeMockFetch(
  responder: (call: number, body: FetchCapture['body']) => Response | Promise<Response>,
  capture: FetchCapture[],
): typeof fetch {
  let n = 0;
  return (input: RequestInfo | URL, init?: RequestInit) => {
    n++;
    const url = String(input);
    const bodyStr = (init?.body ?? '{}') as string;
    const parsed = JSON.parse(bodyStr) as FetchCapture['body'];
    capture.push({ url, body: parsed });
    return Promise.resolve(responder(n, parsed));
  };
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function makeRequest(opts: { bearer?: string; method?: string } = {}): Request {
  const headers = new Headers();
  if (opts.bearer !== undefined) headers.set('Authorization', `Bearer ${opts.bearer}`);
  return new Request('http://localhost/embed-content-nightly', {
    method: opts.method ?? 'POST',
    headers,
  });
}

// ─── T8: Auth ────────────────────────────────────────────────────────────

Deno.test('T8a: missing bearer → 403', async () => {
  setEnv();
  try {
    const res = await handleRun(makeRequest({}));
    assertEquals(res.status, 403);
  } finally {
    restoreEnv();
  }
});

Deno.test('T8b: user JWT (wrong bearer) → 403', async () => {
  setEnv();
  try {
    const res = await handleRun(makeRequest({ bearer: 'eyJ.userjwt.xxx' }));
    assertEquals(res.status, 403);
  } finally {
    restoreEnv();
  }
});

Deno.test('T8c: service_role bearer → 200 (proceeds)', async () => {
  setEnv();
  const { client } = makeMockAdmin([]);
  setAdminForTest(client);
  try {
    const capture: FetchCapture[] = [];
    const fetchImpl = makeMockFetch(() => makeEmbeddingsResponse(0), capture);
    const res = await handleRun(
      makeRequest({ bearer: 'sb_service_test_key' }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
  } finally {
    resetAdminForTest();
    restoreEnv();
  }
});

// ─── T1: Pending content → embed + insert ───────────────────────────────

Deno.test('T1: pending content (no embedding row) embeds + upserts with body_sha256', async () => {
  setEnv();
  const title = 'GLP-1 dosing schedule';
  const body = 'Inject weekly at the same time.';
  const expectedSha = await sha256Hex(`${title}\n\n${body}`);
  const { client, state } = makeMockAdmin([
    { id: 'c-1', title, body_md: body, stored_sha: null, stale: null },
  ]);
  setAdminForTest(client);
  try {
    const capture: FetchCapture[] = [];
    const fetchImpl = makeMockFetch(() => makeEmbeddingsResponse(1), capture);
    const res = await handleRun(
      makeRequest({ bearer: 'sb_service_test_key' }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    // One embed call with input as an ARRAY.
    assertEquals(capture.length, 1);
    assert(Array.isArray(capture[0]!.body.input), 'input must be an array');
    assertEquals((capture[0]!.body.input as string[]).length, 1);
    // Upsert with body_sha256.
    assertEquals(state.upserts.length, 1);
    assertEquals(state.upserts[0]!.content_id, 'c-1');
    assertEquals(state.upserts[0]!.body_sha256, expectedSha);
    assertEquals(state.upserts[0]!.stale, false);
    assertEquals(state.upserts[0]!.embedding_model_id, 'openai/text-embedding-3-small');
  } finally {
    resetAdminForTest();
    restoreEnv();
  }
});

// ─── T2: Stale + sha matches → dedup skip ───────────────────────────────

Deno.test('T2: stale row whose body_sha256 matches → marks stale=false WITHOUT re-embedding', async () => {
  setEnv();
  const title = 'Unchanged article';
  const body = 'Body content.';
  const sha = await sha256Hex(`${title}\n\n${body}`);
  const { client, state } = makeMockAdmin([
    { id: 'c-dedup', title, body_md: body, stored_sha: sha, stale: true },
  ]);
  setAdminForTest(client);
  try {
    const capture: FetchCapture[] = [];
    const fetchImpl = makeMockFetch(() => makeEmbeddingsResponse(0), capture);
    const res = await handleRun(
      makeRequest({ bearer: 'sb_service_test_key' }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    // No embed call.
    assertEquals(capture.length, 0, 'dedup must skip embed call');
    // No upsert (embedding unchanged).
    assertEquals(state.upserts.length, 0);
    // stale=false written via UPDATE.
    assertEquals(state.staleUpdates.length, 1);
    assertEquals(state.staleUpdates[0]!.content_id, 'c-dedup');
    assertEquals(state.staleUpdates[0]!.patch.stale, false);
    // Response body should reflect dedup_skipped count.
    const j = await res.json() as { rows_dedup_skipped?: number };
    assertEquals(j.rows_dedup_skipped, 1);
  } finally {
    resetAdminForTest();
    restoreEnv();
  }
});

// ─── T3: Stale + sha differs → re-embed ─────────────────────────────────

Deno.test('T3: stale row whose body_sha256 differs → re-embeds + upserts new sha', async () => {
  setEnv();
  const title = 'Edited article';
  const body = 'New body content after an edit.';
  const newSha = await sha256Hex(`${title}\n\n${body}`);
  const oldSha = 'a'.repeat(64);
  const { client, state } = makeMockAdmin([
    { id: 'c-edit', title, body_md: body, stored_sha: oldSha, stale: true },
  ]);
  setAdminForTest(client);
  try {
    const capture: FetchCapture[] = [];
    const fetchImpl = makeMockFetch(() => makeEmbeddingsResponse(1), capture);
    const res = await handleRun(
      makeRequest({ bearer: 'sb_service_test_key' }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    assertEquals(capture.length, 1);
    assertEquals(state.upserts.length, 1);
    assertEquals(state.upserts[0]!.body_sha256, newSha);
    assertEquals(state.upserts[0]!.stale, false);
    // Embedding must be set on the upsert (re-embedded).
    assert(Array.isArray(state.upserts[0]!.embedding));
    assertEquals(state.upserts[0]!.embedding!.length, 1536);
  } finally {
    resetAdminForTest();
    restoreEnv();
  }
});

// ─── T4: Batches up to 100 inputs/call ──────────────────────────────────

Deno.test('T4: batches input arrays up to 100 per call', async () => {
  setEnv();
  // 150 pending rows → expect 2 fetch calls (100 + 50).
  const fixtures: ContentFixture[] = Array.from({ length: 150 }, (_, i) => ({
    id: `c-${i}`,
    title: `T${i}`,
    body_md: `B${i}`,
    stored_sha: null,
    stale: null,
  }));
  const { client, state } = makeMockAdmin(fixtures);
  setAdminForTest(client);
  try {
    const capture: FetchCapture[] = [];
    const fetchImpl = makeMockFetch((_n, body) => {
      const inputs = body.input as string[];
      return makeEmbeddingsResponse(inputs.length);
    }, capture);
    const res = await handleRun(
      makeRequest({ bearer: 'sb_service_test_key' }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    assertEquals(capture.length, 2, '150 rows should batch into 100 + 50');
    assertEquals((capture[0]!.body.input as string[]).length, 100);
    assertEquals((capture[1]!.body.input as string[]).length, 50);
    assertEquals(state.upserts.length, 150);
  } finally {
    resetAdminForTest();
    restoreEnv();
  }
});

// ─── T5: 429 Retry-After + persistent 429 → skip row ────────────────────

Deno.test('T5a: 429 with Retry-After → retries successfully', async () => {
  setEnv();
  const { client } = makeMockAdmin([
    { id: 'c-429', title: 'T', body_md: 'B', stored_sha: null, stale: null },
  ]);
  setAdminForTest(client);
  try {
    const capture: FetchCapture[] = [];
    const fetchImpl = makeMockFetch((n) => {
      if (n === 1) {
        return new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } });
      }
      return makeEmbeddingsResponse(1);
    }, capture);
    const t0 = Date.now();
    const res = await handleRun(
      makeRequest({ bearer: 'sb_service_test_key' }),
      { fetchImpl },
    );
    const elapsed = Date.now() - t0;
    assertEquals(res.status, 200);
    assertEquals(capture.length, 2, 'should retry after 429');
    assert(elapsed >= 900, `expected ≥1s backoff, got ${elapsed}ms`);
  } finally {
    resetAdminForTest();
    restoreEnv();
  }
});

Deno.test('T5b: persistent 429 after 3 retries → skips batch + does NOT crash', async () => {
  setEnv();
  const { client, state } = makeMockAdmin([
    { id: 'c-perma', title: 'T', body_md: 'B', stored_sha: null, stale: null },
  ]);
  setAdminForTest(client);
  try {
    const capture: FetchCapture[] = [];
    const fetchImpl = makeMockFetch(
      () => new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } }),
      capture,
    );
    const res = await handleRun(
      makeRequest({ bearer: 'sb_service_test_key' }),
      { fetchImpl },
    );
    assertEquals(res.status, 200, 'must NOT crash');
    assertEquals(capture.length, 3, 'should exhaust 3 retries');
    // No upsert because all retries failed.
    assertEquals(state.upserts.length, 0);
    const j = await res.json() as { errors_count?: number };
    assertEquals(j.errors_count, 1);
  } finally {
    resetAdminForTest();
    restoreEnv();
  }
});

// ─── T6: cleanup_content_embeddings_soft_deleted invoked at end ─────────

Deno.test('T6: invokes cleanup_content_embeddings_soft_deleted RPC at end of run', async () => {
  setEnv();
  const { client, state } = makeMockAdmin([]);
  setAdminForTest(client);
  try {
    const capture: FetchCapture[] = [];
    const fetchImpl = makeMockFetch(() => makeEmbeddingsResponse(0), capture);
    const res = await handleRun(
      makeRequest({ bearer: 'sb_service_test_key' }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    const cleanupCall = state.rpcs.find((c) => c.fn === 'cleanup_content_embeddings_soft_deleted');
    assert(cleanupCall, 'cleanup RPC must be invoked');
  } finally {
    resetAdminForTest();
    restoreEnv();
  }
});

// ─── T7: telemetry — embed.batch_complete with stats ───────────────────

Deno.test('T7: response stats include rows_embedded / rows_dedup_skipped / errors_count', async () => {
  setEnv();
  const matchingSha = await sha256Hex(`Stale\n\nBody`);
  const { client } = makeMockAdmin([
    { id: 'c-new', title: 'New', body_md: 'Body', stored_sha: null, stale: null },
    { id: 'c-dedup', title: 'Stale', body_md: 'Body', stored_sha: matchingSha, stale: true },
  ]);
  setAdminForTest(client);
  try {
    const capture: FetchCapture[] = [];
    const fetchImpl = makeMockFetch(() => makeEmbeddingsResponse(1), capture);
    const res = await handleRun(
      makeRequest({ bearer: 'sb_service_test_key' }),
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    const j = await res.json() as {
      rows_embedded?: number;
      rows_dedup_skipped?: number;
      errors_count?: number;
    };
    assertEquals(j.rows_embedded, 1, '1 new row embedded');
    assertEquals(j.rows_dedup_skipped, 1, '1 dedup skip');
    assertEquals(j.errors_count, 0);
  } finally {
    resetAdminForTest();
    restoreEnv();
  }
});

// ─── Method gate ────────────────────────────────────────────────────────

Deno.test('non-POST method → 405', async () => {
  setEnv();
  try {
    const res = await handleRun(makeRequest({ bearer: 'sb_service_test_key', method: 'GET' }));
    assertEquals(res.status, 405);
  } finally {
    restoreEnv();
  }
});

// ─── Embed-pattern key_link: body must contain "input: [" (array form) ──

Deno.test('key_link: embed body uses input as array (pattern embed.*input.*\\[)', async () => {
  setEnv();
  const { client } = makeMockAdmin([
    { id: 'c-arr', title: 'T', body_md: 'B', stored_sha: null, stale: null },
  ]);
  setAdminForTest(client);
  try {
    const capture: FetchCapture[] = [];
    const fetchImpl = makeMockFetch(() => makeEmbeddingsResponse(1), capture);
    await handleRun(
      makeRequest({ bearer: 'sb_service_test_key' }),
      { fetchImpl },
    );
    assertStringIncludes(capture[0]!.url, '/embeddings');
    assert(Array.isArray(capture[0]!.body.input));
  } finally {
    resetAdminForTest();
    restoreEnv();
  }
});
