/**
 * Phase 51 Plan 51-07 Task 2 (TRAFFIC-06 / TRAFFIC-11) — TrafficFunnelsTab unit tests.
 *
 * 4 tests per plan:
 *   T1: Renders 3 audience pills; Consumer is the default active selection.
 *   T2: Switching audience triggers a second RPC call with the new
 *       p_audience param ('clinic-org' chosen for the test).
 *   T3: A stage with a matching admin_notifications payload renders the
 *       warning Badge with copy "Below 7-day baseline by Xσ".
 *   T4: Clicking on a stage line opens the Sheet drill-in with the top-5
 *       channel breakdown.
 *
 * Mock pattern:
 *   - `vi.mock('@/lib/supabase')` — supabase.rpc returns funnel rows;
 *     supabase.from('admin_notifications').select(...) returns anomaly
 *     rows via a chainable thenable. Mirrors the pattern used by
 *     ExperimentDashboardPage.test.tsx (supabase.rpc only) but extends
 *     it for the parallel `.from().select().eq().gte()` chain.
 *   - `vi.mock('@/lib/store')` — useStore returns a default admin
 *     signedIn shape so orgFilter resolves to null (cross-org view).
 *   - BaseChart is mocked to a sentinel <div> so we don't pull chart.js
 *     into the jsdom test (chart.js requires canvas; jsdom lacks it).
 *
 * Pattern: dynamic `import()` inside each `it()` so the per-test mock
 * setup (mockRpc / fromMock) is observed by useEffect on first render
 * — same precedent as ExperimentDashboardPage.test.tsx T-suite.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────
//
// `mockRpc` resolves with the funnel rollup payload. `mockNotifGate` lets
// each test choose what admin_notifications.select returns. The
// supabase.from chain (.eq().gte()) is implemented as a thenable that
// resolves to the gated payload — mirroring the real PostgREST builder.

const mockRpc = vi.fn();
let mockNotifPayloads: Array<{ payload: unknown }> = [];

vi.mock('@/lib/supabase', () => {
  // The .select() builder is itself thenable so `await supabase.from(..).select(..).eq(..).gte(..)`
  // resolves directly. PostgREST's builder is fluent + thenable; we mirror
  // just enough to satisfy the call chain used by TrafficFunnelsTab.
  const makeBuilder = () => {
    const builder: {
      eq: (col: string, val: unknown) => typeof builder;
      gte: (col: string, val: unknown) => typeof builder;
      then: (
        resolve: (v: { data: typeof mockNotifPayloads; error: null }) => void,
      ) => void;
    } = {
      eq: () => builder,
      gte: () => builder,
      then: (resolve) => resolve({ data: mockNotifPayloads, error: null }),
    };
    return builder;
  };
  return {
    supabase: {
      rpc: (...args: unknown[]) => mockRpc(...args),
      from: () => ({
        select: () => makeBuilder(),
      }),
    },
  };
});

// useStore mock: defaults to admin (cross-org view → orgFilter = null).
type StoreShape = {
  signedIn: null | { user: { app_metadata?: Record<string, unknown> } };
};
let storeShape: StoreShape = {
  signedIn: {
    user: { app_metadata: { role: 'admin' } },
  },
};
vi.mock('@/lib/store', () => ({
  useStore: <T,>(selector: (s: StoreShape) => T): T => selector(storeShape),
}));

// BaseChart mock — sidesteps chart.js + canvas under jsdom. The mock
// receives the same {config, ariaLabel, height} props and renders a
// sentinel <div> with the aria-label so accessibility-driven queries
// still pass.
vi.mock('@/components/dashboard/charts/BaseChart', () => ({
  BaseChart: ({ ariaLabel }: { ariaLabel: string }) => (
    <div role="img" aria-label={ariaLabel} data-testid="basechart-mock" />
  ),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

type FunnelRow = {
  channel_group: string;
  stage_in: string;
  stage_out: string;
  in_count: number;
  out_count: number;
  rate: number;
};

function makeRow(overrides: Partial<FunnelRow> = {}): FunnelRow {
  return {
    channel_group: 'organic_search',
    stage_in: 'visit',
    stage_out: 'signup',
    in_count: 1000,
    out_count: 100,
    rate: 0.1,
    ...overrides,
  };
}

const CONSUMER_ROWS: FunnelRow[] = [
  makeRow({
    channel_group: 'organic_search',
    stage_in: 'visit',
    stage_out: 'signup',
    in_count: 800,
    out_count: 80,
  }),
  makeRow({
    channel_group: 'organic_social',
    stage_in: 'visit',
    stage_out: 'signup',
    in_count: 200,
    out_count: 20,
  }),
  makeRow({
    channel_group: 'organic_search',
    stage_in: 'signup',
    stage_out: 'activation',
    in_count: 100,
    out_count: 60,
  }),
  makeRow({
    channel_group: 'organic_search',
    stage_in: 'activation',
    stage_out: 'paid',
    in_count: 60,
    out_count: 12,
  }),
];

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockNotifPayloads = [];
  storeShape = {
    signedIn: { user: { app_metadata: { role: 'admin' } } },
  };
  // Default: consumer rows on first call, empty on subsequent (overridden per-test)
  mockRpc.mockResolvedValue({ data: CONSUMER_ROWS, error: null });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TrafficFunnelsTab', () => {
  it('T1: renders 3 audience pills with Consumer active by default', async () => {
    const { TrafficFunnelsTab } = await import('./TrafficFunnelsTab');
    render(<TrafficFunnelsTab />);

    const consumerPill = screen.getByRole('button', { name: 'Consumer audience' });
    const clinicPill = screen.getByRole('button', { name: 'Clinic-org audience' });
    const affiliatePill = screen.getByRole('button', { name: 'Affiliate audience' });

    expect(consumerPill).toBeInTheDocument();
    expect(clinicPill).toBeInTheDocument();
    expect(affiliatePill).toBeInTheDocument();

    // Default state: Consumer active, others not.
    expect(consumerPill).toHaveAttribute('aria-pressed', 'true');
    expect(clinicPill).toHaveAttribute('aria-pressed', 'false');
    expect(affiliatePill).toHaveAttribute('aria-pressed', 'false');

    // First RPC call must have fired with p_audience='consumer'.
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith(
        'get_traffic_funnel_rollup',
        expect.objectContaining({ p_audience: 'consumer' }),
      );
    });
  });

  it('T2: switching audience triggers a second RPC call with new p_audience', async () => {
    const { TrafficFunnelsTab } = await import('./TrafficFunnelsTab');
    render(<TrafficFunnelsTab />);

    // Wait for the initial consumer RPC.
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith(
        'get_traffic_funnel_rollup',
        expect.objectContaining({ p_audience: 'consumer' }),
      );
    });

    const callsBeforeSwitch = mockRpc.mock.calls.length;
    const clinicPill = screen.getByRole('button', { name: 'Clinic-org audience' });
    fireEvent.click(clinicPill);

    // Second call fires with p_audience='clinic-org'.
    await waitFor(() => {
      expect(mockRpc.mock.calls.length).toBeGreaterThan(callsBeforeSwitch);
      expect(mockRpc).toHaveBeenCalledWith(
        'get_traffic_funnel_rollup',
        expect.objectContaining({ p_audience: 'clinic-org' }),
      );
    });
    // aria-pressed swapped to clinic-org.
    expect(clinicPill).toHaveAttribute('aria-pressed', 'true');
  });

  it('T3: stage with anomaly payload renders warning Badge with sigma copy', async () => {
    // Seed an anomaly matching the visit→signup stage on the consumer funnel.
    mockNotifPayloads = [
      {
        payload: {
          channel_group: 'organic_search',
          audience: 'consumer',
          stage_in: 'visit',
          stage_out: 'signup',
          sigmas: 2.4,
        },
      },
    ];

    const { TrafficFunnelsTab } = await import('./TrafficFunnelsTab');
    render(<TrafficFunnelsTab />);

    await waitFor(() => {
      expect(
        screen.getByText(/Below 7-day baseline by 2\.4σ/),
      ).toBeInTheDocument();
    });
  });

  it('T4: clicking a stage line opens drill-in Sheet with top-5 channels', async () => {
    const { TrafficFunnelsTab } = await import('./TrafficFunnelsTab');
    render(<TrafficFunnelsTab />);

    // Wait for the funnel list to populate.
    const drillButton = await screen.findByRole('button', {
      name: /Drill into Visit to Signup stage/i,
    });

    fireEvent.click(drillButton);

    // Sheet renders a heading-style title prop; the drill-in body lists
    // channel rows. Assert both presence + the per-channel rows we seeded.
    await waitFor(() => {
      expect(
        screen.getByText(/Top 5 channels — Consumer cohort/i),
      ).toBeInTheDocument();
    });
    // Both channel rows from CONSUMER_ROWS at the visit→signup stage:
    expect(screen.getByText('organic_search')).toBeInTheDocument();
    expect(screen.getByText('organic_social')).toBeInTheDocument();
    // Entered counts are visible (800 / 200 from CONSUMER_ROWS).
    expect(screen.getByText('800')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });
});
