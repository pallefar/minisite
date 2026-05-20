/**
 * Deno tests for `update-anon-session` Edge Function — Phase 34 Plan 34-06.
 *
 * Per [[reference_deno_test_discovery]]: filename MUST be `index.test.ts`.
 */
import { assertEquals, assert } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

const {
  handleUpdateAnonSession,
  setAdminForTest,
  resetAdminForTest,
  sanitizePreferencesPatch,
  computePopulationScore,
} = __internal;

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

// ──────────────────────────────────────────────────────────────────────────
// Fake admin client
// ──────────────────────────────────────────────────────────────────────────

interface FakeOps {
  selects: Array<{ eq: Record<string, unknown>; is: Record<string, unknown> }>;
  updates: Array<{
    patch: Record<string, unknown>;
    eq: Record<string, unknown>;
    is: Record<string, unknown>;
  }>;
}

interface FakeAdminConfig {
  selectResult?: { data: unknown; error: { message: string } | null };
  updateResult?: { error: { message: string } | null };
  log: FakeOps;
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(cfg: FakeAdminConfig): any {
  return {
    from(table: string) {
      assertEquals(table, 'anonymous_sessions');
      const eqState: Record<string, unknown> = {};
      const isState: Record<string, unknown> = {};
      let mode: 'select' | 'update' | null = null;
      let pendingPatch: Record<string, unknown> | null = null;

      const updateChain = {
        eq(col: string, val: unknown) {
          eqState[col] = val;
          return updateChain;
        },
        is(col: string, val: unknown) {
          isState[col] = val;
          cfg.log.updates.push({
            patch: pendingPatch ?? {},
            eq: { ...eqState },
            is: { ...isState },
          });
          return Promise.resolve(cfg.updateResult ?? { error: null });
        },
      };

      const builder = {
        select(_cols: string) {
          mode = 'select';
          return builder;
        },
        update(patch: Record<string, unknown>) {
          mode = 'update';
          pendingPatch = patch;
          return updateChain;
        },
        eq(col: string, val: unknown) {
          eqState[col] = val;
          return builder;
        },
        is(col: string, val: unknown) {
          isState[col] = val;
          return builder;
        },
        maybeSingle() {
          if (mode === 'select') {
            cfg.log.selects.push({ eq: { ...eqState }, is: { ...isState } });
          }
          return Promise.resolve(cfg.selectResult ?? { data: null, error: null });
        },
      };
      return builder;
    },
  };
}

function newLog(): FakeOps {
  return { selects: [], updates: [] };
}

const COOKIE = '11111111-1111-4111-8111-111111111111';

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────────

Deno.test('sanitizePreferencesPatch drops unknown keys', () => {
  const out = sanitizePreferencesPatch({
    locale: 'en-US',
    units: 'metric',
    timezone: 'Europe/Berlin',
    primary_goal: 'lose-weight',
    aff_code: 'TRY_TO_INJECT',
    is_admin: true,
  });
  assertEquals(Object.keys(out).sort(), ['locale', 'primary_goal', 'timezone', 'units'].sort());
  assertEquals('aff_code' in out, false);
  assertEquals('is_admin' in out, false);
});

Deno.test('sanitizePreferencesPatch rejects invalid enum values', () => {
  const out = sanitizePreferencesPatch({ units: 'leagues', primary_goal: 'rule-the-world' });
  assertEquals(Object.keys(out).length, 0);
});

Deno.test('computePopulationScore counts allowlisted prefs + draft entries (max 10)', () => {
  assertEquals(computePopulationScore({}, 0), 0);
  assertEquals(
    computePopulationScore(
      { locale: 'en-US', units: 'imperial', timezone: 'UTC', primary_goal: 'lose-weight' },
      3,
    ),
    7,
  );
  assertEquals(computePopulationScore({ locale: 'x' }, 100), 10);
});

// ──────────────────────────────────────────────────────────────────────────
// Handler integration
// ──────────────────────────────────────────────────────────────────────────

Deno.test('T1: POST with valid cookie + prefs merges + recomputes score', async () => {
  const log = newLog();
  setAdminForTest(
    makeFakeAdmin({
      log,
      selectResult: {
        data: {
          cookie_id: COOKIE,
          preferences: { locale: 'en-US' },
          draft_entries: [],
          aff_code: null,
        },
        error: null,
      },
    }),
  );
  try {
    const req = new Request('http://localhost/functions/v1/update-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cookie_id: COOKIE,
        preferences_patch: { primary_goal: 'lose-weight', units: 'imperial' },
      }),
    });
    const res = await handleUpdateAnonSession(req);
    assertEquals(res.status, 200);
    const body = (await res.json()) as { ok: boolean; population_score: number };
    assertEquals(body.ok, true);
    assertEquals(body.population_score, 3); // locale + units + primary_goal
    assertEquals(log.updates.length, 1);
    const patch = log.updates[0].patch as { preferences: Record<string, unknown> };
    assertEquals(patch.preferences.primary_goal, 'lose-weight');
    assertEquals(patch.preferences.units, 'imperial');
    assertEquals(patch.preferences.locale, 'en-US'); // preserved
  } finally {
    resetAdminForTest();
  }
});

