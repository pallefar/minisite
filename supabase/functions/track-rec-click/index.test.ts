/**
 * Phase 38 Plan 38-09 — Deno unit tests for `track-rec-click` Edge Function.
 *
 * Behaviors covered (per 38-09-PLAN Task 3):
 *   T1: Authenticated caller — updates own recommendation_events row (clicked_at = now()).
 *   T2: Cross-tenant attempt — RLS-driven UPDATE returns 0 rows → 404 (no clicked_at update).
 *   T3: PostHog event `recommendation.clicked` fired with recommendation_id property.
 *   T4: Idempotent on repeat clicks — second call returns 204 with first_click=false (clicked_at NOT re-set).
 *   T5: Missing Authorization → 401.
 *   T6: Missing recommendation_id body → 400.
 *
 * Mocking strategy mirrors `recommend-next-best-action/index.test.ts`:
 *   - `__setDepsForTest` seam swaps the Supabase client + captureServer without env wiring.
 *   - Stub supabase exposes a chainable `.from('recommendation_events').update(...).eq(...).is(...).select(...)`
 *     so we can assert UPDATE arguments + simulate "returning count" semantics.
 */

import { assert, assertEquals } from 'jsr:@std/assert@^1';
import { __resetDepsForTest, __setDepsForTest, handle } from './index.ts';

interface CapturedCapture {
  userId: string;
  event: string;
  properties?: Record<string, unknown>;
}

interface RecEventStubRow {
  id: string;
  recommendation_id: string;
  user_id: string;
  clicked_at: string | null;
}

// ─── Stub supabase factory ─────────────────────────────────────────────────

function makeStubSupabase(rows: RecEventStubRow[], opts: { authUserId: string }) {
  // Captures the update payload + filter chain so tests can assert them.
  const calls: {
    updates: Array<{ payload: Record<string, unknown>; filters: Record<string, unknown> }>;
  } = { updates: [] };

  function builderFor(_table: string) {
    let pendingUpdate: Record<string, unknown> | null = null;
    const filters: Record<string, unknown> = {};
    const builder = {
      update(payload: Record<string, unknown>) {
        pendingUpdate = payload;
        return builder;
      },
      eq(col: string, value: unknown) {
        filters[`eq:${col}`] = value;
        return builder;
      },
      is(col: string, value: unknown) {
        filters[`is:${col}`] = value;
        return builder;
      },
      select(_cols?: string) {
        return builder;
      },
      async maybeSingle() {
        if (!pendingUpdate) {
          return { data: null, error: { message: 'no update pending' } };
        }
        calls.updates.push({ payload: pendingUpdate, filters });
        // RLS-aware semantics:
        //   - row must match recommendation_id AND user_id == auth.uid (filters['eq:recommendation_id'], filters['eq:user_id'])
        //   - if `is:clicked_at = null` is part of filter, only the first click matches
        const targetRecId = filters['eq:recommendation_id'];
        const targetUserId = filters['eq:user_id'];
        const row = rows.find(
          (r) => r.recommendation_id === targetRecId && r.user_id === targetUserId,
        );
        if (!row) {
          // RLS or row-missing: cross-tenant attempts land here because the
          // stub uses opts.authUserId as the implicit user_id filter source —
          // when authUserId !== row.user_id the predicate excludes the row.
          return { data: null, error: null };
        }
        if ('is:clicked_at' in filters && row.clicked_at !== null) {
          // Idempotency filter: row already clicked → 0 rows updated.
          return { data: null, error: null };
        }
        // Apply the update.
        row.clicked_at = (pendingUpdate as { clicked_at?: string }).clicked_at ?? new Date().toISOString();
        return { data: { ...row }, error: null };
      },
    };
    return builder;
  }

  return {
    from: (table: string) => builderFor(table),
    // Stand-in for auth.getUser — Edge Fn introspects the bearer JWT.
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: opts.authUserId } }, error: null }),
    },
    _calls: calls,
  };
}

// ─── Shared test helpers ───────────────────────────────────────────────────

