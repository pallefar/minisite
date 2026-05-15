/**
 * Phase 19 Plan 19-05 Deno test suite for `affiliate-apply` Edge Function.
 *
 * Coverage:
 *   T1: missing fields → 400 missing_field
 *   T2: invalid email → 400 invalid_email
 *   T3: honeypot non-empty → 200 silent, NO DB insert, NO email
 *   T4: valid input + RESEND_API_KEY=test-stub → INSERT + 200 ok
 *   T5: already-existing application → 200 already_applied, no INSERT
 *   T6: rate-limit (6th request from same /24 in 15min) → 429
 *
 * Pattern mirrors `lead-capture/index.test.ts` — fake supabase-js admin
 * client + globally-stubbed fetch.
 *
 * Run: `RESEND_API_KEY=test-stub deno test --allow-env --allow-net supabase/functions/affiliate-apply/index.test.ts`
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// ---------------------------------------------------------------------------
// Globals: env + fetch stub
// ---------------------------------------------------------------------------

Deno.env.set('SUPABASE_URL', 'https://stub.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'stub-anon');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'stub-service-role');
Deno.env.set('RESEND_API_KEY', 'test-stub');

const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input.toString();
  fetchCalls.push({ url, init });
  return Promise.resolve(new Response('{}', { status: 200 }));
};

function resetFetch(): void {
  fetchCalls.length = 0;
}

// ---------------------------------------------------------------------------
// Fake supabase-js admin client
// ---------------------------------------------------------------------------

interface InsertCapture {
  table: string;
  row: Record<string, unknown>;
}

interface FakeAdminOpts {
  /** When set, the `affiliates` SELECT-by-email maybeSingle returns this row. */
  existingRow?: { id: string; status: string } | null;
  /** When true, the INSERT returns a unique-constraint error. */
  insertUniqueError?: boolean;
  /** When true, the INSERT throws a generic error. */
  insertGenericError?: boolean;
}

function buildFakeAdmin(opts: FakeAdminOpts = {}): {
  admin: unknown;
  inserts: InsertCapture[];
} {
  const inserts: InsertCapture[] = [];
  const existingRow = opts.existingRow ?? null;

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
                return Promise.resolve({ data: existingRow, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
          return builder;
        },
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          if (opts.insertUniqueError) {
            return Promise.resolve({
              data: null,
              error: { code: '23505', message: 'duplicate key value' },
            });
          }
          if (opts.insertGenericError) {
            return Promise.resolve({
              data: null,
              error: { code: 'XX000', message: 'unspecified failure' },
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };

  return { admin, inserts };
}

const indexModule = await import('./index.ts');

function makeReq(payload: unknown, ipHeader = '203.0.113.5'): Request {
  return new Request('https://example.local/functions/v1/affiliate-apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ipHeader },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

const VALID_BODY = {
  email: 'creator@example.com',
  name: 'Casey Creator',
  audience_size: 12000,
  audience_type: 'Instagram',
  why_us: 'I coach GLP-1 patients full-time and my audience asks me every week which app I use.',
  honeypot: '',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test('T1 — missing fields → 400 missing_field', async () => {
  indexModule.__internal.resetRateLimitState();
  resetFetch();
  const { admin, inserts } = buildFakeAdmin();
  indexModule.__internal.setAdminClient(admin);

  const res = await indexModule.__internal.handleApply(makeReq({}));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'missing_field');
  assertEquals(inserts.length, 0);
  assertEquals(
    fetchCalls.some((c) => c.url.includes('api.resend.com')),
    false,
  );
});

Deno.test('T2 — invalid email → 400 invalid_email', async () => {
  indexModule.__internal.resetRateLimitState();
  resetFetch();
  const { admin, inserts } = buildFakeAdmin();
  indexModule.__internal.setAdminClient(admin);

  const res = await indexModule.__internal.handleApply(
    makeReq({ ...VALID_BODY, email: 'not-an-email' }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'invalid_email');
  assertEquals(inserts.length, 0);
});

Deno.test('T3 — honeypot non-empty → 200 silent, no insert, no email', async () => {
  indexModule.__internal.resetRateLimitState();
  resetFetch();
  const { admin, inserts } = buildFakeAdmin();
  indexModule.__internal.setAdminClient(admin);

  const res = await indexModule.__internal.handleApply(
    makeReq({ ...VALID_BODY, honeypot: 'spam-bot-token' }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.already_applied, undefined);
  assertEquals(inserts.length, 0, 'honeypot path MUST NOT insert');
  assertEquals(
    fetchCalls.some((c) => c.url.includes('api.resend.com')),
    false,
    'honeypot path MUST NOT call Resend',
  );
});

Deno.test('T4 — valid input + RESEND_API_KEY=test-stub → INSERT + 200 ok', async () => {
  indexModule.__internal.resetRateLimitState();
  resetFetch();
  Deno.env.set('RESEND_API_KEY', 'test-stub');
  const { admin, inserts } = buildFakeAdmin();
  indexModule.__internal.setAdminClient(admin);

  const res = await indexModule.__internal.handleApply(makeReq(VALID_BODY));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.email_warning, undefined);
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0]!.table, 'affiliates');
  assertEquals(inserts[0]!.row.email, 'creator@example.com');
  assertEquals(inserts[0]!.row.display_name, 'Casey Creator');
  assertEquals(inserts[0]!.row.audience_type, 'Instagram');
  assertEquals(inserts[0]!.row.audience_size, 12000);
  assertEquals(inserts[0]!.row.status, 'pending');
  assertEquals(inserts[0]!.row.ip_signup, '203.0.113.5');
  // CI stub bypasses HTTPS — fetch never hits api.resend.com.
  assertEquals(
    fetchCalls.some((c) => c.url.includes('api.resend.com')),
    false,
    'CI stub must skip Resend HTTPS dispatch',
  );
});

Deno.test('T5 — already-existing application → 200 already_applied, no insert', async () => {
  indexModule.__internal.resetRateLimitState();
  resetFetch();
  const { admin, inserts } = buildFakeAdmin({
    existingRow: { id: 'aff-existing', status: 'pending' },
  });
  indexModule.__internal.setAdminClient(admin);

  const res = await indexModule.__internal.handleApply(makeReq(VALID_BODY));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.already_applied, true);
  assertEquals(inserts.length, 0, 'duplicate path MUST NOT insert');
});

Deno.test('T6 — rate-limit (6th request from same /24 in 15min) → 429', async () => {
  indexModule.__internal.resetRateLimitState();
  resetFetch();
  const { admin } = buildFakeAdmin();
  indexModule.__internal.setAdminClient(admin);

  // 5 successful applications from distinct emails but same /24.
  for (let i = 0; i < 5; i++) {
    const res = await indexModule.__internal.handleApply(
      makeReq({ ...VALID_BODY, email: `creator${i}@example.com` }, '203.0.113.42'),
    );
    assertEquals(res.status, 200, `attempt ${i + 1} should succeed`);
  }
  // 6th from same /24 must 429.
  const res6 = await indexModule.__internal.handleApply(
    makeReq({ ...VALID_BODY, email: 'creator6@example.com' }, '203.0.113.43'),
  );
  assertEquals(res6.status, 429);
  const body6 = await res6.json();
  assertEquals(body6.error, 'rate_limited');
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

addEventListener('unload', () => {
  globalThis.fetch = originalFetch;
});
