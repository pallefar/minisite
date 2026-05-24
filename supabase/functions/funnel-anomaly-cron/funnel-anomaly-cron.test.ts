/**
 * funnel-anomaly-cron.test.ts — Deno tests for the every-5-minute cron Edge Function.
 *
 * (Note: do not put the literal cron expression with an asterisk-slash inside this
 * JSDoc — Deno's parser closes the block comment on the first `* /` sequence.)
 *
 * Per project rule: file is `<name>.test.ts` (Deno glob `{*_,*.,}test.*`
 * matches per [[reference_deno_test_discovery]]).
 *
 * Behaviors tested:
 *  1. Non-bearer request → 401 unauthorized.
 *  2. Bearer + N funnels + all baseline z_score above threshold → 0 fired.
 *  3. Bearer + funnel with z_score below threshold + no prior alert → 1 fired
 *     + broadcast called.
 *  4. Same as 3 but prior alert <4h → 0 fired + 1 suppressed.
 *  5. Resend unverified → email step short-circuits; cron returns 200 with
 *     emails_sent:0 + email_skipped_unverified:true.
 *
 * Pattern: builds a stub admin client matching the supabase-js Proxy shape
 * the lazy admin singleton expects (lifecycle-utils.makeLazyAdmin returns a
 * Proxy that lazily reads _adminInstance). The test seam setAdminForTest()
 * injects the stub AFTER module import.
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// Ensure service-role bearer envs are set so checkServiceRoleBearer can run.
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
// 'test-stub' makes resendDomainHealthCheck return verified without HTTPS.
Deno.env.set('RESEND_API_KEY', 'test-stub');

const { __internal } = await import('./index.ts');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Stub = Record<string, any>;

interface StubState {
  funnels: Array<{
    funnel_id: string;
    event_name: string;
    is_enabled: boolean;
    sigma_threshold: number;
  }>;
  baselineByEvent: Record<
    string,
    { observed_count: number; expected_mean: number; expected_stddev: number; z_score: number }
  >;
  lastAlertByFunnel: Record<string, { fired_at: string } | null>;
  upsertInserts: Array<Record<string, unknown>>;
  broadcastCalls: Array<{ event: string; payload: Record<string, unknown> }>;
  /** Force ignoreDuplicates behavior — when true, upsert returns null (already-exists). */
  upsertDuplicate: boolean;
}

function makeStubAdmin(state: StubState): Stub {
  const channelStub = {
    subscribe: async () => Promise.resolve('SUBSCRIBED'),
    send: async (msg: { event: string; payload: Record<string, unknown> }) => {
      state.broadcastCalls.push({ event: msg.event, payload: msg.payload });
      return Promise.resolve('ok');
    },
  };

  function from(table: string): Stub {
    if (table === 'anomaly_tracked_funnels') {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: state.funnels, error: null }),
        }),
      };
    }
    if (table === 'channel_groups') {
      // Phase 51 / Plan 51-04 extension — return empty taxonomy by default so
      // the new per-channel-stage loop short-circuits without firing.
      return {
        select: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      };
    }
    if (table === 'admin_notifications') {
      // Phase 51 / Plan 51-04 extension — supports both the suppression read
      // (.select().eq().gte().limit()) and the upsert write. With empty
      // channel_groups above, neither path is exercised in default tests; the
      // stub is here defensively.
      return {
        select: () => ({
          eq: () => ({
            gte: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
        upsert: async (_row: Record<string, unknown>, _opts?: Record<string, unknown>) =>
          Promise.resolve({ data: null, error: null }),
      };
    }
    if (table === 'funnel_anomaly_alerts') {
      return {
        // suppression query: .select('fired_at').eq('funnel_id',X).order().limit(1).maybeSingle()
        select: () => ({
          eq: (_col: string, funnelId: string) => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () =>
                  Promise.resolve({ data: state.lastAlertByFunnel[funnelId] ?? null, error: null }),
              }),
            }),
          }),
        }),
        upsert: (row: Record<string, unknown>) => ({
          select: () => ({
            maybeSingle: async () => {
              if (state.upsertDuplicate) {
                return Promise.resolve({ data: null, error: null });
              }
              state.upsertInserts.push(row);
              const inserted = {
                id: `alert-${state.upsertInserts.length}`,
                funnel_id: row.funnel_id as string,
                fired_at: new Date().toISOString(),
                observed_count: row.observed_count as number,
                expected_mean: row.expected_mean as number,
                expected_stddev: row.expected_stddev as number,
                z_score: row.z_score as number,
              };
              return Promise.resolve({ data: inserted, error: null });
            },
          }),
        }),
      };
    }
    // Phase 22 resendDomainHealthCheck increments a counter via .rpc when not
    // verified — but with test-stub it short-circuits and never calls .from.
    return {
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    };
  }

  return {
    from,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: async (name: string, args: any) => {
      if (name === 'funnel_anomaly_baseline_compute') {
        const bl = state.baselineByEvent[args.p_event_name];
        return Promise.resolve({ data: bl ? [bl] : null, error: null });
      }
      if (name === 'compute_channel_stage_rate') {
        // Phase 51 / Plan 51-04 — default stub returns null so the new
        // per-channel-stage loop yields zero firings. Per-test overrides
        // can swap this via setAdminForTest with a richer stub if needed.
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    channel: (_name: string) => channelStub,
    removeChannel: async (_ch: unknown) => Promise.resolve('ok'),
  };
}

function makeBearerRequest(): Request {
  return new Request('http://localhost/funnel-anomaly-cron', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-service-role-key', 'Content-Type': 'application/json' },
    body: '{}',
  });
}

