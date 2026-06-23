/**
 * billing-sync.ts unit tests.
 *
 * syncBillingTier now reads the canonical `tier_effective` view (M1/M2) plus a
 * tolerant secondary `subscriptions` read for plan_id + pause state:
 *   1. has_active → tier='paid' (provider + period from the view, plan_id from sub)
 *   2. has_past_due (not active) → tier='past_due'
 *   3. no tier_effective row → tier='free', all nulls
 *   4. M2: lifetime (has_active, NO subscriptions row) → tier='paid'
 *   5. tier_effective error → setTier NOT called, console.error once, no throw
 *   6. never rejects
 *   7. M1: cross-provider (winning_provider='revenuecat') resolves without PGRST116
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockTeMaybeSingle = vi.fn();
const mockSubMaybeSingle = vi.fn();

// from('tier_effective') → select → eq → maybeSingle
// from('subscriptions')  → select → eq → order → limit → maybeSingle
const mockFrom = vi.fn((table: string) => {
  if (table === 'tier_effective') {
    return { select: () => ({ eq: () => ({ maybeSingle: mockTeMaybeSingle }) }) };
  }
  return {
    select: () => ({
      eq: () => ({
        order: () => ({ limit: () => ({ maybeSingle: mockSubMaybeSingle }) }),
      }),
    }),
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom },
}));

const mockSetTier = vi.fn();
const mockSetPauseState = vi.fn();
vi.mock('@/lib/store', () => ({
  useStore: {
    getState: () => ({
      setTier: mockSetTier,
      setPauseState: mockSetPauseState,
    }),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FUTURE = '2099-01-01T00:00:00Z';
const USER_ID = 'user-test-123';

function tierEffective(
  data: Record<string, unknown> | null,
  error: { message: string } | null = null,
) {
  mockTeMaybeSingle.mockResolvedValueOnce({ data, error });
}
function subRow(data: Record<string, unknown> | null) {
  mockSubMaybeSingle.mockResolvedValueOnce({ data, error: null });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('syncBillingTier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('case 1: has_active (stripe) → tier=paid with view period/provider + sub plan_id', async () => {
    tierEffective({
      has_active: true,
      has_past_due: false,
      effective_period_end: FUTURE,
      winning_provider: 'stripe',
    });
    subRow({ plan_id: 'price_x', is_paused: false, paused_until: null });
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

  it('case 2: has_past_due (not active) → tier=past_due', async () => {
    tierEffective({
      has_active: false,
      has_past_due: true,
      effective_period_end: FUTURE,
      winning_provider: 'stripe',
    });
    subRow({ plan_id: 'price_y', is_paused: false, paused_until: null });
    const { syncBillingTier } = await import('./billing-sync');

    await syncBillingTier(USER_ID);

    expect(mockSetTier).toHaveBeenCalledWith(expect.objectContaining({ tier: 'past_due' }));
  });

  it('case 3: no tier_effective row → tier=free, all nulls', async () => {
    tierEffective(null, null);
    subRow(null);
    const { syncBillingTier } = await import('./billing-sync');

    await syncBillingTier(USER_ID);

    expect(mockSetTier).toHaveBeenCalledWith({
      tier: 'free',
      current_period_end: null,
      plan_id: null,
      provider: null,
    });
  });

  it('case 4 (M2): lifetime — has_active, NO subscriptions row → tier=paid', async () => {
    // Lifetime row: has_active=true, NULL period, winning_provider='stripe', and
    // crucially NO subscriptions row (lifetime lives in lifetime_purchases only).
    tierEffective({
      has_active: true,
      has_past_due: false,
      effective_period_end: null,
      winning_provider: 'stripe',
    });
    subRow(null);
    const { syncBillingTier } = await import('./billing-sync');

    await syncBillingTier(USER_ID);

    expect(mockSetTier).toHaveBeenCalledWith({
      tier: 'paid',
      current_period_end: null,
      plan_id: null,
      provider: 'stripe',
    });
  });

  it('case 5: tier_effective query error → setTier NOT called, console.error once, no throw', async () => {
    tierEffective(null, { message: 'boom' });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { syncBillingTier } = await import('./billing-sync');

    await expect(syncBillingTier(USER_ID)).resolves.toBeUndefined();

    expect(mockSetTier).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalledWith('[billing-sync] tier_effective query failed', 'boom');
  });

  it('case 6: never rejects', async () => {
    tierEffective(null, null);
    subRow(null);
    const { syncBillingTier } = await import('./billing-sync');

    await expect(syncBillingTier(USER_ID)).resolves.toBeUndefined();
  });

  it('case 7 (M1): cross-provider (winning_provider=revenuecat) resolves without error', async () => {
    // The view collapses a user's >1 subscriptions rows to ONE grouped row, so the
    // tier decision never trips PGRST116; the sub read uses order+limit(1).
    tierEffective({
      has_active: true,
      has_past_due: false,
      effective_period_end: FUTURE,
      winning_provider: 'revenuecat',
    });
    subRow({ plan_id: 'app.leanshot.plus.yearly', is_paused: false, paused_until: null });
    const { syncBillingTier } = await import('./billing-sync');

    await expect(syncBillingTier(USER_ID)).resolves.toBeUndefined();
    expect(mockSetTier).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'paid', provider: 'revenuecat' }),
    );
  });
});
