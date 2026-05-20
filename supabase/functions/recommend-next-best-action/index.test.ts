/**
 * Phase 38 Plan 38-03 — Deno unit tests for recommend-next-best-action.
 *
 * Tests cover the 10 behaviors from 38-03-PLAN <behavior>:
 *   T1: dashboard happy path → ≤3 recs with all 8 keys per RESEARCH Pattern 5
 *   T2: sparse-history (<5 events / 14d) → fallback='popular'
 *   T3: dense-history (≥5 events / 14d) → fallback='personalized'
 *   T4: kb_footer surface + exclude_content_id → returned recs exclude that id
 *   T5: sources defaults to ['content_embeddings'] when omitted
 *   T6: surface_target multi-fanout — kb_article shown on dashboard ALSO lists kb_footer
 *   T7: PostHog `recommendation.shown` event emitted once per returned rec
 *   T8: RPC throws → graceful popularity fallback (no thrown error)
 *   T9: missing user_id → 400
 *   T10: anon caller (no JWT, no service_role) → 401
 *
 * Mocking strategy:
 *   - Inject a mock supabase client + mock fetch via Deno.env + module re-import.
 *   - We use a __setDepsForTest seam exported from index.ts so tests can swap
 *     the Supabase client + embed function without touching real network/env.
 */

import { assert, assertEquals, assertExists } from 'jsr:@std/assert@^1';
import {
  __resetDepsForTest,
  __setDepsForTest,
  handle,
} from './index.ts';

// ── Test helpers ────────────────────────────────────────────────────────────

interface RecEventRow {
  user_id: string;
  shown_at: string;
  clicked_at?: string | null;
  dismissed_at?: string | null;
  source_id?: string;
}

interface ContentRow {
  id: string;
  kind: string;
  title: string;
}

