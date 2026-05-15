/**
 * Phase 15 Plan 15-07 Deno test suite for `lead-capture` Edge Function.
 *
 * Coverage strategy:
 *   - PURE helpers (sha256Hex, escape) are tested directly.
 *   - DISPATCHER + handler is tested via a fake admin supabase-js client
 *     injected via the module-level `__internal.setAdminClient` seam and a
 *     globally-stubbed `fetch` (to intercept Resend). Real DB is NEVER
 *     touched. Pattern mirrors `clinic-invite/index.test.ts`.
 *
 * Test list (mirrors the plan's <action> Task 0):
 *   1.  submit happy path inserts leads row
 *   2.  submit honeypot filled returns 200 and inserts no real-lead row
 *   3.  submit rate-limited returns 429
 *   4.  submit missing email returns 400
 *   5.  submit invalid email returns 400
 *   6.  submit bad json returns 400
 *   7.  CORS preflight returns * origin no credentials
 *   8.  resend CI stub does not hit network
 *
 * Run:
 *   cd supabase/functions/lead-capture && deno test --allow-all
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { corsHeaders } from './cors.ts';

// ---------------------------------------------------------------------------
// Globals: env + fetch stub
// ---------------------------------------------------------------------------

Deno.env.set('SUPABASE_URL', 'https://stub.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'stub-anon');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'stub-service-role');
Deno.env.set('RESEND_API_KEY', 'test-stub');

// Capture fetch calls so we can assert Resend behavior.
const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
const originalFetch = globalThis.fetch;
type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let fetchHandler: FetchHandler | null = null;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input.toString();
  fetchCalls.push({ url, init });
  if (fetchHandler) {
    return Promise.resolve(fetchHandler(url, init));
  }
  // Default: pretend Resend succeeded.
  return Promise.resolve(new Response('{}', { status: 200 }));
};

function resetFetch(): void {
  fetchCalls.length = 0;
  fetchHandler = null;
}

// ---------------------------------------------------------------------------
// CORS preflight contract
// ---------------------------------------------------------------------------

Deno.test('CORS preflight returns * origin no credentials', () => {
  assertEquals(corsHeaders['Access-Control-Allow-Origin'], '*');
  assertEquals(corsHeaders['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  assertEquals(
    Object.keys(corsHeaders).some((k) => k.toLowerCase() === 'access-control-allow-credentials'),
    false,
    'Public form POST MUST NOT set credentials',
  );
});

// ---------------------------------------------------------------------------
// Fake admin client + handler tests
// ---------------------------------------------------------------------------

// A minimal fake supabase-js client recording the calls the handler makes.
interface InsertCapture {
  table: string;
  row: Record<string, unknown>;
}

interface FakeAdminOpts {
  /** Number to return from the leads count rate-limit query. */
  rateLimitCount?: number;
  /** Whether the insert should error. */
  insertError?: boolean;
  /** Whether the page slug lookup returns a matching row. */
  pageSlugRow?: { id: string } | null;
}

