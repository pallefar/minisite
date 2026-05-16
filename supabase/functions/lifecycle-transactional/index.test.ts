/**
 * Deno tests for `lifecycle-transactional` Edge Function — Phase 22 plan 22-02 (ON-02).
 *
 * Test plan:
 *   T1 reject unknown template name → 400 unknown_template
 *   T2 missing fields → 400 missing_fields
 *   T3 health-check fails → 200 + skipped:true (no send)
 *   T4 renderTemplate emits zero <style> tags for all 4 allowed templates
 */
import { assert, assertEquals } from 'jsr:@std/assert@^1';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('SITE_URL', 'https://app.leanshot.app');

const { __internal } = await import('./index.ts');
const { renderTemplate } = await import('./templates.ts');

function fakeAdmin(): unknown {
  return {
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'u_test' } }, error: null }),
      admin: {
        getUserById: () =>
          Promise.resolve({
            data: { user: { id: 'u_test', email: 'test@example.com', user_metadata: { first_name: 'Ada' } } },
            error: null,
          }),
      },
    },
    from: () => ({}),
  };
}

Deno.test('T1 — unknown template → 400 unknown_template', async () => {
  Deno.env.set('RESEND_API_KEY', 'test-stub');
  __internal.setAdminForTest(fakeAdmin());
  try {
    const req = new Request('http://localhost/lifecycle-transactional', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-service-role-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: 'bogus', user_id: 'u_test', data: {} }),
    });
    const res = await __internal.handleSend(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, 'unknown_template');
  } finally {
    __internal.resetAdminForTest();
    Deno.env.delete('RESEND_API_KEY');
  }
});

Deno.test('T2 — missing fields → 400 missing_fields', async () => {
  Deno.env.set('RESEND_API_KEY', 'test-stub');
  __internal.setAdminForTest(fakeAdmin());
  try {
    const req = new Request('http://localhost/lifecycle-transactional', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-service-role-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: 'receipt' }), // no user_id
    });
    const res = await __internal.handleSend(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, 'missing_fields');
  } finally {
    __internal.resetAdminForTest();
    Deno.env.delete('RESEND_API_KEY');
  }
});

Deno.test('T3 — health-check fails → 200 + skipped:true', async () => {
  // No RESEND_API_KEY → no_api_key health gate.
  Deno.env.delete('RESEND_API_KEY');
  __internal.setAdminForTest(fakeAdmin());
  try {
    const req = new Request('http://localhost/lifecycle-transactional', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-service-role-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: 'receipt', user_id: 'u_test', data: { amount_usd: '29.00' } }),
    });
    const res = await __internal.handleSend(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.skipped, true);
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('T4 — all 4 templates render without <style> tags (Pitfall 8)', () => {
  const samples = [
    { name: 'receipt', data: { amount_usd: '29.00', plan_name: 'Pro', unsubscribe_url: 'u' } },
    { name: 'password_reset', data: { reset_url: 'https://x', unsubscribe_url: 'u' } },
    {
      name: 'dsar_ready',
      data: { download_url: 'https://x', expires_at: '2026-06-01', unsubscribe_url: 'u' },
    },
    {
      name: 'deletion_scheduled',
      data: { cancel_url: 'https://x', scheduled_deletion_date: '2026-06-01', unsubscribe_url: 'u' },
    },
  ];
  for (const s of samples) {
    const rendered = renderTemplate(s.name, s.data);
    assert(!/<style/i.test(rendered.html), `${s.name} contains <style> tag`);
    assert(rendered.subject.length > 0);
    assert(rendered.html.length > 0);
    assert(rendered.text.length > 0);
  }
});
