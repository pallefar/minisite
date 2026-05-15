/**
 * Phase 19 Plan 19-08 Deno test suite for `affiliate-impression` Edge Function.
 *
 * 4 tests:
 *   T1: method GET → 405 method_not_allowed
 *   T2: valid body + approved affiliate → RPC called with raw IP + 200 ok
 *   T3: 11th request from same /24 within 60s → 429 rate_limited
 *   T4: unknown / non-approved affiliate → silent 200 (no RPC, no enumeration)
 *
 * Pattern mirrors `affiliate-apply/index.test.ts` — fake admin client +
 * captured calls, no real network.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

Deno.env.set('SUPABASE_URL', 'https://stub.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'stub-anon');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'stub-service-role');

// ---------------------------------------------------------------------------
// Fake admin client
// ---------------------------------------------------------------------------

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface FakeAdminOpts {
  /** Row returned from `affiliates.select(...).maybeSingle()`. */
  affiliateRow?: { id: string; status: string } | null;
}

function buildFakeAdmin(opts: FakeAdminOpts = {}): {
  admin: unknown;
  rpcCalls: RpcCall[];
} {
  const rpcCalls: RpcCall[] = [];
  const affiliateRow = opts.affiliateRow ?? null;

  const admin = {
    from(table: string) {
      return {
        select(_cols: string) {
          const builder = {
            _filters: {} as Record<string, unknown>,
            eq(col: string, val: unknown) {
              this._filters[col] = val;
              return this;
            },
            maybeSingle() {
              if (table === 'affiliates') {
                return Promise.resolve({ data: affiliateRow, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
          return builder;
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { admin, rpcCalls };
}

const indexModule = await import('./index.ts');

const VALID_BODY = {
  affiliate_id: '11111111-1111-1111-1111-111111111111',
  // SHA-256 of empty string padded to a valid 64-char hex (deterministic; not real).
  ua_hash: '0'.repeat(64),
  referer: 'https://t.co/abc123',
};

function makeReq(payload: unknown, ipHeader = '203.0.113.5', method = 'POST'): Request {
  return new Request('https://example.local/functions/v1/affiliate-impression', {
    method,
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ipHeader },
    body:
      method === 'POST'
        ? typeof payload === 'string'
          ? payload
          : JSON.stringify(payload)
        : undefined,
  });
}

// Top-level dispatcher (mirrors `Deno.serve`).
async function dispatch(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return indexModule.__internal.handleImpression(req);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test('T1 — method GET → 405 method_not_allowed', async () => {
  indexModule.__internal.resetRateLimit();
  const { admin } = buildFakeAdmin();
  indexModule.__internal.setAdminClient(admin);

  const res = await dispatch(makeReq(undefined, '203.0.113.5', 'GET'));
  assertEquals(res.status, 405);
});

Deno.test('T2 — valid body + approved affiliate → RPC called + 200 ok', async () => {
  indexModule.__internal.resetRateLimit();
  const { admin, rpcCalls } = buildFakeAdmin({
    affiliateRow: { id: VALID_BODY.affiliate_id, status: 'approved' },
  });
  indexModule.__internal.setAdminClient(admin);

  const res = await indexModule.__internal.handleImpression(makeReq(VALID_BODY, '198.51.100.42'));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0]!.fn, 'insert_affiliate_impression');
  assertEquals(rpcCalls[0]!.args.p_affiliate_id, VALID_BODY.affiliate_id);
  // RAW IP is forwarded — the SQL helper does the /24 truncation server-side.
  assertEquals(rpcCalls[0]!.args.p_ip, '198.51.100.42');
  assertEquals(rpcCalls[0]!.args.p_ua_hash, VALID_BODY.ua_hash);
  assertEquals(rpcCalls[0]!.args.p_referer, VALID_BODY.referer);
});

Deno.test('T3 — 11th request from same /24 in 60s → 429', async () => {
  indexModule.__internal.resetRateLimit();
  const { admin } = buildFakeAdmin({
    affiliateRow: { id: VALID_BODY.affiliate_id, status: 'approved' },
  });
  indexModule.__internal.setAdminClient(admin);

  // 10 successful requests from same /24 (last octet varies but masklen=24).
  for (let i = 0; i < 10; i++) {
    const res = await indexModule.__internal.handleImpression(
      makeReq(VALID_BODY, `203.0.113.${i}`),
    );
    assertEquals(res.status, 200, `attempt ${i + 1} should succeed`);
  }
  // 11th from same /24 must 429.
  const res11 = await indexModule.__internal.handleImpression(
    makeReq(VALID_BODY, '203.0.113.250'),
  );
  assertEquals(res11.status, 429);
  const body = await res11.json();
  assertEquals(body.error, 'rate_limited');
});

Deno.test('T4 — unknown / non-approved affiliate → silent 200, no RPC', async () => {
  indexModule.__internal.resetRateLimit();
  const { admin, rpcCalls } = buildFakeAdmin({ affiliateRow: null });
  indexModule.__internal.setAdminClient(admin);

  const res = await indexModule.__internal.handleImpression(makeReq(VALID_BODY, '192.0.2.7'));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(rpcCalls.length, 0, 'must not RPC for non-approved or missing affiliate');
});
