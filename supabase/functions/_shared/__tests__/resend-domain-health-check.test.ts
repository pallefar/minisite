/**
 * Tests for the shared Resend domain gated-send health check — Phase 22 plan 22-02 (D-03).
 *
 * Owner: plan 22-02 (Wave-0 scaffold from plan 22-01 turned green here).
 *
 * Test plan:
 *   T1 RESEND_API_KEY missing            → {ok:false, status:'no_api_key'}, no fetch, no counter
 *   T2 RESEND_API_KEY=test-stub          → {ok:true, status:'verified'}, no fetch
 *   T3 domain status='verified'          → {ok:true, status:'verified'}, no counter call
 *   T4 domain status='pending'           → {ok:false, status:'pending'}, counter RPC fired, warn logged
 *   T5 domain not present in list        → {ok:false, status:'not_found'}, counter fired
 *   T6 fetch throws (network)            → {ok:false, status:'fetch_error'}, counter fired
 *
 * No real network — `fetch` is stubbed per test.
 */
import { assert, assertEquals } from 'jsr:@std/assert@^1';
import { resendDomainHealthCheck } from '../resend-domain-health-check.ts';

interface SpyState {
  rpcCalls: string[];
  fetchCalls: number;
}

function buildFakeSupabase(state: SpyState): unknown {
  return {
    rpc: (name: string) => {
      state.rpcCalls.push(name);
      return Promise.resolve({ error: null, data: null });
    },
  };
}

function clearEnv() {
  Deno.env.delete('RESEND_API_KEY');
}

function withFetchStub(impl: typeof fetch, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test('T1 — missing RESEND_API_KEY → no_api_key, no fetch, no counter', async () => {
  clearEnv();
  const state: SpyState = { rpcCalls: [], fetchCalls: 0 };
  await withFetchStub(
    (() => {
      state.fetchCalls += 1;
      return Promise.resolve(new Response('{}'));
    }) as typeof fetch,
    async () => {
      // deno-lint-ignore no-explicit-any
      const out = await resendDomainHealthCheck(buildFakeSupabase(state) as any);
      assertEquals(out, { ok: false, status: 'no_api_key' });
      assertEquals(state.fetchCalls, 0);
      assertEquals(state.rpcCalls.length, 0);
    },
  );
});

Deno.test('T2 — RESEND_API_KEY=test-stub → verified short-circuit, no fetch', async () => {
  Deno.env.set('RESEND_API_KEY', 'test-stub');
  const state: SpyState = { rpcCalls: [], fetchCalls: 0 };
  await withFetchStub(
    (() => {
      state.fetchCalls += 1;
      return Promise.resolve(new Response('{}'));
    }) as typeof fetch,
    async () => {
      // deno-lint-ignore no-explicit-any
      const out = await resendDomainHealthCheck(buildFakeSupabase(state) as any);
      assertEquals(out, { ok: true, status: 'verified' });
      assertEquals(state.fetchCalls, 0);
      assertEquals(state.rpcCalls.length, 0);
    },
  );
  clearEnv();
});

Deno.test('T3 — domain status=verified → ok:true, no counter call', async () => {
  Deno.env.set('RESEND_API_KEY', 'rs_real_key');
  const state: SpyState = { rpcCalls: [], fetchCalls: 0 };
  await withFetchStub(
    (() => {
      state.fetchCalls += 1;
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: [{ name: 'app.leanshot.app', status: 'verified' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }) as typeof fetch,
    async () => {
      // deno-lint-ignore no-explicit-any
      const out = await resendDomainHealthCheck(buildFakeSupabase(state) as any);
      assertEquals(out, { ok: true, status: 'verified' });
      assertEquals(state.fetchCalls, 1);
      assertEquals(state.rpcCalls.length, 0);
    },
  );
  clearEnv();
});

Deno.test('T4 — domain status=pending → ok:false + counter fires', async () => {
  Deno.env.set('RESEND_API_KEY', 'rs_real_key');
  const state: SpyState = { rpcCalls: [], fetchCalls: 0 };
  await withFetchStub(
    (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: [{ name: 'app.leanshot.app', status: 'pending' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )) as typeof fetch,
    async () => {
      // deno-lint-ignore no-explicit-any
      const out = await resendDomainHealthCheck(buildFakeSupabase(state) as any);
      assertEquals(out, { ok: false, status: 'pending' });
      assertEquals(state.rpcCalls, ['increment_resend_domain_unverified_skips']);
    },
  );
  clearEnv();
});

Deno.test('T5 — domain not in list → ok:false + status=not_found + counter fires', async () => {
  Deno.env.set('RESEND_API_KEY', 'rs_real_key');
  const state: SpyState = { rpcCalls: [], fetchCalls: 0 };
  await withFetchStub(
    (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: [{ name: 'other.example.com', status: 'verified' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )) as typeof fetch,
    async () => {
      // deno-lint-ignore no-explicit-any
      const out = await resendDomainHealthCheck(buildFakeSupabase(state) as any);
      assertEquals(out.ok, false);
      assertEquals(out.status, 'not_found');
      assert(state.rpcCalls.includes('increment_resend_domain_unverified_skips'));
    },
  );
  clearEnv();
});

Deno.test('T6 — fetch throws → fetch_error + counter fires', async () => {
  Deno.env.set('RESEND_API_KEY', 'rs_real_key');
  const state: SpyState = { rpcCalls: [], fetchCalls: 0 };
  await withFetchStub(
    (() => {
      throw new TypeError('network down');
    }) as typeof fetch,
    async () => {
      // deno-lint-ignore no-explicit-any
      const out = await resendDomainHealthCheck(buildFakeSupabase(state) as any);
      assertEquals(out, { ok: false, status: 'fetch_error' });
      assert(state.rpcCalls.includes('increment_resend_domain_unverified_skips'));
    },
  );
  clearEnv();
});
