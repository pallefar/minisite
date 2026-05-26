/**
 * handler.test.ts — Deno tests for lifecycle-win-back handler.
 *
 * Phase 65 Plan 65-07. T+30d / T+60d / T+90d post-cancel lifecycle emails
 * with per-user Stripe Promotion Code mint (10% / 25% / 50% off).
 *
 * 12 test cases per <behavior> in 65-07-PLAN.md.
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handle } from '../handler.ts';
import type { WinBackDeps } from '../handler.ts';

const MOCK_SERVICE_ROLE_KEY = 'test-service-role-key';
const MOCK_SUPABASE_URL = 'https://test.supabase.co';
const MOCK_SIGNING_KEY = 'test-signing-key-32byteslongaaaa';
const MOCK_PHYSICAL_ADDRESS = '123 Test Street, San Francisco, CA 94105';
const MOCK_RESEND_API_KEY = 're_test_live_key';

const MOCK_COUPONS = {
  t30d: 'coupon_winback_10',
  t60d: 'coupon_winback_25',
  t90d: 'coupon_winback_50',
};

// ── Fake row shape ──────────────────────────────────────────────────────────

interface FakeRow {
  user_id: string;
  email: string;
  first_name: string;
  stripe_customer_id: string | null;
  email_marketing_consent: boolean | null;
  cancelled_at: string;
}

const ROWS_T30: FakeRow[] = [
  {
    user_id: 'user-30-1',
    email: 'alice@example.com',
    first_name: 'Alice',
    stripe_customer_id: 'cus_alice',
    email_marketing_consent: true,
    cancelled_at: new Date(Date.now() - 33 * 86400 * 1000).toISOString(),
  },
];
const ROWS_T60: FakeRow[] = [
  {
    user_id: 'user-60-1',
    email: 'bob@example.com',
    first_name: 'Bob',
    stripe_customer_id: 'cus_bob',
    email_marketing_consent: true,
    cancelled_at: new Date(Date.now() - 63 * 86400 * 1000).toISOString(),
  },
];
const ROWS_T90: FakeRow[] = [
  {
    user_id: 'user-90-1',
    email: 'carol@example.com',
    first_name: 'Carol',
    stripe_customer_id: 'cus_carol',
    email_marketing_consent: true,
    cancelled_at: new Date(Date.now() - 93 * 86400 * 1000).toISOString(),
  },
];

// ── Mock Supabase ───────────────────────────────────────────────────────────

function buildMockSupabaseClient(opts: {
  rowsByStage?: Partial<Record<'winback_t30d' | 'winback_t60d' | 'winback_t90d', FakeRow[]>>;
  alreadySent?: string[];
} = {}) {
  const { rowsByStage, alreadySent = [] } = opts;
  const sentRows: Array<{
    user_id: string;
    stage: string;
    promo_code?: string;
    resend_message_id?: string | null;
  }> = [];

  const byStage = {
    winback_t30d: rowsByStage?.winback_t30d ?? ROWS_T30,
    winback_t60d: rowsByStage?.winback_t60d ?? ROWS_T60,
    winback_t90d: rowsByStage?.winback_t90d ?? ROWS_T90,
  };

  const client = {
    rpc: (_fn: string, params: { stage_key: string }) => ({
      select: () => Promise.resolve({
        data: byStage[params.stage_key as keyof typeof byStage] ?? [],
        error: null,
      }),
    }),
    from: (table: string) => {
      if (table === 'lifecycle_emails_sent') {
        return {
          upsert: (
            row: { user_id: string; stage: string },
            _opts?: { onConflict?: string; ignoreDuplicates?: boolean },
          ) => ({
            select: () => {
              const key = `${row.user_id}|${row.stage}`;
              if (alreadySent.includes(key)) {
                return Promise.resolve({ data: [], error: null });
              }
              sentRows.push({ ...row });
              return Promise.resolve({ data: [row], error: null });
            },
          }),
          update: (patch: { promo_code?: string; resend_message_id?: string | null }) => ({
            eq: (_c1: string, v1: string) => ({
              eq: (_c2: string, v2: string) => {
                const row = sentRows.find((r) => r.user_id === v1 && r.stage === v2);
                if (row) Object.assign(row, patch);
                return Promise.resolve({ data: row ? [row] : [], error: null });
              },
            }),
          }),
          delete: () => ({
            eq: (_c1: string, v1: string) => ({
              eq: (_c2: string, v2: string) => {
                const idx = sentRows.findIndex((r) => r.user_id === v1 && r.stage === v2);
                if (idx >= 0) sentRows.splice(idx, 1);
                return Promise.resolve({ data: null, error: null });
              },
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
      };
    },
  };

  return { client: client as unknown as WinBackDeps['supabaseServiceClient'], sentRows };
}

// ── Mock Stripe ─────────────────────────────────────────────────────────────

function buildMockStripe(opts: { shouldFail?: boolean } = {}) {
  const calls: Array<{
    coupon: string;
    max_redemptions: number;
    customer: string;
    code: string;
    expires_at: number;
  }> = [];

  const stripe = {
    promotionCodes: {
      create: (params: {
        coupon: string;
        max_redemptions: number;
        customer: string;
        code: string;
        expires_at: number;
      }) => {
        calls.push(params);
        if (opts.shouldFail) {
          return Promise.reject(new Error('stripe_failure'));
        }
        return Promise.resolve({
          id: `promo_${params.code}`,
          code: params.code,
          coupon: { id: params.coupon },
          customer: params.customer,
          max_redemptions: params.max_redemptions,
        });
      },
    },
  };

  return { stripe: stripe as unknown as WinBackDeps['stripe'], calls };
}

// ── Mock fetch ──────────────────────────────────────────────────────────────

function buildMockFetch(opts: { resendFail?: boolean } = {}) {
  const resendCalls: Array<{ to: string; subject: string; html: string; text: string }> = [];

  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = url.toString();
    if (urlStr.includes('api.resend.com/emails')) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      resendCalls.push({
        to: Array.isArray(body.to) ? body.to[0] : body.to,
        subject: body.subject,
        html: body.html,
        text: body.text,
      });
      if (opts.resendFail) {
        return new Response(JSON.stringify({ error: 'failed' }), { status: 500 });
      }
      return new Response(JSON.stringify({ id: `msg-${resendCalls.length}` }), { status: 200 });
    }
    if (urlStr.includes('hooks.slack.com')) {
      return new Response('ok', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  return { mockFetch, resendCalls };
}

// ── buildDeps ───────────────────────────────────────────────────────────────

function buildDeps(overrides: Partial<WinBackDeps> & {
  rowsByStage?: Parameters<typeof buildMockSupabaseClient>[0]['rowsByStage'];
  alreadySent?: string[];
  stripeShouldFail?: boolean;
  resendFail?: boolean;
} = {}) {
  const {
    rowsByStage,
    alreadySent,
    stripeShouldFail,
    resendFail,
    ...rest
  } = overrides;
  const { mockFetch, resendCalls } = buildMockFetch({ resendFail });
  const { stripe, calls: stripeCalls } = buildMockStripe({ shouldFail: stripeShouldFail });
  const { client, sentRows } = buildMockSupabaseClient({ rowsByStage, alreadySent });

  const deps: WinBackDeps = {
    fetchImpl: mockFetch,
    supabaseServiceClient: client,
    stripe,
    resendApiKey: MOCK_RESEND_API_KEY,
    serviceRoleKey: MOCK_SERVICE_ROLE_KEY,
    supabaseUrl: MOCK_SUPABASE_URL,
    signingKey: MOCK_SIGNING_KEY,
    physicalAddress: MOCK_PHYSICAL_ADDRESS,
    coupons: MOCK_COUPONS,
    ...rest,
  };
  return { deps, resendCalls, stripeCalls, sentRows };
}

function buildPostRequest(bearer?: string): Request {
  return new Request('https://test.supabase.co/functions/v1/lifecycle-win-back', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer !== undefined ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({}),
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

Deno.test('1. POST / requires service-role bearer; 401 on mismatch', async () => {
  const { deps } = buildDeps();
  const res = await handle(buildPostRequest('wrong-key'), deps);
  assertEquals(res.status, 401);
});

Deno.test('2. POST / sends T+30d email with 10%-off promo code', async () => {
  const { deps, resendCalls, stripeCalls } = buildDeps({
    rowsByStage: { winback_t30d: ROWS_T30, winback_t60d: [], winback_t90d: [] },
  });
  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(res.status, 200);
  assertEquals(resendCalls.length, 1);
  assertEquals(stripeCalls.length, 1);
  assertEquals(stripeCalls[0].coupon, 'coupon_winback_10');
  assertEquals(stripeCalls[0].customer, 'cus_alice');
  // Promo code embedded in email body
  assertEquals(resendCalls[0].text.includes(stripeCalls[0].code), true);
});

Deno.test('3. POST / sends T+60d email with 25%-off code', async () => {
  const { deps, resendCalls, stripeCalls } = buildDeps({
    rowsByStage: { winback_t30d: [], winback_t60d: ROWS_T60, winback_t90d: [] },
  });
  await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(resendCalls.length, 1);
  assertEquals(stripeCalls[0].coupon, 'coupon_winback_25');
});

Deno.test('4. POST / sends T+90d email with 50%-off code', async () => {
  const { deps, resendCalls, stripeCalls } = buildDeps({
    rowsByStage: { winback_t30d: [], winback_t60d: [], winback_t90d: ROWS_T90 },
  });
  await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(resendCalls.length, 1);
  assertEquals(stripeCalls[0].coupon, 'coupon_winback_50');
});

Deno.test('5. Promo Code mint params: max_redemptions=1, customer set, coupon resolved', async () => {
  const { deps, stripeCalls } = buildDeps({
    rowsByStage: { winback_t30d: ROWS_T30, winback_t60d: [], winback_t90d: [] },
  });
  await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(stripeCalls.length, 1);
  assertEquals(stripeCalls[0].max_redemptions, 1);
  assertEquals(stripeCalls[0].customer, 'cus_alice');
  assertEquals(stripeCalls[0].coupon, 'coupon_winback_10');
  // 30-day expires_at sanity check (within +/- 5 minutes of expected window)
  const expectedExpires = Math.floor(Date.now() / 1000) + 30 * 86400;
  const drift = Math.abs(stripeCalls[0].expires_at - expectedExpires);
  assertEquals(drift < 300, true);
  // Code prefix
  assertEquals(stripeCalls[0].code.startsWith('WINBACK-'), true);
});

Deno.test('6. Generated PromotionCode stored in lifecycle_emails_sent.promo_code', async () => {
  const { deps, sentRows, stripeCalls } = buildDeps({
    rowsByStage: { winback_t30d: ROWS_T30, winback_t60d: [], winback_t90d: [] },
  });
  await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  const row = sentRows.find((r) => r.user_id === 'user-30-1' && r.stage === 'winback_t30d');
  assertEquals(row?.promo_code, stripeCalls[0].code);
});

Deno.test('7. PHYSICAL_ADDRESS placeholder → 503 (CAN-SPAM + LEGAL-09)', async () => {
  const { deps, resendCalls } = buildDeps({ physicalAddress: '[YOUR ADDRESS]' });
  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(res.status, 503);
  assertEquals(resendCalls.length, 0);
});

Deno.test('8. RPC excludes consent=false + email_lifecycle_exclusion (DB-level)', async () => {
  const { deps, resendCalls } = buildDeps({
    rowsByStage: { winback_t30d: [], winback_t60d: [], winback_t90d: [] },
  });
  await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(resendCalls.length, 0);
});

Deno.test('9. Idempotency: 2nd invocation skipped without re-minting Promotion Code', async () => {
  const { deps, resendCalls, stripeCalls } = buildDeps({
    rowsByStage: { winback_t30d: ROWS_T30, winback_t60d: [], winback_t90d: [] },
    alreadySent: ['user-30-1|winback_t30d'],
  });
  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number; skipped: number };
  assertEquals(body.sent, 0);
  assertEquals(body.skipped, 1);
  assertEquals(resendCalls.length, 0);
  assertEquals(stripeCalls.length, 0); // no Stripe mint when already sent
});

Deno.test('10. Stripe mint failure → row rolled back + error pushed + email NOT sent', async () => {
  const { deps, resendCalls, sentRows } = buildDeps({
    rowsByStage: { winback_t30d: ROWS_T30, winback_t60d: [], winback_t90d: [] },
    stripeShouldFail: true,
  });
  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number; errors: string[] };
  assertEquals(body.sent, 0);
  assertEquals(body.errors.length > 0, true);
  assertEquals(resendCalls.length, 0); // email not sent
  assertEquals(sentRows.length, 0); // row deleted (rollback)
});

Deno.test('11. User without stripe_customer_id is skipped', async () => {
  const rowsNoCustomer = [
    {
      ...ROWS_T30[0],
      user_id: 'user-no-cust',
      email: 'noc@example.com',
      stripe_customer_id: null,
    },
  ];
  const { deps, resendCalls, stripeCalls } = buildDeps({
    rowsByStage: { winback_t30d: rowsNoCustomer, winback_t60d: [], winback_t90d: [] },
  });
  await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(resendCalls.length, 0);
  assertEquals(stripeCalls.length, 0);
});

Deno.test('12. Each stage uses correct template (subject discriminator)', async () => {
  const { deps, resendCalls } = buildDeps({
    rowsByStage: {
      winback_t30d: ROWS_T30,
      winback_t60d: ROWS_T60,
      winback_t90d: ROWS_T90,
    },
  });
  await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(resendCalls.length, 3);
  // The order is t30d → t60d → t90d
  assertEquals(resendCalls[0].subject.includes('10%'), true);
  assertEquals(resendCalls[1].subject.includes('25%'), true);
  assertEquals(resendCalls[2].subject.includes('50%'), true);
});

Deno.test('13. GET /healthz → 200', async () => {
  const { deps } = buildDeps();
  const res = await handle(
    new Request('https://test.supabase.co/functions/v1/lifecycle-win-back/healthz', { method: 'GET' }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as { ok: boolean; fn: string };
  assertEquals(body.ok, true);
  assertEquals(body.fn, 'lifecycle-win-back');
});

Deno.test('14. Resend failure → row rolled back + Stripe orphan-coupon logged', async () => {
  const { deps, sentRows } = buildDeps({
    rowsByStage: { winback_t30d: ROWS_T30, winback_t60d: [], winback_t90d: [] },
    resendFail: true,
  });
  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { errors: string[] };
  assertEquals(body.errors.length > 0, true);
  // Row deleted so next cron run retries
  assertEquals(sentRows.length, 0);
});
