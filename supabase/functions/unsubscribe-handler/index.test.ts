/**
 * Phase 49 Plan 49-08 — Tests for unsubscribe-handler Edge Fn.
 *
 * Per memory `reference_deno_test_top_level_serve_trap`:
 *   - UNSUBSCRIBE_HANDLER_DISABLE_SERVE=1 set BEFORE dynamic-import of
 *     ./index.ts so the top-level `Deno.serve(handler)` does not run, which
 *     would otherwise dangle a port and abort the test process.
 *   - UNSUBSCRIBE_SECRET set BEFORE import so the lazily-imported
 *     unsubscribe-token module can readSigningKey() inside verify when the
 *     handler runs without a key-override (handler intentionally has no
 *     test seam; it reads env at runtime).
 *
 * The admin client is stubbed via setAdminForTest from lifecycle-utils — the
 * stub records UPSERT calls so we can assert the (user_id, category,
 * channel='email', enabled=false) row shape + onConflict key without a
 * Postgres round-trip.
 */

import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

Deno.env.set('UNSUBSCRIBE_HANDLER_DISABLE_SERVE', '1');
Deno.env.set('UNSUBSCRIBE_SECRET', 'test-fixture-key-49-08');
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'stub-service-role');

const { mintUnsubscribeToken } = await import('../_shared/unsubscribe-token.ts');
const mod = await import('./index.ts');
const { __internal } = mod;

interface UpsertCall {
  table: string;
  rows: unknown;
  opts: unknown;
}

function makeAdminStub(): {
  client: unknown;
  calls: UpsertCall[];
} {
  const calls: UpsertCall[] = [];
  const client = {
    from(table: string) {
      return {
        upsert(rows: unknown, opts: unknown) {
          calls.push({ table, rows, opts });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return { client, calls };
}

Deno.test('GET with valid token → 200 HTML + noindex meta + no-store + upsert', async () => {
  const { client, calls } = makeAdminStub();
  __internal.setAdminForTest(client);

  const tok = mintUnsubscribeToken({
    user_id: '00000000-0000-0000-0000-000000000001',
    category: 'daily_community_digest',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const res = await __internal.handler(
    new Request(`https://x.supabase.co/?t=${encodeURIComponent(tok)}`, { method: 'GET' }),
  );

  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assertEquals(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.text();
  assertStringIncludes(body, '<meta name="robots" content="noindex">');
  assertStringIncludes(body, 'daily community digest');

  assertEquals(calls.length, 1);
  assertEquals(calls[0].table, 'notification_settings');
  assertEquals(calls[0].rows, {
    user_id: '00000000-0000-0000-0000-000000000001',
    category: 'daily_community_digest',
    channel: 'email',
    enabled: false,
  });
  assertEquals(calls[0].opts, { onConflict: 'user_id,category,channel' });

  __internal.resetAdminForTest();
});

Deno.test('POST with valid token (RFC 8058 One-Click) → 200 + upsert', async () => {
  const { client, calls } = makeAdminStub();
  __internal.setAdminForTest(client);

  const tok = mintUnsubscribeToken({
    user_id: 'u2',
    category: 'weekly_community_digest',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const res = await __internal.handler(
    new Request(`https://x.supabase.co/?t=${encodeURIComponent(tok)}`, { method: 'POST' }),
  );

  assertEquals(res.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].rows, {
    user_id: 'u2',
    category: 'weekly_community_digest',
    channel: 'email',
    enabled: false,
  });

  __internal.resetAdminForTest();
});

Deno.test('tampered token → 401 invalid_token + no upsert', async () => {
  const { client, calls } = makeAdminStub();
  __internal.setAdminForTest(client);

  const tok = mintUnsubscribeToken({
    user_id: 'u3',
    category: 'daily_community_digest',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const parts = tok.split('.');
  const tampered = `${parts[0]}.${parts[1].slice(0, -2)}AA`;
  const res = await __internal.handler(
    new Request(`https://x.supabase.co/?t=${encodeURIComponent(tampered)}`, { method: 'GET' }),
  );

  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'invalid_token');
  assertEquals(calls.length, 0);

  __internal.resetAdminForTest();
});

Deno.test('expired token → 401 invalid_token + no upsert', async () => {
  const { client, calls } = makeAdminStub();
  __internal.setAdminForTest(client);

  const tok = mintUnsubscribeToken({
    user_id: 'u4',
    category: 'daily_community_digest',
    exp: Math.floor(Date.now() / 1000) - 1,
  });
  const res = await __internal.handler(
    new Request(`https://x.supabase.co/?t=${encodeURIComponent(tok)}`, { method: 'GET' }),
  );

  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'invalid_token');
  assertEquals(calls.length, 0);

  __internal.resetAdminForTest();
});

Deno.test('missing ?t param → 400 missing_token + no upsert', async () => {
  const { client, calls } = makeAdminStub();
  __internal.setAdminForTest(client);

  const res = await __internal.handler(
    new Request('https://x.supabase.co/', { method: 'GET' }),
  );

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'missing_token');
  assertEquals(calls.length, 0);

  __internal.resetAdminForTest();
});

Deno.test('unknown method (PUT) → 405 method_not_allowed', async () => {
  const { client, calls } = makeAdminStub();
  __internal.setAdminForTest(client);

  const res = await __internal.handler(
    new Request('https://x.supabase.co/?t=irrelevant', { method: 'PUT' }),
  );

  assertEquals(res.status, 405);
  const body = await res.json();
  assertEquals(body.error, 'method_not_allowed');
  assertEquals(calls.length, 0);

  __internal.resetAdminForTest();
});

Deno.test('OPTIONS preflight → 200 ok with CORS headers', async () => {
  const res = await __internal.handler(
    new Request('https://x.supabase.co/?t=irrelevant', { method: 'OPTIONS' }),
  );
  assertEquals(res.status, 200);
  // CORS headers from lifecycle-utils corsHeaders
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});