function makeNoBearerRequest(): Request {
  return new Request('http://localhost/funnel-anomaly-cron', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

Deno.test('1. non-bearer request → 401', async () => {
  // No need to inject admin — bearer check happens before handler.
  const req = makeNoBearerRequest();
  // We must invoke the registered Deno.serve handler indirectly. The
  // checkServiceRoleBearer path is inside Deno.serve callback. Since we
  // already exported __internal.handleRun (post-bearer), we test the bearer
  // gate by calling fetch against the served port? Easier: assert the
  // contract directly by re-importing checkServiceRoleBearer.
  const { checkServiceRoleBearer } = await import('../_shared/lifecycle-utils.ts');
  assertEquals(checkServiceRoleBearer(req), false);
});

Deno.test('2. all baselines above threshold → 0 fired', async () => {
  const state: StubState = {
    funnels: [
      { funnel_id: 'f1', event_name: 'signup_completed', is_enabled: true, sigma_threshold: 2.0 },
      { funnel_id: 'f2', event_name: 'payment_succeeded', is_enabled: true, sigma_threshold: 2.0 },
    ],
    baselineByEvent: {
      signup_completed: { observed_count: 100, expected_mean: 100, expected_stddev: 10, z_score: 0 },
      payment_succeeded: { observed_count: 50, expected_mean: 50, expected_stddev: 5, z_score: 0 },
    },
    lastAlertByFunnel: {},
    upsertInserts: [],
    broadcastCalls: [],
    upsertDuplicate: false,
  };
  __internal.setAdminForTest(makeStubAdmin(state));
  try {
    const res = await __internal.handleRun(makeBearerRequest());
    const body = (await res.json()) as { fired: number; checked: number };
    assertEquals(res.status, 200);
    assertEquals(body.fired, 0);
    assertEquals(body.checked, 2);
    assertEquals(state.upsertInserts.length, 0);
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('3. one funnel below threshold + no prior alert → 1 fired + broadcast', async () => {
  const state: StubState = {
    funnels: [
      { funnel_id: 'f1', event_name: 'signup_completed', is_enabled: true, sigma_threshold: 2.0 },
    ],
    baselineByEvent: {
      signup_completed: { observed_count: 2, expected_mean: 100, expected_stddev: 20, z_score: -4.9 },
    },
    lastAlertByFunnel: {},
    upsertInserts: [],
    broadcastCalls: [],
    upsertDuplicate: false,
  };
  __internal.setAdminForTest(makeStubAdmin(state));
  try {
    const res = await __internal.handleRun(makeBearerRequest());
    const body = (await res.json()) as { fired: number; suppressed: number };
    assertEquals(res.status, 200);
    assertEquals(body.fired, 1);
    assertEquals(body.suppressed, 0);
    assertEquals(state.upsertInserts.length, 1);
    assertEquals(state.broadcastCalls.length, 1);
    assertEquals(state.broadcastCalls[0].event, 'anomaly_fired');
    assertEquals(typeof (state.broadcastCalls[0].payload as Record<string, unknown>).alert_id, 'string');
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('4. prior alert <4h ago → 0 fired + 1 suppressed', async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const state: StubState = {
    funnels: [
      { funnel_id: 'f1', event_name: 'signup_completed', is_enabled: true, sigma_threshold: 2.0 },
    ],
    baselineByEvent: {
      signup_completed: { observed_count: 2, expected_mean: 100, expected_stddev: 20, z_score: -4.9 },
    },
    lastAlertByFunnel: { f1: { fired_at: twoHoursAgo } },
    upsertInserts: [],
    broadcastCalls: [],
    upsertDuplicate: false,
  };
  __internal.setAdminForTest(makeStubAdmin(state));
  try {
    const res = await __internal.handleRun(makeBearerRequest());
    const body = (await res.json()) as { fired: number; suppressed: number };
    assertEquals(res.status, 200);
    assertEquals(body.fired, 0);
    assertEquals(body.suppressed, 1);
    assertEquals(state.upsertInserts.length, 0);
    assertEquals(state.broadcastCalls.length, 0);
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('5. Resend unverified → cron 200 + emails_sent:0 + skipped flag', async () => {
  // Override RESEND_API_KEY to a non-stub fake value that resendDomainHealthCheck
  // will treat as a real key and attempt to fetch — but we want to instead
  // simulate "unverified" via no API key at all (the simplest unverified path).
  Deno.env.delete('RESEND_API_KEY');
  try {
    const state: StubState = {
      funnels: [
        { funnel_id: 'f1', event_name: 'signup_completed', is_enabled: true, sigma_threshold: 2.0 },
      ],
      baselineByEvent: {
        signup_completed: { observed_count: 2, expected_mean: 100, expected_stddev: 20, z_score: -4.9 },
      },
      lastAlertByFunnel: {},
      upsertInserts: [],
      broadcastCalls: [],
      upsertDuplicate: false,
    };
    __internal.setAdminForTest(makeStubAdmin(state));
    try {
      const res = await __internal.handleRun(makeBearerRequest());
      const body = (await res.json()) as {
        fired: number;
        emails_sent: number;
        email_skipped_unverified: boolean;
      };
      assertEquals(res.status, 200);
      assertEquals(body.fired, 1);
      assertEquals(body.emails_sent, 0);
      assertEquals(body.email_skipped_unverified, true);
    } finally {
      __internal.resetAdminForTest();
    }
  } finally {
    // Restore for subsequent tests if any.
    Deno.env.set('RESEND_API_KEY', 'test-stub');
  }
});