interface MockState {
  recEvents: RecEventRow[];
  popularContent: ContentRow[];
  matchRows: Array<{
    source_table: string;
    content_id: string;
    source_type: string;
    title: string;
    similarity: number;
    weighted_score: number;
  }>;
  matchShouldThrow?: boolean;
  embedShouldThrow?: boolean;
  capturedEvents: Array<{ event: string; userId: string; properties: Record<string, unknown> }>;
  insertedRecEvents: Array<Record<string, unknown>>;
  shutdownCalled: boolean;
  /** Profile row returned for resolveBaaScope (org_id null → consumer). */
  profileRow?: { primary_org_id: string | null } | null;
  /** Captured RPC call arguments for assertion. */
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

function makeMockSupabase(state: MockState) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromBuilder = (table: string): any => {
    let query: {
      filters: Array<{ col: string; op: string; val: unknown }>;
      isHead: boolean;
      isCount: boolean;
      selectExpr?: string;
      orderCol?: string;
      orderAsc?: boolean;
      limit?: number;
    } = { filters: [], isHead: false, isCount: false };

    const builder: Record<string, unknown> = {};
    builder.select = (expr?: string, opts?: { count?: string; head?: boolean }) => {
      query.selectExpr = expr;
      query.isHead = opts?.head ?? false;
      query.isCount = opts?.count === 'exact';
      return builder;
    };
    builder.eq = (col: string, val: unknown) => {
      query.filters.push({ col, op: 'eq', val });
      return builder;
    };
    builder.gt = (col: string, val: unknown) => {
      query.filters.push({ col, op: 'gt', val });
      return builder;
    };
    builder.is = (col: string, val: unknown) => {
      query.filters.push({ col, op: 'is', val });
      return builder;
    };
    builder.in = (col: string, val: unknown) => {
      query.filters.push({ col, op: 'in', val });
      return builder;
    };
    builder.order = (col: string, opts?: { ascending?: boolean }) => {
      query.orderCol = col;
      query.orderAsc = opts?.ascending ?? true;
      return builder;
    };
    builder.limit = (n: number) => {
      query.limit = n;
      return builder;
    };
    builder.maybeSingle = () => {
      if (table === 'profiles') {
        return Promise.resolve({ data: state.profileRow ?? null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    builder.insert = (rows: unknown) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      state.insertedRecEvents.push(...(arr as Record<string, unknown>[]));
      return { select: () => Promise.resolve({ data: arr, error: null }) };
    };
    // The terminal `then` resolver — fires for count-head queries + non-await
    // chains that end without maybeSingle().
    builder.then = (resolve: (v: unknown) => void) => {
      if (table === 'recommendation_events' && query.isCount && query.isHead) {
        // Count events for user in window.
        const userId = query.filters.find((f) => f.col === 'user_id')?.val as
          | string
          | undefined;
        const since = query.filters.find((f) => f.col === 'shown_at')?.val as
          | string
          | undefined;
        const sinceMs = since ? Date.parse(since) : 0;
        const count = state.recEvents.filter(
          (r) => r.user_id === userId && Date.parse(r.shown_at) > sinceMs,
        ).length;
        resolve({ data: null, count, error: null });
        return;
      }
      if (table === 'recommendation_events' && !query.isCount) {
        // SELECT dismissed ids for window.
        const userId = query.filters.find((f) => f.col === 'user_id')?.val as
          | string
          | undefined;
        const since = query.filters.find((f) => f.col === 'dismissed_at')?.val as
          | string
          | undefined;
        const sinceMs = since ? Date.parse(since) : 0;
        const rows = state.recEvents.filter(
          (r) =>
            r.user_id === userId &&
            r.dismissed_at &&
            Date.parse(r.dismissed_at) > sinceMs,
        );
        resolve({
          data: rows.map((r) => ({ source_id: r.source_id ?? 'unknown' })),
          error: null,
        });
        return;
      }
      if (table === 'content') {
        resolve({ data: state.popularContent, error: null });
        return;
      }
      resolve({ data: [], error: null });
    };
    return builder;
  };

  return {
    from: fromBuilder,
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (state.matchShouldThrow) {
        return Promise.resolve({
          data: null,
          error: { message: 'simulated rpc failure', code: 'XX000' },
        });
      }
      return Promise.resolve({ data: state.matchRows, error: null });
    },
  };
}

function setEnv() {
  Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_test');
  Deno.env.set('SUPABASE_ANON_KEY', 'sb_anon_test');
  Deno.env.set('AI_GATEWAY_API_KEY_CONSUMER', 'sb_consumer_test');
  Deno.env.set('AI_GATEWAY_BASE_URL', 'https://ai-gateway.vercel.sh/v1');
  Deno.env.set('OPENAI_EMBED_MODEL', 'openai/text-embedding-3-small');
}

function makeDefaultState(): MockState {
  return {
    recEvents: [],
    popularContent: [
      { id: 'pop-1', kind: 'kb_article', title: 'Popular KB 1' },
      { id: 'pop-2', kind: 'kb_article', title: 'Popular KB 2' },
      { id: 'pop-3', kind: 'kb_article', title: 'Popular KB 3' },
    ],
    matchRows: [
      {
        source_table: 'content_embeddings',
        content_id: 'kb-a',
        source_type: 'kb_article',
        title: 'KB A',
        similarity: 0.92,
        weighted_score: 0.92,
      },
      {
        source_table: 'content_embeddings',
        content_id: 'kb-b',
        source_type: 'kb_article',
        title: 'KB B',
        similarity: 0.88,
        weighted_score: 0.88,
      },
      {
        source_table: 'content_embeddings',
        content_id: 'kb-c',
        source_type: 'kb_article',
        title: 'KB C',
        similarity: 0.81,
        weighted_score: 0.81,
      },
    ],
    capturedEvents: [],
    insertedRecEvents: [],
    shutdownCalled: false,
    profileRow: { primary_org_id: null },
    rpcCalls: [],
  };
}

function installDeps(state: MockState): void {
  __setDepsForTest({
    makeSupabase: () => makeMockSupabase(state),
    embed: () => {
      if (state.embedShouldThrow) throw new Error('simulated embed failure');
      return Promise.resolve(Array.from({ length: 1536 }, () => 0));
    },
    captureServer: (args: {
      userId: string;
      event: string;
      properties?: Record<string, unknown>;
    }) => {
      state.capturedEvents.push({
        event: args.event,
        userId: args.userId,
        properties: args.properties ?? {},
      });
    },
    shutdownPostHog: () => {
      state.shutdownCalled = true;
      return Promise.resolve();
    },
    nowMs: () => Date.parse('2026-05-20T12:00:00Z'),
  });
}

function makeRequest(body: unknown, opts?: { auth?: string }): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts?.auth) headers.Authorization = opts.auth;
  return new Request('http://localhost/recommend-next-best-action', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function seedDenseHistory(state: MockState, userId: string): void {
  // Seed 10 events in last 14 days.
  const base = Date.parse('2026-05-19T00:00:00Z');
  for (let i = 0; i < 10; i++) {
    state.recEvents.push({
      user_id: userId,
      shown_at: new Date(base - i * 60_000).toISOString(),
    });
  }
}

// ── T1: dashboard happy path ───────────────────────────────────────────────

Deno.test('T1: dashboard surface returns ≤3 recs with all 8 required keys', async () => {
  setEnv();
  const state = makeDefaultState();
  seedDenseHistory(state, 'user-1');
  installDeps(state);

  const res = await handle(
    makeRequest({ user_id: 'user-1', surface: 'dashboard' }, { auth: 'Bearer user-jwt' }),
  );
  __resetDepsForTest();

  assertEquals(res.status, 200);
  const body = (await res.json()) as {
    recommendations: Array<Record<string, unknown>>;
    fallback: string;
  };
  assert(body.recommendations.length <= 3);
  assert(body.recommendations.length > 0);
  for (const rec of body.recommendations) {
    assertExists(rec.recommendation_id, 'recommendation_id');
    assertExists(rec.source_type, 'source_type');
    assertExists(rec.source_id, 'source_id');
    assertExists(rec.title, 'title');
    assertExists(rec.deeplink, 'deeplink');
    assertEquals(typeof rec.score, 'number');
    assert(Array.isArray(rec.surface_target));
    assertExists(rec.expires_at, 'expires_at');
  }
});

// ── T2: sparse history → popular fallback ──────────────────────────────────

Deno.test('T2: sparse-history user (<5 events/14d) → fallback=popular', async () => {
  setEnv();
  const state = makeDefaultState();
  // Only 2 events — well below the 5-event threshold.
  state.recEvents.push(
    { user_id: 'sparse', shown_at: new Date(Date.parse('2026-05-19T00:00:00Z')).toISOString() },
    { user_id: 'sparse', shown_at: new Date(Date.parse('2026-05-18T00:00:00Z')).toISOString() },
  );
  installDeps(state);

  const res = await handle(
    makeRequest({ user_id: 'sparse', surface: 'dashboard' }, { auth: 'Bearer user-jwt' }),
  );
  __resetDepsForTest();
  const body = (await res.json()) as { recommendations: unknown[]; fallback: string };
  assertEquals(body.fallback, 'popular');
  assertEquals(body.recommendations.length, 3);
});

// ── T3: dense history → personalized ───────────────────────────────────────

Deno.test('T3: dense-history user (≥5 events/14d) → fallback=personalized', async () => {
  setEnv();
  const state = makeDefaultState();
  seedDenseHistory(state, 'dense');
  installDeps(state);

  const res = await handle(
    makeRequest({ user_id: 'dense', surface: 'dashboard' }, { auth: 'Bearer user-jwt' }),
  );
  __resetDepsForTest();
  const body = (await res.json()) as { fallback: string };
  assertEquals(body.fallback, 'personalized');
});

// ── T4: kb_footer + exclude_content_id ─────────────────────────────────────

Deno.test('T4: kb_footer surface excludes the currently-viewed article id', async () => {
  setEnv();
  const state = makeDefaultState();
  seedDenseHistory(state, 'reader-1');
  installDeps(state);

  const res = await handle(
    makeRequest(
      { user_id: 'reader-1', surface: 'kb_footer', exclude_content_id: 'kb-a' },
      { auth: 'Bearer user-jwt' },
    ),
  );
  __resetDepsForTest();
  const body = (await res.json()) as { recommendations: Array<{ source_id: string }> };
  for (const r of body.recommendations) {
    assert(r.source_id !== 'kb-a', `should exclude kb-a, got ${r.source_id}`);
  }
});

// ── T5: sources defaults to ['content_embeddings'] ─────────────────────────

Deno.test('T5: sources defaults to [content_embeddings] when omitted', async () => {
  setEnv();
  const state = makeDefaultState();
  seedDenseHistory(state, 'user-5');
  installDeps(state);

  await handle(
    makeRequest({ user_id: 'user-5', surface: 'dashboard' }, { auth: 'Bearer user-jwt' }),
  );
  __resetDepsForTest();

  // Find the match_content_embeddings rpc call.
  const match = state.rpcCalls.find((c) => c.name === 'match_content_embeddings');
  assertExists(match, 'match_content_embeddings should have been called');
  const sources = match!.args.sources as string[];
  assertEquals(sources, ['content_embeddings']);
});

// ── T6: surface_target multi-fanout (kb_article shown on dashboard ALSO surfaces kb_footer)

Deno.test('T6: surface_target fanout — kb_article on dashboard ALSO targets kb_footer', async () => {
  setEnv();
  const state = makeDefaultState();
  seedDenseHistory(state, 'user-6');
  installDeps(state);

  const res = await handle(
    makeRequest({ user_id: 'user-6', surface: 'dashboard' }, { auth: 'Bearer user-jwt' }),
  );
  __resetDepsForTest();
  const body = (await res.json()) as {
    recommendations: Array<{ source_type: string; surface_target: string[] }>;
  };
  const kbRec = body.recommendations.find((r) => r.source_type === 'kb_article');
  assertExists(kbRec, 'should have at least one kb_article rec');
  assert(kbRec!.surface_target.includes('dashboard'), 'should include requested dashboard');
  assert(
    kbRec!.surface_target.includes('kb_footer'),
    'kb_article should fan out to kb_footer per D-01',
  );
});

// ── T7: PostHog recommendation.shown event per rec ─────────────────────────

Deno.test('T7: emits one recommendation.shown event per returned rec', async () => {
  setEnv();
  const state = makeDefaultState();
  seedDenseHistory(state, 'user-7');
  installDeps(state);

  const res = await handle(
    makeRequest({ user_id: 'user-7', surface: 'dashboard' }, { auth: 'Bearer user-jwt' }),
  );
  __resetDepsForTest();
  const body = (await res.json()) as { recommendations: unknown[] };
  const shown = state.capturedEvents.filter((e) => e.event === 'recommendation.shown');
  assertEquals(shown.length, body.recommendations.length);
  // Required properties.
  for (const ev of shown) {
    assertExists(ev.properties.recommendation_id, 'recommendation_id');
    assertExists(ev.properties.surface_target, 'surface_target');
    assertEquals(typeof ev.properties.score, 'number');
  }
  // PostHog shutdown must have been called before response (graceful drain).
  assertEquals(state.shutdownCalled, true);
});

// ── T8: RPC failure → graceful popularity fallback ─────────────────────────

Deno.test('T8: rpc error → graceful popularity fallback (no thrown error)', async () => {
  setEnv();
  const state = makeDefaultState();
  seedDenseHistory(state, 'user-8');
  state.matchShouldThrow = true;
  installDeps(state);

  const res = await handle(
    makeRequest({ user_id: 'user-8', surface: 'dashboard' }, { auth: 'Bearer user-jwt' }),
  );
  __resetDepsForTest();
  assertEquals(res.status, 200);
  const body = (await res.json()) as { fallback: string; recommendations: unknown[] };
  assertEquals(body.fallback, 'popular');
  assert(body.recommendations.length > 0);
});

// ── T9: missing user_id → 400 ──────────────────────────────────────────────

Deno.test('T9: missing user_id → 400 with error message', async () => {
  setEnv();
  const state = makeDefaultState();
  installDeps(state);

  const res = await handle(
    makeRequest({ surface: 'dashboard' }, { auth: 'Bearer user-jwt' }),
  );
  __resetDepsForTest();
  assertEquals(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert(body.error.includes('user_id'));
});

// ── T10: anon caller → 401 ─────────────────────────────────────────────────

Deno.test('T10: anon caller (no Authorization header) → 401', async () => {
  setEnv();
  const state = makeDefaultState();
  installDeps(state);

  const res = await handle(makeRequest({ user_id: 'x', surface: 'dashboard' }));
  __resetDepsForTest();
  assertEquals(res.status, 401);
});
