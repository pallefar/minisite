/**
 * Deno unit tests for the `affiliate-attribute` Edge Function.
 *
 * Filename: `.test.ts` (NOT `-test.ts`) per LeanShot memory
 * `reference_deno_test_discovery.md` — Deno's directory-walk glob
 * `{*_,*.,}test.*` picks up `.test.ts` but skips `-test.ts`.
 *
 * Strategy: inject a hand-rolled fake admin client via `__setAdminForTest`
 * (the same DI seam stripe-checkout uses). The fake mirrors the surface
 * the handler touches: `from(...).select(...).eq(...).maybeSingle()`,
 * `from(...).select(...,{count}).eq(...).gt(...)`, `from(...).insert(...)`.
 *
 * Behaviors covered (6 tests per Plan 19-02 Task 2 done criteria):
 *   1. Invalid code (fails regex)         → 404, no Set-Cookie, no DB.
 *   2. Pending affiliate (D-25)           → 404, no Set-Cookie.
 *   3. Approved + valid referer (happy)   → 302 + ONE Set-Cookie, click row.
 *   4. Approved + missing Referer + non-mobile UA
 *                                         → 302 NO Set-Cookie, click row flagged.
 *   5. Approved + missing Referer + mobile-app UA (LeanShot/...)
 *                                         → 302 + Set-Cookie (D-28 exemption).
 *   6. Cold-start affiliate at 500/day cap → flagged=cold_start_cap, NO Set-Cookie.
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import { getSetCookies } from 'jsr:@std/http/cookie';

// Seed env BEFORE importing the handler so module-level admin client
// construction does not throw (we DI-replace the client below anyway).
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const { handle, __setAdminForTest, __resetAdminForTest } = await import('./index.ts');

// ─── Fake admin client builder ──────────────────────────────────────────────

interface AffiliateFixture {
  id: string;
  status: string;
  allowed_referer_hosts: string[] | null;
  created_at: string;
}

interface BaselineFixture {
  mean_clicks: number | null;
  stddev_clicks: number | null;
  days_observed: number | null;
}

interface FakeAdminOptions {
  affiliate: AffiliateFixture | null;
  affiliateErr?: { message: string } | null;
  clickCount?: number;
  clickCountErr?: { message: string } | null;
  clickInsertErr?: { message: string } | null;
  // Phase 19 Plan 19-07 — Z-score additions.
  baseline?: BaselineFixture | null;
  baselineErr?: { message: string } | null;
  todayCount?: number;
  todayCountErr?: { message: string } | null;
  // Phase 26 Plan 26-02 — Ratio Z-score additions (D-10 extends, does not replace).
  ratioImpressionsToday?: number;        // affiliate_impressions count today
  ratioClicksToday?: number;             // affiliate_clicks count today (used by ratio numerator)
  ratioZScore?: number | null;           // RPC compute_affiliate_ratio_z_score return value
  ratioSignalInsertErr?: { message: string } | null;
}

interface FraudSignalCapture {
  affiliate_id: string;
  signal_type: string;
  // deno-lint-ignore no-explicit-any
  payload: any;
}

interface ClickInsertCapture {
  affiliate_id: string;
  referral_code: string;
  ip: string | null;
  user_agent: string | null;
  referer: string | null;
  fingerprint: string | null;
  flagged: boolean;
  flag_reason: string | null;
}

interface FakeAdmin {
  inserted: ClickInsertCapture[];
  fraudSignalsInserted: FraudSignalCapture[];
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
}

function buildFakeAdmin(opts: FakeAdminOptions): FakeAdmin {
  const inserted: ClickInsertCapture[] = [];
  const fraudSignalsInserted: FraudSignalCapture[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const fake: FakeAdmin = {
    inserted,
    fraudSignalsInserted,
    rpcCalls,
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      if (fn === 'compute_affiliate_ratio_z_score') {
        return Promise.resolve({ data: opts.ratioZScore ?? null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      if (table === 'affiliates') {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: string) {
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: opts.affiliate,
                      error: opts.affiliateErr ?? null,
                    });
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'affiliate_clicks') {
        return {
          // SELECT path — { count: 'exact', head: true } for cold-start cap
          // (with .gt()) OR today's-count (Z-score path, .gt()) OR ratio
          // numerator (Plan 26-02, .gte() at start-of-day).
          select(_cols: string, _options?: unknown) {
            return {
              eq(_col: string, _val: string) {
                const gtResolve = () => {
                  const useToday = opts.todayCount !== undefined || opts.todayCountErr !== undefined;
                  return Promise.resolve({
                    data: null,
                    count: useToday ? (opts.todayCount ?? 0) : (opts.clickCount ?? 0),
                    error: useToday ? (opts.todayCountErr ?? null) : (opts.clickCountErr ?? null),
                  });
                };
                const gteResolve = () => Promise.resolve({
                  data: null,
                  count: opts.ratioClicksToday ?? 0,
                  error: null,
                });
                return {
                  gt(_col2: string, _val2: string) { return gtResolve(); },
                  gte(_col2: string, _val2: string) { return gteResolve(); },
                };
              },
            };
          },
          // INSERT path.
          insert(row: ClickInsertCapture) {
            inserted.push(row);
            return Promise.resolve({ data: null, error: opts.clickInsertErr ?? null });
          },
        };
      }
      if (table === 'affiliate_impressions') {
        // Phase 26 Plan 26-02 — ratio denominator.
        return {
          select(_cols: string, _options?: unknown) {
            return {
              eq(_col: string, _val: string) {
                return {
                  gte(_col2: string, _val2: string) {
                    return Promise.resolve({
                      data: null,
                      count: opts.ratioImpressionsToday ?? 0,
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'affiliate_fraud_signals') {
        // Phase 26 Plan 26-02 — anomaly_z_score signal writer.
        return {
          insert(row: FraudSignalCapture) {
            fraudSignalsInserted.push(row);
            return Promise.resolve({ data: null, error: opts.ratioSignalInsertErr ?? null });
          },
        };
      }
      if (table === 'affiliate_click_baseline') {
        // Phase 19 Plan 19-07 — baseline matview lookup for Z-score check.
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: string) {
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: opts.baseline ?? null,
                      error: opts.baselineErr ?? null,
                    });
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return fake;
}

function buildRequest(opts: {
  code: string;
  referer?: string | null;
  userAgent?: string | null;
  xff?: string | null;
  fingerprint?: string | null;
  fingerprintQuery?: string | null;
}): Request {
  const headers = new Headers();
  if (opts.referer !== undefined && opts.referer !== null) headers.set('Referer', opts.referer);
  if (opts.userAgent !== undefined && opts.userAgent !== null) headers.set('User-Agent', opts.userAgent);
  if (opts.xff !== undefined && opts.xff !== null) headers.set('x-forwarded-for', opts.xff);
  if (opts.fingerprint !== undefined && opts.fingerprint !== null) {
    headers.set('X-LeanShot-Fingerprint', opts.fingerprint);
  }
  const fpQs = opts.fingerprintQuery !== undefined && opts.fingerprintQuery !== null
    ? `&fp=${encodeURIComponent(opts.fingerprintQuery)}`
    : '';
  return new Request(
    `https://leanshot.app/functions/v1/affiliate-attribute?code=${encodeURIComponent(opts.code)}${fpQs}`,
    { method: 'GET', headers },
  );
}

function countSetCookies(res: Response): number {
  return getSetCookies(res.headers).length;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

Deno.test('1. invalid code regex → 404, no Set-Cookie, no DB hit', async () => {
  const fake = buildFakeAdmin({ affiliate: null });
  __setAdminForTest(fake);
  try {
    const res = await handle(buildRequest({ code: 'BAD CODE!' }));
    assertEquals(res.status, 404);
    assertEquals(countSetCookies(res), 0);
    assertEquals(fake.inserted.length, 0, 'no DB INSERT on invalid code');
  } finally {
    __resetAdminForTest();
  }
});

Deno.test('2. pending affiliate (D-25) → 404, no Set-Cookie', async () => {
  const fake = buildFakeAdmin({
    affiliate: {
      id: 'aff-1',
      status: 'pending',
      allowed_referer_hosts: null,
      created_at: new Date().toISOString(),
    },
  });
  __setAdminForTest(fake);
  try {
    const res = await handle(buildRequest({ code: 'goodcode' }));
    assertEquals(res.status, 404);
    assertEquals(countSetCookies(res), 0);
    assertEquals(fake.inserted.length, 0, 'no click row for non-approved');
  } finally {
    __resetAdminForTest();
  }
});

Deno.test('3. approved + valid referer → 302 + exactly ONE Set-Cookie (W-6); click row flagged=false', async () => {
  const fake = buildFakeAdmin({
    affiliate: {
      id: 'aff-2',
      status: 'approved',
      allowed_referer_hosts: ['instagram.com'],
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30d old — not cold
    },
  });
  __setAdminForTest(fake);
  try {
    const res = await handle(buildRequest({
      code: 'goodcode',
      referer: 'https://www.instagram.com/some-user',
      xff: '1.2.3.4',
    }));
    assertEquals(res.status, 302);
    assertEquals(res.headers.get('Location'), '/r/goodcode/landing');

    // W-6: EXACTLY ONE Set-Cookie header (single-cookie invariant).
    const cookies = getSetCookies(res.headers);
    assertEquals(cookies.length, 1, 'W-6 single-cookie invariant');
    assertEquals(cookies[0].name, '_aff');
    assertEquals(cookies[0].value, 'goodcode');
    assertEquals(cookies[0].httpOnly, true);
    assertEquals(cookies[0].secure, true);
    assertEquals(cookies[0].sameSite, 'Lax');
    assertEquals(cookies[0].domain, '.leanshot.app');

    // Click row INSERTed with flagged=false.
    assertEquals(fake.inserted.length, 1);
    assertEquals(fake.inserted[0].affiliate_id, 'aff-2');
    assertEquals(fake.inserted[0].flagged, false);
    assertEquals(fake.inserted[0].flag_reason, null);
    assertEquals(fake.inserted[0].ip, '1.2.3.4');
  } finally {
    __resetAdminForTest();
  }
});

Deno.test('4. approved + missing Referer + non-mobile UA → 302 NO Set-Cookie + flagged=referer_mismatch', async () => {
  const fake = buildFakeAdmin({
    affiliate: {
      id: 'aff-3',
      status: 'approved',
      allowed_referer_hosts: ['instagram.com'],
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  __setAdminForTest(fake);
  try {
    const res = await handle(buildRequest({
      code: 'goodcode',
      // intentionally no referer
      userAgent: 'Mozilla/5.0 (Macintosh)',
    }));
    assertEquals(res.status, 302);
    assertEquals(countSetCookies(res), 0, 'flagged click MUST NOT Set-Cookie');
    assertEquals(fake.inserted.length, 1);
    assertEquals(fake.inserted[0].flagged, true);
    assertEquals(fake.inserted[0].flag_reason, 'referer_mismatch');
  } finally {
    __resetAdminForTest();
  }
});

Deno.test('5. approved + missing Referer + mobile-app UA → 302 + Set-Cookie (D-28 exemption)', async () => {
  const fake = buildFakeAdmin({
    affiliate: {
      id: 'aff-4',
      status: 'approved',
      allowed_referer_hosts: ['instagram.com'],
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  __setAdminForTest(fake);
  try {
    const res = await handle(buildRequest({
      code: 'goodcode',
      userAgent: 'LeanShot/1.2.0 (iOS 18.0; iPhone 16 Pro)',
    }));
    assertEquals(res.status, 302);
    assertEquals(countSetCookies(res), 1, 'mobile-app UA exempted from Referer check');
    assertEquals(fake.inserted.length, 1);
    assertEquals(fake.inserted[0].flagged, false);
  } finally {
    __resetAdminForTest();
  }
});

Deno.test('6. cold-start affiliate at 500/day cap → flagged=cold_start_cap + NO Set-Cookie', async () => {
  const fake = buildFakeAdmin({
    affiliate: {
      id: 'aff-5',
      status: 'approved',
      allowed_referer_hosts: [], // no referer restriction; cap is the gate
      created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2d old — cold
    },
    clickCount: 500, // exactly at the cap
  });
  __setAdminForTest(fake);
  try {
    const res = await handle(buildRequest({
      code: 'goodcode',
      referer: 'https://www.example.com',
    }));
    assertEquals(res.status, 302);
    assertEquals(countSetCookies(res), 0, 'over-cap click does not Set-Cookie');
    assertEquals(fake.inserted.length, 1);
    assertEquals(fake.inserted[0].flagged, true);
    assertEquals(fake.inserted[0].flag_reason, 'cold_start_cap');
  } finally {
    __resetAdminForTest();
  }
});

// ─── Phase 19 Plan 19-07 — Z-score + fingerprint additions ──────────────────

Deno.test('7. mature affiliate, today within baseline (z<3) → NOT flagged', async () => {
  const fake = buildFakeAdmin({
    affiliate: {
      id: 'aff-z1',
      status: 'approved',
      allowed_referer_hosts: [],
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30d — mature
    },
    baseline: { mean_clicks: 10, stddev_clicks: 2, days_observed: 10 },
    todayCount: 12, // z = (12-10)/2 = 1 < 3
  });
  __setAdminForTest(fake);
  try {
    const res = await handle(buildRequest({
      code: 'goodcode',
      referer: 'https://www.example.com',
    }));
    assertEquals(res.status, 302);
    assertEquals(countSetCookies(res), 1, 'within-baseline click sets cookie');
    assertEquals(fake.inserted.length, 1);
    assertEquals(fake.inserted[0].flagged, false);
    assertEquals(fake.inserted[0].flag_reason, null);
  } finally {
    __resetAdminForTest();
  }
});

Deno.test('8. mature affiliate, today ≥ mean + 3σ → flagged=z_score_3sigma + NO Set-Cookie', async () => {
  const fake = buildFakeAdmin({
    affiliate: {
      id: 'aff-z2',
      status: 'approved',
      allowed_referer_hosts: [],
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30d — mature
    },
    baseline: { mean_clicks: 10, stddev_clicks: 2, days_observed: 10 },
    todayCount: 20, // z = (20-10)/2 = 5 ≥ 3
  });
  __setAdminForTest(fake);
  try {
    const res = await handle(buildRequest({
      code: 'goodcode',
      referer: 'https://www.example.com',
    }));
    assertEquals(res.status, 302);
    assertEquals(countSetCookies(res), 0, 'z-score-flagged click does not set cookie');
    assertEquals(fake.inserted.length, 1);
    assertEquals(fake.inserted[0].flagged, true);
    assertEquals(fake.inserted[0].flag_reason, 'z_score_3sigma');
  } finally {
    __resetAdminForTest();
  }
});

Deno.test('9. baseline days_observed < 7 (cold-start window) → Z-score skipped; cold-start cap is sole gate', async () => {
  const fake = buildFakeAdmin({
    affiliate: {
      id: 'aff-z3',
      status: 'approved',
      allowed_referer_hosts: [],
      created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2d — cold-start
    },
    baseline: { mean_clicks: 10, stddev_clicks: 2, days_observed: 3 }, // would-flag if checked
    clickCount: 10, // cold-start under cap
  });
  __setAdminForTest(fake);
  try {
    const res = await handle(buildRequest({
      code: 'goodcode',
      referer: 'https://www.example.com',
    }));
    assertEquals(res.status, 302);
    // Affiliate is in cold-start window — Z-score branch is bypassed entirely.
    // Cold-start cap (10 clicks < 500) lets this through.
    assertEquals(countSetCookies(res), 1, 'cold-start affiliate skips Z-score; cap is sole gate');
    assertEquals(fake.inserted.length, 1);
    assertEquals(fake.inserted[0].flagged, false);
    assertEquals(fake.inserted[0].flag_reason, null);
  } finally {
    __resetAdminForTest();
  }
});

Deno.test('10. fingerprint header captured and persisted onto click row', async () => {
  const fake = buildFakeAdmin({
    affiliate: {
      id: 'aff-fp1',
      status: 'approved',
      allowed_referer_hosts: [],
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    baseline: { mean_clicks: 10, stddev_clicks: 2, days_observed: 10 },
    todayCount: 5,
  });
  __setAdminForTest(fake);
  try {
    const res = await handle(buildRequest({
      code: 'goodcode',
      referer: 'https://www.example.com',
      fingerprint: 'fp-thumbmark-abc12345',
    }));
    assertEquals(res.status, 302);
    assertEquals(fake.inserted.length, 1);
    assertEquals(fake.inserted[0].fingerprint, 'fp-thumbmark-abc12345');
  } finally {
    __resetAdminForTest();
  }
});

Deno.test('11. invalid fingerprint (regex reject) persists as null', async () => {
  const fake = buildFakeAdmin({
    affiliate: {
      id: 'aff-fp2',
      status: 'approved',
      allowed_referer_hosts: [],
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    baseline: { mean_clicks: 10, stddev_clicks: 2, days_observed: 10 },
    todayCount: 5,
  });
  __setAdminForTest(fake);
  try {
    const res = await handle(buildRequest({
      code: 'goodcode',
      referer: 'https://www.example.com',
      fingerprint: 'bad fp with spaces!', // fails FINGERPRINT_PATTERN
    }));
    assertEquals(res.status, 302);
    assertEquals(fake.inserted.length, 1);
    assertEquals(fake.inserted[0].fingerprint, null);
  } finally {
    __resetAdminForTest();
  }
});

// ─── Phase 26 Plan 26-02 — Ratio Z-score additions (D-10 extension) ─────────

Deno.test('R1. mature affiliate with cold-start ratio baseline (z=null) → does NOT write fraud_signals row', async () => {
  // RPC returns null (days_observed<7); ratio detector must no-op.
  const fake = buildFakeAdmin({
    affiliate: {
      id: 'aff-r1',
      status: 'approved',
      allowed_referer_hosts: [],
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    baseline: { mean_clicks: 10, stddev_clicks: 2, days_observed: 10 },
    todayCount: 12,
    ratioClicksToday: 5,
    ratioImpressionsToday: 50,
    ratioZScore: null, // cold-start on the ratio baseline
  });
  __setAdminForTest(fake);
  try {
    const res = await handle(buildRequest({
      code: 'goodcode',
      referer: 'https://www.example.com',
    }));
    assertEquals(res.status, 302);
    assertEquals(fake.inserted.length, 1);
    assertEquals(
      fake.fraudSignalsInserted.length,
      0,
      'cold-start ratio baseline → no fraud_signals row',
    );
  } finally {
    __resetAdminForTest();
  }
});

Deno.test('R2. mature affiliate with ratio z>3 → INSERTs exactly one anomaly_z_score fraud_signals row', async () => {
  const fake = buildFakeAdmin({
    affiliate: {
      id: 'aff-r2',
      status: 'approved',
      allowed_referer_hosts: [],
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    baseline: { mean_clicks: 10, stddev_clicks: 2, days_observed: 10 },
    todayCount: 5,
    ratioClicksToday: 30,
    ratioImpressionsToday: 100,
    ratioZScore: 5.4, // > 3 → flagged
  });
  __setAdminForTest(fake);
  try {
    const res = await handle(buildRequest({
      code: 'goodcode',
      referer: 'https://www.example.com',
    }));
    // D-09 default-trust — request still 302s; click row still INSERTs.
    assertEquals(res.status, 302);
    assertEquals(fake.fraudSignalsInserted.length, 1);
    const sig = fake.fraudSignalsInserted[0];
    assertEquals(sig.signal_type, 'anomaly_z_score');
    assertEquals(sig.affiliate_id, 'aff-r2');
    assertEquals(sig.payload.kind, 'anomaly_z_score');
    assertEquals(sig.payload.z_score, 5.4);
  } finally {
    __resetAdminForTest();
  }
});

Deno.test('R3. mature affiliate with ratio z within bounds (|z|<=3) → no fraud_signals row', async () => {
  const fake = buildFakeAdmin({
    affiliate: {
      id: 'aff-r3',
      status: 'approved',
      allowed_referer_hosts: [],
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    baseline: { mean_clicks: 10, stddev_clicks: 2, days_observed: 10 },
    todayCount: 8,
    ratioClicksToday: 5,
    ratioImpressionsToday: 100,
    ratioZScore: 1.2,
  });
  __setAdminForTest(fake);
  try {
    const res = await handle(buildRequest({
      code: 'goodcode',
      referer: 'https://www.example.com',
    }));
    assertEquals(res.status, 302);
    assertEquals(fake.fraudSignalsInserted.length, 0);
  } finally {
    __resetAdminForTest();
  }
});

Deno.test('R4. v1.2 AFF-08 raw-count Z-score block still present (D-10 extends, does not replace)', async () => {
  const src = await Deno.readTextFile(
    new URL('./index.ts', import.meta.url),
  );
  assert(
    src.includes('affiliate_click_baseline'),
    'v1.2 raw-count baseline matview lookup must remain in source',
  );
  assert(
    src.includes('z_score_3sigma'),
    'v1.2 z_score_3sigma flag_reason must remain in source',
  );
  assert(
    src.includes('compute_affiliate_ratio_z_score') || src.includes('affiliate_ratio_baseline'),
    'Phase 26 ratio detector hook must be installed',
  );
});

// ─── Defensive: referer helper sanity (not counted toward the 6) ────────────

Deno.test('referer.ts: empty allowlist → allow', async () => {
  const { isRefererAllowed } = await import('./referer.ts');
  assert(isRefererAllowed('https://anywhere.com', []));
  assert(isRefererAllowed(null, []));
});

Deno.test('referer.ts: www stripping', async () => {
  const { isRefererAllowed } = await import('./referer.ts');
  assert(isRefererAllowed('https://www.instagram.com/u', ['instagram.com']));
  assert(isRefererAllowed('https://instagram.com/u', ['www.instagram.com']));
});

Deno.test('referer.ts: malformed Referer → reject', async () => {
  const { isRefererAllowed } = await import('./referer.ts');
  assertEquals(isRefererAllowed('not-a-url', ['instagram.com']), false);
});
