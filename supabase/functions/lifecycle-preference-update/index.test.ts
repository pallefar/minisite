/**
 * Deno tests for `lifecycle-preference-update` Edge Function — Phase 22 plan 22-02 (ON-03).
 *
 * Test plan:
 *   T1 missing JWT → 401 unauthenticated
 *   T2 no categories in body → 400 no_categories
 *   T3 happy path UPSERTs consent_records with merged preferences
 */
import { assert, assertEquals } from 'jsr:@std/assert@^1';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('SITE_URL', 'https://app.leanshot.app');

const { __internal } = await import('./index.ts');

interface InsertedRow {
  user_id: string;
  email_preferences: Record<string, unknown>;
}

function fakeAdmin(state: { inserts: InsertedRow[]; existingPrefs?: Record<string, unknown> }): unknown {
  return {
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { id: 'u_test', email: 'test@example.com' } },
          error: null,
        }),
    },
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () =>
              Promise.resolve({
                data: state.existingPrefs
                  ? [{ id: 'cr_prev', email_preferences: state.existingPrefs }]
                  : [],
                error: null,
              }),
          }),
        }),
      }),
      insert: (row: InsertedRow) => {
        state.inserts.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
}

Deno.test('T1 — missing JWT → 401', async () => {
  __internal.setAdminForTest(fakeAdmin({ inserts: [] }));
  try {
    const req = new Request('http://localhost/lifecycle-preference-update', {
      method: 'POST',
      body: JSON.stringify({ categories: { welcome: false } }),
    });
    const res = await __internal.handleUpdate(req);
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, 'unauthenticated');
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('T2 — no categories → 400', async () => {
  __internal.setAdminForTest(fakeAdmin({ inserts: [] }));
  try {
    const req = new Request('http://localhost/lifecycle-preference-update', {
      method: 'POST',
      headers: { Authorization: 'Bearer fake.user.jwt', 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: {} }),
    });
    const res = await __internal.handleUpdate(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, 'no_categories');
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('T3 — happy path merges + inserts consent_records', async () => {
  const state = {
    inserts: [] as InsertedRow[],
    existingPrefs: { welcome: true, retention: true } as Record<string, unknown>,
  };
  __internal.setAdminForTest(fakeAdmin(state));
  try {
    const req = new Request('http://localhost/lifecycle-preference-update', {
      method: 'POST',
      headers: { Authorization: 'Bearer fake.user.jwt', 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: { welcome: false, weekly_digest: true } }),
    });
    const res = await __internal.handleUpdate(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.preferences.welcome, false);
    assertEquals(body.preferences.weekly_digest, true);
    // merged from existingPrefs
    assertEquals(body.preferences.retention, true);
    assertEquals(state.inserts.length, 1);
    assertEquals(state.inserts[0]!.user_id, 'u_test');
    assert(state.inserts[0]!.email_preferences);
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('T4 — ALLOWED_CATEGORIES locked at 5', () => {
  assertEquals(__internal.ALLOWED_CATEGORIES.length, 5);
  assert(__internal.ALLOWED_CATEGORIES.includes('welcome'));
  assert(__internal.ALLOWED_CATEGORIES.includes('behavior_triggered'));
  assert(__internal.ALLOWED_CATEGORIES.includes('retention'));
  assert(__internal.ALLOWED_CATEGORIES.includes('weekly_digest'));
  assert(__internal.ALLOWED_CATEGORIES.includes('affiliate'));
});