Deno.test('T2: POST with unknown preference keys silently drops them', async () => {
  const log = newLog();
  setAdminForTest(
    makeFakeAdmin({
      log,
      selectResult: {
        data: { cookie_id: COOKIE, preferences: {}, draft_entries: [], aff_code: null },
        error: null,
      },
    }),
  );
  try {
    const req = new Request('http://localhost/functions/v1/update-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cookie_id: COOKIE,
        preferences_patch: { is_admin: true, locale: 'en-US' },
      }),
    });
    const res = await handleUpdateAnonSession(req);
    assertEquals(res.status, 200);
    const patch = log.updates[0].patch as { preferences: Record<string, unknown> };
    assertEquals('is_admin' in patch.preferences, false);
    assertEquals(patch.preferences.locale, 'en-US');
  } finally {
    resetAdminForTest();
  }
});

Deno.test('T3: POST with malformed cookie_id → 400', async () => {
  const req = new Request('http://localhost/functions/v1/update-anon-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookie_id: 'not-a-uuid' }),
  });
  const res = await handleUpdateAnonSession(req);
  assertEquals(res.status, 400);
  const body = (await res.json()) as { error: string };
  assertEquals(body.error, 'invalid_cookie_id');
});

Deno.test('T4: POST with unknown cookie → 404 not_found', async () => {
  const log = newLog();
  setAdminForTest(
    makeFakeAdmin({ log, selectResult: { data: null, error: null } }),
  );
  try {
    const req = new Request('http://localhost/functions/v1/update-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie_id: COOKIE }),
    });
    const res = await handleUpdateAnonSession(req);
    assertEquals(res.status, 404);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'not_found');
  } finally {
    resetAdminForTest();
  }
});

Deno.test('T5: draft_entries_append accumulates and bumps score', async () => {
  const log = newLog();
  setAdminForTest(
    makeFakeAdmin({
      log,
      selectResult: {
        data: {
          cookie_id: COOKIE,
          preferences: {},
          draft_entries: [{ k: 'a' }],
          aff_code: null,
        },
        error: null,
      },
    }),
  );
  try {
    const req = new Request('http://localhost/functions/v1/update-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cookie_id: COOKIE,
        draft_entries_append: [{ k: 'b' }, { k: 'c' }],
      }),
    });
    const res = await handleUpdateAnonSession(req);
    assertEquals(res.status, 200);
    const body = (await res.json()) as { population_score: number };
    assertEquals(body.population_score, 3); // 0 prefs + 3 draft entries
    const patch = log.updates[0].patch as { draft_entries: unknown[] };
    assertEquals(patch.draft_entries.length, 3);
  } finally {
    resetAdminForTest();
  }
});

Deno.test('T6: OPTIONS preflight → 204 + CORS', async () => {
  const req = new Request('http://localhost/functions/v1/update-anon-session', {
    method: 'OPTIONS',
  });
  const res = await handleUpdateAnonSession(req);
  assertEquals(res.status, 204);
  assert(res.headers.get('Access-Control-Allow-Methods')?.includes('POST'));
  await res.body?.cancel();
});

Deno.test('T7: GET → 405 method_not_allowed', async () => {
  const req = new Request('http://localhost/functions/v1/update-anon-session', {
    method: 'GET',
  });
  const res = await handleUpdateAnonSession(req);
  assertEquals(res.status, 405);
});

Deno.test('T8: DB update error → 500', async () => {
  const log = newLog();
  setAdminForTest(
    makeFakeAdmin({
      log,
      selectResult: {
        data: { cookie_id: COOKIE, preferences: {}, draft_entries: [], aff_code: null },
        error: null,
      },
      updateResult: { error: { message: 'db blew up' } },
    }),
  );
  try {
    const req = new Request('http://localhost/functions/v1/update-anon-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie_id: COOKIE, preferences_patch: { units: 'metric' } }),
    });
    const res = await handleUpdateAnonSession(req);
    assertEquals(res.status, 500);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'db_error');
  } finally {
    resetAdminForTest();
  }
});
