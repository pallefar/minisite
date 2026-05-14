/**
 * Phase 14 Plan 14-09 — billing-sync.ts unit tests.
 *
 * 6 behavior cases per the plan's <behavior> block:
 *   1. active + future period_end → setTier called with tier='paid'
 *   2. past_due → setTier called with tier='past_due'
 *   3. canceled + past period_end → setTier called with tier='free'
 *   4. no row (data: null, error: null) → setTier called with tier='free', nulls
 *   5. query error → setTier NOT called; console.error called once; no throw
 *   6. syncBillingTier never rejects (all paths resolve)
 *
 * Deterministic timestamps: FUTURE is 2099-01-01 (well past any "now"),
 * PAST is 2000-01-01 (well before any "now"). getActiveTier's 'canceled'
 * branch compares against `new Date()` so we control PAST to guarantee the
 * canceled-elapsed path is taken.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockMaybeSingle = vi.fn();
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}));

const mockSetTier = vi.fn();
vi.mock('@/lib/store', () => ({
  useStore: {
    getState: () => ({
      setTier: mockSetTier,
    }),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FUTURE = '2099-01-01T00:00:00Z';
const PAST = '2000-01-01T00:00:00Z';
const USER_ID = 'user-test-123';

function mockQuery(data: Record<string, string | null> | null, error: { message: string } | null = null) {
  mockMaybeSingle.mockResolvedValueOnce({ data, error });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('syncBillingTier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('case 1: active row with future period_end → setTier called with tier=paid', async () => {
    mockQuery({
      status: 'active',
      current_period_end: FUTURE,
      plan_id: 'price_x',
      provider: 'stripe',
    });
    const { syncBillingTier } = await import('./billing-sync');

    await syncBillingTier(USER_ID);

    expect(mockSetTier).toHaveBeenCalledOnce();
    expect(mockSetTier).toHaveBeenCalledWith({
      tier: 'paid',
      current_period_end: FUTURE,
      plan_id: 'price_x',
      provider: 'stripe',
    });
  });

  it('case 2: past_due row → setTier called with tier=past_due', async () => {
    mockQuery({
      status: 'past_due',
      current_period_end: FUTURE,
      plan_id: 'price_y',
      provider: 'stripe',
    });
    const { syncBillingTier } = await import('./billing-sync');

    await syncBillingTier(USER_ID);

    expect(mockSetTier).toHaveBeenCalledOnce();
    expect(mockSetTier).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'past_due' }),
    );
  });

  it('case 3: canceled row with past period_end → setTier called with tier=free', async () => {
    mockQuery({
      status: 'canceled',
      current_period_end: PAST,
      plan_id: 'price_z',
      provider: 'stripe',
    });
    const { syncBillingTier } = await import('./billing-sync');

    await syncBillingTier(USER_ID);

    expect(mockSetTier).toHaveBeenCalledOnce();
    expect(mockSetTier).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'free' }),
    );
  });

  it('case 4: no row (data: null, error: null) → setTier called with tier=free and all nulls', async () => {
    mockQuery(null, null);
    const { syncBillingTier } = await import('./billing-sync');

    await syncBillingTier(USER_ID);

    expect(mockSetTier).toHaveBeenCalledOnce();
    expect(mockSetTier).toHaveBeenCalledWith({
      tier: 'free',
      current_period_end: null,
      plan_id: null,
      provider: null,
    });
  });

  it('case 5: query error → setTier NOT called, console.error called once, does not throw', async () => {
    mockQuery(null, { message: 'boom' });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { syncBillingTier } = await import('./billing-sync');

    await expect(syncBillingTier(USER_ID)).resolves.toBeUndefined();

    expect(mockSetTier).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[billing-sync] subscriptions query failed',
      'boom',
    );
  });

  it('case 6: syncBillingTier never rejects — all paths resolve', async () => {
    mockQuery(null, null);
    const { syncBillingTier } = await import('./billing-sync');

    await expect(syncBillingTier(USER_ID)).resolves.toBeUndefined();
  });
});