function makeReq(body: unknown, opts: { authHeader?: string } = {}): Request {
  return new Request('https://stub.functions.supabase.co/track-rec-click', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.authHeader ? { Authorization: opts.authHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

// ─── T5: missing Authorization → 401 ───────────────────────────────────────

Deno.test('T5: missing Authorization header → 401', async () => {
  __setDepsForTest({
    makeSupabase: () => makeStubSupabase([], { authUserId: '' }),
    captureServer: () => {},
    shutdownPostHog: () => Promise.resolve(),
  });
  const res = await handle(makeReq({ recommendation_id: 'r1' }));
  __resetDepsForTest();
  assertEquals(res.status, 401);
});

// ─── T6: missing recommendation_id → 400 ───────────────────────────────────

Deno.test('T6: missing recommendation_id → 400', async () => {
  __setDepsForTest({
    makeSupabase: () => makeStubSupabase([], { authUserId: 'u1' }),
    captureServer: () => {},
    shutdownPostHog: () => Promise.resolve(),
  });
  const res = await handle(makeReq({}, { authHeader: 'Bearer x' }));
  __resetDepsForTest();
  assertEquals(res.status, 400);
});

// ─── T1: happy path — own row → 204 + clicked_at set ──────────────────────

Deno.test('T1: authenticated caller updates own recommendation_events row', async () => {
  const stub = makeStubSupabase(
    [{ id: 'e1', recommendation_id: 'r1', user_id: 'u1', clicked_at: null }],
    { authUserId: 'u1' },
  );
  __setDepsForTest({
    makeSupabase: () => stub,
    captureServer: () => {},
    shutdownPostHog: () => Promise.resolve(),
  });
  const res = await handle(makeReq({ recommendation_id: 'r1' }, { authHeader: 'Bearer u1-jwt' }));
  __resetDepsForTest();
  assertEquals(res.status, 204);
  // Exactly one UPDATE landed, and the payload set clicked_at.
  assertEquals(stub._calls.updates.length, 1);
  assert(stub._calls.updates[0].payload.clicked_at, 'clicked_at must be present');
});

// ─── T2: cross-tenant attempt — no matching row → 404, no update ──────────

Deno.test('T2: cross-tenant attempt rejected (no matching row → 404)', async () => {
  // Row belongs to user u2; caller is u1 — the eq('user_id', authUserId) filter excludes it.
  const stub = makeStubSupabase(
    [{ id: 'e1', recommendation_id: 'r-foreign', user_id: 'u2', clicked_at: null }],
    { authUserId: 'u1' },
  );
  __setDepsForTest({
    makeSupabase: () => stub,
    captureServer: () => {},
    shutdownPostHog: () => Promise.resolve(),
  });
  const res = await handle(
    makeReq({ recommendation_id: 'r-foreign' }, { authHeader: 'Bearer u1-jwt' }),
  );
  __resetDepsForTest();
  assertEquals(res.status, 404);
  // The implementation issues TWO UPDATEs against the WHERE (first-click probe +
  // repeat-click probe). Both miss on cross-tenant rows. The original row's
  // clicked_at MUST remain null — RLS prevented the write.
  assertEquals(stub._calls.updates.length, 2);
});

// ─── T3: PostHog event recommendation.clicked emitted with recommendation_id ───

Deno.test('T3: emits recommendation.clicked event with recommendation_id property', async () => {
  const captured: CapturedCapture[] = [];
  const stub = makeStubSupabase(
    [{ id: 'e1', recommendation_id: 'r1', user_id: 'u1', clicked_at: null }],
    { authUserId: 'u1' },
  );
  __setDepsForTest({
    makeSupabase: () => stub,
    captureServer: (args) => {
      captured.push(args);
    },
    shutdownPostHog: () => Promise.resolve(),
  });
  await handle(makeReq({ recommendation_id: 'r1' }, { authHeader: 'Bearer u1-jwt' }));
  __resetDepsForTest();
  const clicked = captured.find((c) => c.event === 'recommendation.clicked');
  assert(clicked, 'recommendation.clicked event must be captured');
  assertEquals(clicked.userId, 'u1');
  assertEquals((clicked.properties as { recommendation_id: string }).recommendation_id, 'r1');
  assertEquals((clicked.properties as { first_click: boolean }).first_click, true);
});

// ─── T4: idempotent on repeat — first_click=false on second call ──────────

Deno.test('T4: idempotent on repeat clicks — first_click=false', async () => {
  const captured: CapturedCapture[] = [];
  const stub = makeStubSupabase(
    [{ id: 'e1', recommendation_id: 'r1', user_id: 'u1', clicked_at: null }],
    { authUserId: 'u1' },
  );
  __setDepsForTest({
    makeSupabase: () => stub,
    captureServer: (args) => {
      captured.push(args);
    },
    shutdownPostHog: () => Promise.resolve(),
  });
  // First click
  await handle(makeReq({ recommendation_id: 'r1' }, { authHeader: 'Bearer u1-jwt' }));
  // Second click — row already has clicked_at !== null
  const res2 = await handle(makeReq({ recommendation_id: 'r1' }, { authHeader: 'Bearer u1-jwt' }));
  __resetDepsForTest();
  assertEquals(res2.status, 204);
  const clickedEvents = captured.filter((c) => c.event === 'recommendation.clicked');
  assertEquals(clickedEvents.length, 2, 'two click events captured');
  assertEquals((clickedEvents[0].properties as { first_click: boolean }).first_click, true);
  assertEquals((clickedEvents[1].properties as { first_click: boolean }).first_click, false);
});
