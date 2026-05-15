/**
 * Phase 19 Plan 19-06a — PartnerDashboard + PartnerLayout vitest tests.
 *
 * 6 assertions covering:
 *   T1: non-affiliate user → forbidden state, no data fetched
 *   T2: affiliate user → 4 KPI cards + trend chart + activity feed render
 *   T3: 10-min interval triggers refetch (vi.useFakeTimers)
 *   T4: Refresh button click → immediate refetch + lastFetchedAt updates
 *   T5: connectState=pending → StripeConnectOnboardingCard stub rendered
 *   T6: connectState=active → stub hidden (returns null when active)
 *
 * I-4 cross-wave gate: this test mocks `@/components/partner/StripeConnectOnboardingCard`
 * (file authored by 19-06b). Mock is hoisted by vi.mock so the real module is
 * never resolved — that's how the test can pass while the real file is missing.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PartnerDashboard } from '@/components/partner/PartnerDashboard';
import PartnerLayout from '@/components/partner/PartnerLayout';
import type * as AffiliateApiModule from '@/lib/affiliate/api';

// ── Mock supabase client (queries + auth) ──────────────────────────────────

const fromMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 't' } },
        error: null,
      }),
    },
  },
}));

// ── Mock the affiliate API (we tested it directly in api.test.ts) ──────────

const fetchAffiliateProfileMock = vi.fn();
const fetchAffiliateStatsMock = vi.fn();
const fetchDailyTrendMock = vi.fn();
const fetchRecentConversionsMock = vi.fn();

vi.mock('@/lib/affiliate/api', async () => {
  // We keep the real type exports by spreading, but override the fetchers.
  const actual = await vi.importActual<typeof AffiliateApiModule>('@/lib/affiliate/api');
  return {
    ...actual,
    fetchAffiliateProfile: (...args: unknown[]) => fetchAffiliateProfileMock(...args),
    fetchAffiliateStats: (...args: unknown[]) => fetchAffiliateStatsMock(...args),
    fetchDailyTrend: (...args: unknown[]) => fetchDailyTrendMock(...args),
    fetchRecentConversions: (...args: unknown[]) => fetchRecentConversionsMock(...args),
  };
});

// ── Mock the I-4 cross-wave dependency ─────────────────────────────────────
// Plan 19-06b's StripeConnectOnboardingCard does not exist yet. The hoisted
// vi.mock factory short-circuits module resolution so the test can render
// the dashboard despite the missing real module.

// Mock BaseChart — chart.js needs a real canvas + ResizeObserver (jsdom has neither).
// We don't assert chart internals here; the chart's container heading is enough.
vi.mock('@/components/dashboard/charts/BaseChart', () => ({
  BaseChart: ({ ariaLabel }: { ariaLabel: string }) => (
    <div data-testid="base-chart" aria-label={ariaLabel} />
  ),
}));

vi.mock('@/components/partner/StripeConnectOnboardingCard', () => {
  // Stub component matches the I-4 contract shape — props: { state, requirements, disabledReason }.
  // Inlined to satisfy vi.mock's hoisted-factory rule (cannot reference outer vars).
  const Stub = ({ state }: { state: string }) => {
    if (state === 'active') return null;
    return (
      <div data-testid="stripe-connect-onboarding-card" data-state={state}>
        Stripe Connect stub — {state}
      </div>
    );
  };
  return {
    StripeConnectOnboardingCard: Stub,
    default: Stub,
  };
});

// ── Mock the store ──────────────────────────────────────────────────────────

interface MockSignedIn {
  user:
    | {
        id: string;
        app_metadata?: { role?: string };
      }
    | null;
}
let mockSignedIn: MockSignedIn | null = null;

vi.mock('@/lib/store', () => ({
  useStore: <T,>(selector: (s: { signedIn: MockSignedIn | null }) => T): T =>
    selector({ signedIn: mockSignedIn }),
}));

// Mock fetch for partner-account-status
const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

// ── Fixtures ────────────────────────────────────────────────────────────────

const AFF_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

const PROFILE = {
  id: AFF_ID,
  display_name: 'Alice',
  referral_code: 'alice-xyz',
  status: 'approved',
  stripe_payouts_enabled: true,
};

const STATS = {
  clicks30d: 120,
  clicksPrev30d: 80,
  conversions30d: 8,
  conversionsPrev30d: 5,
  commissionsCents30d: 8000,
  commissionsCentsPrev30d: 5000,
  pendingPayoutCents: 4000,
};

const TREND = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-04-${String(16 + (i % 30)).padStart(2, '0')}`,
  clicks: i,
  conversions: i % 5,
}));

const RECENT = [
  {
    id: 'conv-1',
    created_at: '2026-05-15T10:00:00Z',
    status: 'confirmed' as const,
    commission_cents: 1000,
    subscription_id: 'sub_001',
  },
  {
    id: 'conv-2',
    created_at: '2026-05-14T10:00:00Z',
    status: 'pending' as const,
    commission_cents: 1000,
    subscription_id: 'sub_002',
  },
];

function setStatusResponse(state: string, requirements: string[] = []): void {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ state, requirements, disabled_reason: null }),
  } as Response);
}

// ── Setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  mockSignedIn = {
    user: {
      id: USER_ID,
      app_metadata: { role: 'affiliate' },
    },
  };
  fetchAffiliateProfileMock.mockReset();
  fetchAffiliateStatsMock.mockReset();
  fetchDailyTrendMock.mockReset();
  fetchRecentConversionsMock.mockReset();
  fromMock.mockReset();

  fetchAffiliateProfileMock.mockResolvedValue(PROFILE);
  fetchAffiliateStatsMock.mockResolvedValue(STATS);
  fetchDailyTrendMock.mockResolvedValue(TREND);
  fetchRecentConversionsMock.mockResolvedValue(RECENT);

  fetchMock = vi.fn();
  setStatusResponse('pending');
  // @ts-expect-error — test fetch mock
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

describe('PartnerLayout role gate', () => {
  // ── T1 ──
  it('T1 — non-affiliate user → forbidden state, no data fetched', async () => {
    mockSignedIn = {
      user: { id: USER_ID, app_metadata: { role: 'patient' } },
    };

    render(
      <PartnerLayout __testActivePath="/partner/dashboard">
        <PartnerDashboard />
      </PartnerLayout>,
    );

    expect(
      screen.getByText(/This area is for approved affiliates only/i),
    ).toBeTruthy();
    // None of the fetchers should have been invoked.
    expect(fetchAffiliateProfileMock).not.toHaveBeenCalled();
    expect(fetchAffiliateStatsMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('PartnerDashboard', () => {
  // ── T2 ──
  it('T2 — affiliate user → KPI cards + chart + activity feed render', async () => {
    render(
      <PartnerLayout __testActivePath="/partner/dashboard">
        <PartnerDashboard />
      </PartnerLayout>,
    );

    // Greeting
    await waitFor(() => {
      expect(screen.getByText(/Hi Alice/)).toBeTruthy();
    });

    // 4 KPI labels per UI-SPEC
    await waitFor(() => {
      expect(screen.getByText('Clicks · 30d')).toBeTruthy();
    });
    expect(screen.getByText('Conversions · 30d')).toBeTruthy();
    expect(screen.getByText('Commissions · 30d')).toBeTruthy();
    expect(screen.getByText('Pending payout')).toBeTruthy();

    // Trend chart heading
    expect(screen.getByText('Clicks + conversions (30d)')).toBeTruthy();

    // Activity feed heading
    expect(screen.getByText('Recent conversions')).toBeTruthy();
  });

  // ── T3 ──
  it('T3 — 10-min interval triggers refetch', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(
      <PartnerLayout __testActivePath="/partner/dashboard">
        <PartnerDashboard />
      </PartnerLayout>,
    );

    // Initial fetches
    await waitFor(() => {
      expect(fetchAffiliateStatsMock).toHaveBeenCalledTimes(1);
    });
    const initialCount = fetchAffiliateStatsMock.mock.calls.length;

    // Advance 10 min
    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000 + 50);
    });

    await waitFor(() => {
      expect(fetchAffiliateStatsMock.mock.calls.length).toBeGreaterThan(initialCount);
    });
  });

  // ── T4 ──
  it('T4 — Refresh button click → immediate refetch', async () => {
    render(
      <PartnerLayout __testActivePath="/partner/dashboard">
        <PartnerDashboard />
      </PartnerLayout>,
    );

    await waitFor(() => {
      expect(fetchAffiliateStatsMock).toHaveBeenCalledTimes(1);
    });

    const btn = screen.getByRole('button', { name: /Refresh dashboard/i });
    // The previous fetchAll is synchronous-then-await; await microtask before click.
    await waitFor(() => {
      expect(screen.getByText(/Hi Alice/)).toBeTruthy();
    });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(fetchAffiliateStatsMock).toHaveBeenCalledTimes(2);
    });
  });

  // ── T5 ──
  it('T5 — connectState=pending → StripeConnectOnboardingCard stub rendered', async () => {
    setStatusResponse('pending', ['business_profile.mcc']);
    render(
      <PartnerLayout __testActivePath="/partner/dashboard">
        <PartnerDashboard />
      </PartnerLayout>,
    );

    await waitFor(() => {
      const stub = screen.queryByTestId('stripe-connect-onboarding-card');
      expect(stub).toBeTruthy();
      expect(stub?.getAttribute('data-state')).toBe('pending');
    });
  });

  // ── T6 ──
  it('T6 — connectState=active → card hidden (stub returns null)', async () => {
    setStatusResponse('active');
    render(
      <PartnerLayout __testActivePath="/partner/dashboard">
        <PartnerDashboard />
      </PartnerLayout>,
    );

    // Wait for the dashboard to finish initial render
    await waitFor(() => {
      expect(screen.getByText(/Hi Alice/)).toBeTruthy();
    });
    // Allow the status fetch + setState to settle, then assert hidden.
    await waitFor(() => {
      expect(screen.queryByTestId('stripe-connect-onboarding-card')).toBeNull();
    });
  });
});