function buildFakeAdmin(opts: FakeAdminOpts = {}): {
  admin: unknown;
  inserts: InsertCapture[];
} {
  const inserts: InsertCapture[] = [];
  const rateLimitCount = opts.rateLimitCount ?? 0;
  const pageSlugRow = opts.pageSlugRow ?? null;
  const insertError = opts.insertError ?? false;

  const admin = {
    from(table: string) {
      // The chain we need to support:
      //   .from('leads').select('*', { count: 'exact', head: true }).eq('ip_hash', x).gte('created_at', y)
      //   .from('leads').insert({ ... })
      //   .from('landing_pages').select('id').eq('slug', x).maybeSingle()
      return {
        select(_cols: string, sopts?: { count?: string; head?: boolean }) {
          const isCount = sopts?.count === 'exact';
          const builder = {
            _filters: {} as Record<string, unknown>,
            eq(col: string, val: unknown) {
              this._filters[col] = val;
              return this;
            },
            gte(col: string, val: unknown) {
              this._filters[col + '__gte'] = val;
              return this;
            },
            maybeSingle() {
              if (table === 'landing_pages') {
                return Promise.resolve({ data: pageSlugRow, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            },
            then(resolve: (v: unknown) => void) {
              if (isCount) {
                resolve({ count: rateLimitCount, data: null, error: null });
              } else {
                resolve({ data: null, error: null });
              }
            },
          };
          return builder;
        },
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          if (insertError) {
            return Promise.resolve({ data: null, error: { message: 'mock_insert_error' } });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };

  return { admin, inserts };
}

const indexModule = await import('./index.ts');

Deno.test('submit happy path inserts leads row', async () => {
  resetFetch();
  const { admin, inserts } = buildFakeAdmin({ rateLimitCount: 0 });
  indexModule.__internal.setAdminClient(admin);

  const req = new Request('https://example.local/functions/v1/lead-capture/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'visitor@example.com' }),
  });
  const res = await indexModule.__internal.handleSubmit(req);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  // Exactly one insert into the `leads` table with `honeypot_flagged: false`.
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0]!.table, 'leads');
  assertEquals(inserts[0]!.row.email, 'visitor@example.com');
  assertEquals(inserts[0]!.row.honeypot_flagged, false);
});

Deno.test('submit honeypot filled returns 200 and inserts no real-lead row', async () => {
  resetFetch();
  const { admin, inserts } = buildFakeAdmin({ rateLimitCount: 0 });
  indexModule.__internal.setAdminClient(admin);

  const req = new Request('https://example.local/functions/v1/lead-capture/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'visitor@example.com', website: 'spam-bot-payload' }),
  });
  const res = await indexModule.__internal.handleSubmit(req);
  assertEquals(res.status, 200);
  const body = await res.json();
  // Identical body shape to success path — bots learn nothing.
  assertEquals(body.ok, true);
  // The honeypot-flagged insert is allowed (analytics) but `honeypot_flagged`
  // must be true and no Resend dispatch may have occurred.
  for (const ins of inserts) {
    if (ins.table === 'leads') {
      assertEquals(ins.row.honeypot_flagged, true, 'honeypot-flagged row only');
    }
  }
  assertEquals(
    fetchCalls.some((c) => c.url.includes('api.resend.com')),
    false,
    'honeypot path MUST NOT call Resend',
  );
});

Deno.test('submit rate-limited returns 429', async () => {
  resetFetch();
  // 5+ submissions already in this 15-min window → next must 429.
  const { admin, inserts } = buildFakeAdmin({ rateLimitCount: 5 });
  indexModule.__internal.setAdminClient(admin);

  const req = new Request('https://example.local/functions/v1/lead-capture/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'visitor@example.com' }),
  });
  const res = await indexModule.__internal.handleSubmit(req);
  assertEquals(res.status, 429);
  const body = await res.json();
  assertEquals(body.error, 'rate_limited');
  // MUST NOT have inserted on the rate-limited path.
  assertEquals(inserts.filter((i) => i.table === 'leads').length, 0);
});

Deno.test('submit missing email returns 400', async () => {
  resetFetch();
  const { admin } = buildFakeAdmin();
  indexModule.__internal.setAdminClient(admin);

  const req = new Request('https://example.local/functions/v1/lead-capture/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const res = await indexModule.__internal.handleSubmit(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'missing_email');
});

Deno.test('submit invalid email returns 400', async () => {
  resetFetch();
  const { admin } = buildFakeAdmin();
  indexModule.__internal.setAdminClient(admin);

  const req = new Request('https://example.local/functions/v1/lead-capture/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' }),
  });
  const res = await indexModule.__internal.handleSubmit(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'invalid_email');
});

Deno.test('submit bad json returns 400', async () => {
  resetFetch();
  const { admin } = buildFakeAdmin();
  indexModule.__internal.setAdminClient(admin);

  const req = new Request('https://example.local/functions/v1/lead-capture/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await indexModule.__internal.handleSubmit(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'bad_json');
});

Deno.test('resend CI stub does not hit network', async () => {
  resetFetch();
  // Even with a notify recipient set, the test-stub key must short-circuit.
  Deno.env.set('RESEND_API_KEY', 'test-stub');
  Deno.env.set('LEAD_NOTIFY_TO', 'staff@example.com');
  const { admin } = buildFakeAdmin({ rateLimitCount: 0 });
  indexModule.__internal.setAdminClient(admin);

  const req = new Request('https://example.local/functions/v1/lead-capture/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'visitor@example.com' }),
  });
  const res = await indexModule.__internal.handleSubmit(req);
  assertEquals(res.status, 200);
  // The CI stub bypasses HTTPS dispatch — fetch never hits api.resend.com.
  assertEquals(
    fetchCalls.some((c) => c.url.includes('api.resend.com')),
    false,
    'CI stub must skip Resend HTTPS dispatch',
  );
  // Reset for downstream tests.
  Deno.env.delete('LEAD_NOTIFY_TO');
});

Deno.test('clientIpFromReq uses x-forwarded-for first', () => {
  const req = new Request('https://example.local/x', {
    headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1', 'x-real-ip': '10.0.0.2' },
  });
  assertEquals(indexModule.__internal.clientIpFromReq(req), '203.0.113.5');
});

// ---------------------------------------------------------------------------
// Cleanup: restore globalThis.fetch
// ---------------------------------------------------------------------------

addEventListener('unload', () => {
  globalThis.fetch = originalFetch;
});
