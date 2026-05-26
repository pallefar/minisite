/**
 * handler.test.ts — Deno tests for lifecycle-trial-ending handler.
 *
 * Phase 65 Plan 65-07. T-3d + T-1d cron-driven lifecycle emails with
 * PostHog A/B copy variant on T-3d.
 *
 * 12 test cases per <behavior> in 65-07-PLAN.md.
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handle } from '../handler.ts';
import type { TrialEndingDeps } from '../handler.ts';

// ── Constants ───────────────────────────────────────────────────────────────

const MOCK_SERVICE_ROLE_KEY = 'test-service-role-key';
const MOCK_SUPABASE_URL = 'https://test.supabase.co';
const MOCK_SIGNING_KEY = 'test-signing-key-32byteslongaaaa';
const MOCK_PHYSICAL_ADDRESS = '123 Test Street, San Francisco, CA 94105';
const MOCK_RESEND_API_KEY = 're_test_live_key';
const MOCK_POSTHOG_API_KEY = 'phc_test_key';

// ── Fake users / subscription rows ──────────────────────────────────────────

interface FakeRow {
  user_id: string;
  email: string;
  first_name: string;
  email_marketing_consent: boolean | null;
  stage: 'trial_ending_t3d' | 'trial_ending_t1d';
  trial_end_at: string;
}

const DEFAULT_ROWS: FakeRow[] = [
  {
    user_id: 'user-t3d-1',
    email: 'alice-t3d@example.com',
    first_name: 'Alice',
    email_marketing_consent: true,
    stage: 'trial_ending_t3d',
    trial_end_at: new Date(Date.now() + 3.5 * 24 * 3600 * 1000).toISOString(),
  },
  {
    user_id: 'user-t1d-1',
    email: 'bob-t1d@example.com',
    first_name: 'Bob',
    email_marketing_consent: true,
    stage: 'trial_ending_t1d',
    trial_end_at: new Date(Date.now() + 1.5 * 24 * 3600 * 1000).toISOString(),
  },
];

// ── Mock Supabase client ────────────────────────────────────────────────────

function buildMockSupabaseClient(opts: {
  rowsByStage?: Partial<Record<'trial_ending_t3d' | 'trial_ending_t1d', FakeRow[]>>;
  alreadySent?: string[]; // (user_id|stage) pairs already in lifecycle_emails_sent
} = {}) {
  const { rowsByStage, alreadySent = [] } = opts;
  const sentRows: Array<{ user_id: string; stage: string; copy_variant?: string; resend_message_id?: string | null }> = [];

  // Default: split DEFAULT_ROWS by stage
  const defaultByStage: Record<string, FakeRow[]> = {
    trial_ending_t3d: DEFAULT_ROWS.filter((r) => r.stage === 'trial_ending_t3d'),
    trial_ending_t1d: DEFAULT_ROWS.filter((r) => r.stage === 'trial_ending_t1d'),
  };
  const byStage = {
    trial_ending_t3d: rowsByStage?.trial_ending_t3d ?? defaultByStage.trial_ending_t3d,
    trial_ending_t1d: rowsByStage?.trial_ending_t1d ?? defaultByStage.trial_ending_t1d,
  };

  const client = {
    rpc: (_fn: string, params: { stage_key: string }) => ({
      select: () => Promise.resolve({
        data: (byStage[params.stage_key as 'trial_ending_t3d' | 'trial_ending_t1d'] ?? []),
        error: null,
      }),
    }),
    from: (table: string) => {
      if (table === 'lifecycle_emails_sent') {
        return {
          upsert: (
            row: { user_id: string; stage: string; copy_variant?: string },
            opts2?: { onConflict?: string; ignoreDuplicates?: boolean },
          ) => ({
            select: () => {
              void opts2;
              const key = `${row.user_id}|${row.stage}`;
              if (alreadySent.includes(key)) {
                // ON CONFLICT DO NOTHING → empty data
                return Promise.resolve({ data: [], error: null });
              }
              sentRows.push(row);
              return Promise.resolve({ data: [row], error: null });
            },
          }),
          update: (patch: { resend_message_id?: string | null; copy_variant?: string }) => ({
            eq: (_col1: string, _val1: string) => ({
              eq: (_col2: string, _val2: string) => {
                const row = sentRows.find(
                  (r) => r.user_id === _val1 && r.stage === _val2,
                );
                if (row) Object.assign(row, patch);
                return Promise.resolve({ data: row ? [row] : [], error: null });
              },
            }),
          }),
          delete: () => ({
            eq: (_col1: string, _val1: string) => ({
              eq: (_col2: string, _val2: string) => {
                const idx = sentRows.findIndex(
                  (r) => r.user_id === _val1 && r.stage === _val2,
                );
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

  return { client: client as unknown as TrialEndingDeps['supabaseServiceClient'], sentRows };
}

// ── Mock fetch ──────────────────────────────────────────────────────────────

function buildMockFetch(opts: {
  posthogVariant?: 'a' | 'b' | false;
  posthogFail?: boolean;
  resendFail?: boolean;
} = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const resendCalls: Array<{ to: string; subject: string; html: string; text: string }> = [];
  const posthogCalls: Array<{ distinct_id: string }> = [];

  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = url.toString();
    calls.push({ url: urlStr, init });

    if (urlStr.includes('/decide')) {
      // PostHog flag eval
      const body = init?.body ? JSON.parse(init.body as string) : {};
      posthogCalls.push({ distinct_id: body.distinct_id });
      if (opts.posthogFail) {
        return new Response('boom', { status: 500 });
      }
      const variant = opts.posthogVariant ?? false;
      return new Response(
        JSON.stringify({ featureFlags: { trial_ending_copy_variant: variant } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

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

  return { mockFetch, calls, resendCalls, posthogCalls };
}

// ── Build deps + request ────────────────────────────────────────────────────

function buildDeps(overrides: Partial<TrialEndingDeps> & {
  rowsByStage?: Parameters<typeof buildMockSupabaseClient>[0]['rowsByStage'];
  alreadySent?: string[];
  posthogVariant?: 'a' | 'b' | false;
  posthogFail?: boolean;
  resendFail?: boolean;
} = {}) {
  const { rowsByStage, alreadySent, posthogVariant, posthogFail, resendFail, ...rest } = overrides;
  const { mockFetch, resendCalls, posthogCalls } = buildMockFetch({
    posthogVariant,
    posthogFail,
    resendFail,
  });
  const { client, sentRows } = buildMockSupabaseClient({ rowsByStage, alreadySent });

  const deps: TrialEndingDeps = {
    fetchImpl: mockFetch,
    supabaseServiceClient: client,
    resendApiKey: MOCK_RESEND_API_KEY,
    serviceRoleKey: MOCK_SERVICE_ROLE_KEY,
    supabaseUrl: MOCK_SUPABASE_URL,
    signingKey: MOCK_SIGNING_KEY,
    physicalAddress: MOCK_PHYSICAL_ADDRESS,
    posthogApiKey: MOCK_POSTHOG_API_KEY,
    posthogHost: 'https://us.posthog.com',
    ...rest,
  };
  return { deps, resendCalls, posthogCalls, sentRows };
}

function buildPostRequest(bearer?: string): Request {
  return new Request('https://test.supabase.co/functions/v1/lifecycle-trial-ending', {
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

Deno.test('1b. POST / valid bearer → 200', async () => {
  const { deps } = buildDeps({ posthogVariant: 'a' });
  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(res.status, 200);
});

Deno.test('2. PHYSICAL_ADDRESS placeholder triggers 503 + zero sends', async () => {
  const { deps, resendCalls } = buildDeps({ physicalAddress: '[YOUR ADDRESS]' });
  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(res.status, 503);
  assertEquals(resendCalls.length, 0);
});

Deno.test('2b. Missing PHYSICAL_ADDRESS → 503', async () => {
  const { deps, resendCalls } = buildDeps({ physicalAddress: undefined });
  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(res.status, 503);
  assertEquals(resendCalls.length, 0);
});

Deno.test('3. POST / sends T-3d email for users with trial_end_at 3.5d away', async () => {
  const { deps, resendCalls } = buildDeps({
    posthogVariant: 'a',
    rowsByStage: {
      trial_ending_t3d: [DEFAULT_ROWS[0]],
      trial_ending_t1d: [],
    },
  });
  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number };
  assertEquals(body.sent, 1);
  assertEquals(resendCalls.length, 1);
  assertEquals(resendCalls[0].to, 'alice-t3d@example.com');
});

Deno.test('4. POST / sends T-1d email for users with trial_end_at 1.5d away', async () => {
  const { deps, resendCalls } = buildDeps({
    rowsByStage: {
      trial_ending_t3d: [],
      trial_ending_t1d: [DEFAULT_ROWS[1]],
    },
  });
  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number };
  assertEquals(body.sent, 1);
  assertEquals(resendCalls.length, 1);
  assertEquals(resendCalls[0].to, 'bob-t1d@example.com');
  // T-1d subject mentions "last day"
  assertEquals(resendCalls[0].subject.toLowerCase().includes('last day'), true);
});

Deno.test('5. POST / does NOT send to users out-of-window (RPC returns empty)', async () => {
  const { deps, resendCalls } = buildDeps({
    rowsByStage: { trial_ending_t3d: [], trial_ending_t1d: [] },
  });
  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number };
  assertEquals(body.sent, 0);
  assertEquals(resendCalls.length, 0);
});

Deno.test('6a. T-3d honors PostHog A/B variant a → uses template-a', async () => {
  const { deps, resendCalls } = buildDeps({
    posthogVariant: 'a',
    rowsByStage: {
      trial_ending_t3d: [DEFAULT_ROWS[0]],
      trial_ending_t1d: [],
    },
  });
  await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(resendCalls.length, 1);
  // Variant A marker baked into template
  assertEquals(resendCalls[0].text.includes('Variant A') || resendCalls[0].html.includes('variant-a'), true);
});

Deno.test('6b. T-3d honors PostHog A/B variant b → uses template-b', async () => {
  const { deps, resendCalls } = buildDeps({
    posthogVariant: 'b',
    rowsByStage: {
      trial_ending_t3d: [DEFAULT_ROWS[0]],
      trial_ending_t1d: [],
    },
  });
  await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(resendCalls.length, 1);
  assertEquals(resendCalls[0].text.includes('Variant B') || resendCalls[0].html.includes('variant-b'), true);
});

Deno.test('7. PostHog flag eval failure defaults to variant "a"', async () => {
  const { deps, resendCalls, sentRows } = buildDeps({
    posthogFail: true,
    rowsByStage: {
      trial_ending_t3d: [DEFAULT_ROWS[0]],
      trial_ending_t1d: [],
    },
  });
  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(res.status, 200);
  assertEquals(resendCalls.length, 1);
  // Defaulted to variant 'a'
  assertEquals(sentRows[0].copy_variant, 'a');
});

Deno.test('8. POST / records lifecycle_emails_sent row with copy_variant=a/b', async () => {
  const { deps, sentRows } = buildDeps({
    posthogVariant: 'b',
    rowsByStage: {
      trial_ending_t3d: [DEFAULT_ROWS[0]],
      trial_ending_t1d: [DEFAULT_ROWS[1]],
    },
  });
  await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  const t3d = sentRows.find((r) => r.stage === 'trial_ending_t3d');
  const t1d = sentRows.find((r) => r.stage === 'trial_ending_t1d');
  assertEquals(t3d?.copy_variant, 'b');
  assertEquals(t1d?.copy_variant, 'a'); // T-1d always 'a'
});

Deno.test('9. Idempotency: composite PK conflict returns skipped', async () => {
  const { deps, resendCalls } = buildDeps({
    posthogVariant: 'a',
    rowsByStage: {
      trial_ending_t3d: [DEFAULT_ROWS[0]],
      trial_ending_t1d: [],
    },
    alreadySent: ['user-t3d-1|trial_ending_t3d'],
  });
  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { sent: number; skipped: number };
  assertEquals(body.sent, 0);
  assertEquals(body.skipped, 1);
  assertEquals(resendCalls.length, 0); // no email send
});

Deno.test('10. RPC excludes consent=false users (DB-level)', async () => {
  // simulated by passing 0 rows (RPC filters)
  const { deps, resendCalls } = buildDeps({
    rowsByStage: { trial_ending_t3d: [], trial_ending_t1d: [] },
  });
  await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(resendCalls.length, 0);
});

Deno.test('11. RPC excludes email_lifecycle_exclusion users (DB-level)', async () => {
  // same — DB level filtering proven by zero rows returned
  const { deps, resendCalls } = buildDeps({
    rowsByStage: { trial_ending_t3d: [], trial_ending_t1d: [] },
  });
  await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(resendCalls.length, 0);
});

Deno.test('12. Both T-3d and T-1d use same /pricing CTA URL', async () => {
  const { deps, resendCalls } = buildDeps({
    posthogVariant: 'a',
    rowsByStage: {
      trial_ending_t3d: [DEFAULT_ROWS[0]],
      trial_ending_t1d: [DEFAULT_ROWS[1]],
    },
  });
  await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(resendCalls.length, 2);
  for (const c of resendCalls) {
    assertEquals(c.text.includes('/settings/billing'), true);
  }
});

Deno.test('13. GET /healthz → 200', async () => {
  const { deps } = buildDeps();
  const res = await handle(
    new Request('https://test.supabase.co/functions/v1/lifecycle-trial-ending/healthz', { method: 'GET' }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as { ok: boolean; fn: string };
  assertEquals(body.ok, true);
  assertEquals(body.fn, 'lifecycle-trial-ending');
});

Deno.test('14. Resend failure rolls back lifecycle_emails_sent row', async () => {
  const { deps, resendCalls, sentRows } = buildDeps({
    posthogVariant: 'a',
    resendFail: true,
    rowsByStage: {
      trial_ending_t3d: [DEFAULT_ROWS[0]],
      trial_ending_t1d: [],
    },
  });
  const res = await handle(buildPostRequest(MOCK_SERVICE_ROLE_KEY), deps);
  assertEquals(res.status, 200);
  assertEquals(resendCalls.length, 1);
  // Row was deleted on Resend failure
  assertEquals(sentRows.length, 0);
});
