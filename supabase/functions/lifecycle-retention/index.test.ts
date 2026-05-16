/**
 * Deno tests for `lifecycle-retention` Edge Function — Phase 22 plan 22-02 (ON-02).
 *
 * Test plan:
 *   T1 health-check fails → 200 + skipped:true
 *   T2 health ok + no candidates → 200 + sent:0
 */
import { assertEquals } from 'jsr:@std/assert@^1';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('SITE_URL', 'https://app.leanshot.app');

const { __internal } = await import('./index.ts');

function emptyFakeAdmin(): unknown {
  return {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: () => ({
      select: () => ({
        gt: () => ({
          lt: () => Promise.resolve({ data: [], error: null }),
        }),
        order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
        eq: () => ({
          order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
        not: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
      }),
      upsert: () => Promise.resolve({ data: null, error: null }),
    }),
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: null }, error: null }) } },
  };
}

Deno.test('T1 — health-check fails → 200 + skipped:true', async () => {
  Deno.env.delete('RESEND_API_KEY');
  __internal.setAdminForTest(emptyFakeAdmin());
  try {
    const req = new Request('http://localhost/lifecycle-retention', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-service-role-key' },
    });
    const res = await __internal.handleRun(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.skipped, true);
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('T2 — health ok + no candidates → 200 + sent:0', async () => {
  Deno.env.set('RESEND_API_KEY', 'test-stub');
  __internal.setAdminForTest(emptyFakeAdmin());
  try {
    const req = new Request('http://localhost/lifecycle-retention', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-service-role-key' },
    });
    const res = await __internal.handleRun(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.sent, 0);
  } finally {
    __internal.resetAdminForTest();
    Deno.env.delete('RESEND_API_KEY');
  }
});
