/**
 * Phase 19 Plan 19-06a — Affiliate data API unit tests.
 *
 * 5 assertions covering:
 *   T1: fetchAffiliateStats returns zero for affiliate with no data
 *   T2: fetchAffiliateStats correctly windows 30d / prev 30d
 *   T3: fetchRecentConversions returns ≤ limit rows ordered DESC
 *   T4: fetchDailyTrend fills 30 days even when data has gaps
 *   T5: fetchAffiliateProfile returns null when user has no affiliate row
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAffiliateProfile,
  fetchAffiliateStats,
  fetchDailyTrend,
  fetchRecentConversions,
} from '@/lib/affiliate/api';

type QueryCall = {
  table: string;
  selectArgs: unknown[];
  filters: Record<string, unknown>;
  inArgs?: [string, unknown[]];
  orderArgs?: [string, unknown];
  limit?: number;
  isHead: boolean;
};

interface MockResult {
  data?: unknown[] | unknown;
  error?: unknown;
  count?: number;
}

function makeSupabaseMock(): {
  client: SupabaseClient;
  calls: QueryCall[];
  setNextResult: (table: string, isHead: boolean | null, result: MockResult) => void;
  setDefaultResult: (table: string, result: MockResult) => void;
} {
  const calls: QueryCall[] = [];
  // (table, isHeadString) -> queue of results; key 'any' applies to any head flag
  const resultsByKey = new Map<string, MockResult[]>();
  const defaultByTable = new Map<string, MockResult>();

  function popResult(table: string, isHead: boolean): MockResult {
    const specific = resultsByKey.get(`${table}|${String(isHead)}`);
    if (specific && specific.length) return specific.shift()!;
    const any = resultsByKey.get(`${table}|any`);
    if (any && any.length) return any.shift()!;
    return defaultByTable.get(table) ?? { data: [], error: null, count: 0 };
  }

  function makeBuilder(table: string): unknown {
    const call: QueryCall = {
      table,
      selectArgs: [],
      filters: {},
      isHead: false,
    };
    const finalize = (): Promise<MockResult> => {
      calls.push(call);
      const r = popResult(table, call.isHead);
      return Promise.resolve(r);
    };
    const chain: Record<string, unknown> = {
      select: vi.fn((cols: string, opts?: { count?: string; head?: boolean }) => {
        call.selectArgs.push(cols, opts);
        if (opts?.head) call.isHead = true;
        return chain;
      }),
      eq: vi.fn((col: string, val: unknown) => {
        call.filters[`eq:${col}`] = val;
        return chain;
      }),
      gte: vi.fn((col: string, val: unknown) => {
        call.filters[`gte:${col}`] = val;
        return chain;
      }),
      lt: vi.fn((col: string, val: unknown) => {
        call.filters[`lt:${col}`] = val;
        return chain;
      }),
      in: vi.fn((col: string, vals: unknown[]) => {
        call.inArgs = [col, vals];
        return chain;
      }),
      order: vi.fn((col: string, opts: unknown) => {
        call.orderArgs = [col, opts];
        return chain;
      }),
      limit: vi.fn((n: number) => {
        call.limit = n;
        return chain;
      }),
      maybeSingle: vi.fn(() => finalize()),
      then(resolve: (v: MockResult) => unknown, reject?: (e: unknown) => unknown) {
        return finalize().then(resolve, reject);
      },
    };
    return chain;
  }

  const client = {
    from: vi.fn((table: string) => makeBuilder(table)),
  } as unknown as SupabaseClient;

  return {
    client,
    calls,
    setNextResult: (table, isHead, result) => {
      const key = `${table}|${isHead === null ? 'any' : String(isHead)}`;
      const arr = resultsByKey.get(key) ?? [];
      arr.push(result);
      resultsByKey.set(key, arr);
    },
    setDefaultResult: (table, result) => defaultByTable.set(table, result),
  };
}

const AFF_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

describe('affiliate/api', () => {
  let nowSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // Pin "now" to 2026-05-15T12:00:00Z so date-bucket assertions are stable.
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-15T12:00:00Z').getTime());
  });
  afterEach(() => {
    nowSpy.mockRestore();
  });

  // ── T1 ────────────────────────────────────────────────────────────────────
  it('T1 — fetchAffiliateStats returns zeros for affiliate with no data', async () => {
    const mock = makeSupabaseMock();
    mock.setDefaultResult('affiliate_clicks', { data: [], error: null, count: 0 });
    mock.setDefaultResult('affiliate_conversions', { data: [], error: null, count: 0 });

    const stats = await fetchAffiliateStats(AFF_ID, mock.client);

    expect(stats).toEqual({
      clicks30d: 0,
      clicksPrev30d: 0,
      conversions30d: 0,
      conversionsPrev30d: 0,
      commissionsCents30d: 0,
      commissionsCentsPrev30d: 0,
      pendingPayoutCents: 0,
    });
  });

  // ── T2 ────────────────────────────────────────────────────────────────────
  it('T2 — fetchAffiliateStats windows 30d / prev 30d separately', async () => {
    const mock = makeSupabaseMock();

    // Two clicks-count queries (head=true): current=10, prev=4
    mock.setNextResult('affiliate_clicks', true, { count: 10, data: null, error: null });
    mock.setNextResult('affiliate_clicks', true, { count: 4, data: null, error: null });

    // Two conversions row queries (head=false): current 3 rows commission_cents 1000+1500+2000
    mock.setNextResult('affiliate_conversions', false, {
      data: [
        { commission_cents: 1000, status: 'confirmed' },
        { commission_cents: 1500, status: 'pending' },
        { commission_cents: 2000, status: 'confirmed' },
      ],
      error: null,
    });
    // prev 30d conversions: 1 row
    mock.setNextResult('affiliate_conversions', false, {
      data: [{ commission_cents: 500, status: 'paid' }],
      error: null,
    });
    // Pending payout (3rd conversion query): SUM where status IN ('pending','confirmed')
    mock.setNextResult('affiliate_conversions', false, {
      data: [{ commission_cents: 1000 }, { commission_cents: 1500 }, { commission_cents: 2000 }],
      error: null,
    });

    const stats = await fetchAffiliateStats(AFF_ID, mock.client);

    expect(stats.clicks30d).toBe(10);
    expect(stats.clicksPrev30d).toBe(4);
    expect(stats.conversions30d).toBe(3);
    expect(stats.conversionsPrev30d).toBe(1);
    expect(stats.commissionsCents30d).toBe(4500);
    expect(stats.commissionsCentsPrev30d).toBe(500);
    expect(stats.pendingPayoutCents).toBe(4500);

    // Verify the windowing — current window is now..now-30d, prev is now-30d..now-60d.
    const clickCalls = mock.calls.filter((c) => c.table === 'affiliate_clicks');
    expect(clickCalls).toHaveLength(2);
    // First call has gte ~ now-30d
    const cur = clickCalls[0];
    const prev = clickCalls[1];
    expect(typeof cur.filters['gte:created_at']).toBe('string');
    expect(typeof prev.filters['gte:created_at']).toBe('string');
    // The prev's gte must be earlier than cur's gte.
    expect(
      new Date(prev.filters['gte:created_at'] as string).getTime(),
    ).toBeLessThan(new Date(cur.filters['gte:created_at'] as string).getTime());
    // Pending-payout call should use .in('status', ['pending','confirmed'])
    const pendingCall = mock.calls.find(
      (c) => c.table === 'affiliate_conversions' && c.inArgs,
    );
    expect(pendingCall?.inArgs).toEqual(['status', ['pending', 'confirmed']]);
  });

  // ── T3 ────────────────────────────────────────────────────────────────────
  it('T3 — fetchRecentConversions returns ≤ limit rows ordered DESC by created_at', async () => {
    const mock = makeSupabaseMock();
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `c-${i}`,
      created_at: `2026-05-${15 - i}T00:00:00Z`,
      status: 'pending' as const,
      commission_cents: 100 * (i + 1),
      subscription_id: `sub_${i}`,
    }));
    mock.setNextResult('affiliate_conversions', false, { data: rows, error: null });

    const out = await fetchRecentConversions(AFF_ID, mock.client, 5);

    expect(out).toHaveLength(5);
    expect(out[0].id).toBe('c-0');
    const call = mock.calls[0];
    expect(call.orderArgs?.[0]).toBe('created_at');
    expect(call.orderArgs?.[1]).toEqual({ ascending: false });
    expect(call.limit).toBe(5);
    expect(call.filters['eq:affiliate_id']).toBe(AFF_ID);
  });

  // ── T4 ────────────────────────────────────────────────────────────────────
  it('T4 — fetchDailyTrend fills 30 days even when data has gaps', async () => {
    const mock = makeSupabaseMock();
    // Two clicks both on the same day (today, UTC = 2026-05-15)
    mock.setNextResult('affiliate_clicks', false, {
      data: [
        { created_at: '2026-05-15T10:00:00Z' },
        { created_at: '2026-05-15T11:00:00Z' },
      ],
      error: null,
    });
    // One conversion 10 days ago (2026-05-05)
    mock.setNextResult('affiliate_conversions', false, {
      data: [{ created_at: '2026-05-05T08:00:00Z' }],
      error: null,
    });

    const trend = await fetchDailyTrend(AFF_ID, mock.client);

    expect(trend).toHaveLength(30);
    // Must be sorted ascending and end on today
    expect(trend[29].date).toBe('2026-05-15');
    expect(trend[29].clicks).toBe(2);
    expect(trend[29].conversions).toBe(0);
    // 2026-05-05 is 10 days before today; index 29-10=19
    expect(trend[19].date).toBe('2026-05-05');
    expect(trend[19].conversions).toBe(1);
    // A random gap day should be zero-filled
    expect(trend[0].date).toBe('2026-04-16');
    expect(trend[0]).toEqual({ date: '2026-04-16', clicks: 0, conversions: 0 });
  });

  // ── T5 ────────────────────────────────────────────────────────────────────
  it('T5 — fetchAffiliateProfile returns null when user has no affiliate row', async () => {
    const mock = makeSupabaseMock();
    mock.setNextResult('affiliates', false, { data: null, error: null });

    const profile = await fetchAffiliateProfile(USER_ID, mock.client);
    expect(profile).toBeNull();

    // And returns the row shape when present.
    const mock2 = makeSupabaseMock();
    mock2.setNextResult('affiliates', false, {
      data: {
        id: AFF_ID,
        display_name: 'Alice',
        referral_code: 'alice-xyz',
        status: 'approved',
        stripe_payouts_enabled: true,
      },
      error: null,
    });
    const profile2 = await fetchAffiliateProfile(USER_ID, mock2.client);
    expect(profile2).toEqual({
      id: AFF_ID,
      display_name: 'Alice',
      referral_code: 'alice-xyz',
      status: 'approved',
      stripe_payouts_enabled: true,
    });
  });
});
