/**
 * Phase 51 Plan 51-06 Task 2 — TrafficChannelsTab unit tests (TRAFFIC-09, TRAFFIC-12).
 *
 * 5 tests per 51-06-PLAN Task 2:
 *   1. Happy path — 3 rows render in visits-desc order.
 *   2. Permission denied (42501) — error banner + Retry button.
 *   3. Drill-in opens Sheet — sparkline + paid-channel CAC deep-link present.
 *   4. Non-paid drill-in hides the deep-link.
 *   5. TouchMode toggle (D-02, B4 revision iter-1) — toggling First-touch
 *      issues a SECOND RPC call with p_touch_mode='first' AND the rendered
 *      table shows a different row set (NOT a UI-only caption swap).
 *
 * Mock pattern mirrors PaywallExperimentTab.test.tsx + TrafficDashboardPage.test.tsx:
 *   - `@/lib/supabase` mocked with a programmable `supabase.rpc` stub.
 *   - `@/lib/store` mocked with a per-test storeShape so role/org_id resolve
 *     to a known value (default admin → orgFilter=null).
 *   - `framer-motion` is NOT mocked; Sheet uses motion components but jsdom
 *     can still find rendered content via screen queries.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Store mock ──────────────────────────────────────────────────────────────
//
// TrafficChannelsTab reads `s.signedIn?.user?.app_metadata.role/org_id` to
// decide whether to forward `p_org_id`. Default = admin (no org) so orgFilter
// resolves to `null`.

type StoreShape = {
  signedIn: null | { user: { app_metadata?: Record<string, unknown> } };
};

let storeShape: StoreShape = { signedIn: null };

vi.mock('@/lib/store', () => ({
  useStore: <T,>(selector: (s: StoreShape) => T): T => selector(storeShape),
}));

// ─── Supabase mock ───────────────────────────────────────────────────────────
//
// `rpcMock` is the swappable implementation per test. Default returns an
// empty success response. Tests override with `rpcMock.mockImplementation(...)`.

const rpcMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

// ─── Row factory ─────────────────────────────────────────────────────────────

type Row = {
  channel_group: string;
  audience: string;
  day: string;
  org_id: string | null;
  visits: number;
  signups: number;
  activations: number;
  paids: number;
  ad_spend_usd: number | null;
  d1_retained_count: number;
  d7_retained_count: number;
  d14_retained_count: number;
  d30_retained_count: number;
  d60_retained_count: number;
  cac_to_activation: number | null;
  cac_to_paid: number | null;
};

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    channel_group: 'Direct',
    audience: 'consumer',
    day: '2026-05-23',
    org_id: null,
    visits: 100,
    signups: 10,
    activations: 5,
    paids: 2,
    ad_spend_usd: null,
    d1_retained_count: 9,
    d7_retained_count: 7,
    d14_retained_count: 6,
    d30_retained_count: 4,
    d60_retained_count: 2,
    cac_to_activation: null,
    cac_to_paid: null,
    ...overrides,
  };
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(() => {
  storeShape = { signedIn: null };
  rpcMock.mockReset();
  // Default: empty success
  rpcMock.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TrafficChannelsTab', () => {
  it('Test 1 — happy path: 3 rows render in visits-desc order', async () => {
    rpcMock.mockResolvedValue({
      data: [
        makeRow({
          channel_group: 'Direct',
          visits: 200,
          signups: 20,
          activations: 10,
        }),
        makeRow({
          channel_group: 'Paid Search',
          visits: 1000,
          signups: 80,
          activations: 40,
          paids: 18,
          ad_spend_usd: 800,
          // SECDEF returns row-level cac_to_activation; component re-computes
          // aggregate CAC = sum(spend)/sum(activations) = 800/40 = $20.00.
          cac_to_activation: 20,
        }),
        makeRow({
          channel_group: 'Organic Search',
          visits: 500,
          signups: 30,
          activations: 12,
        }),
      ],
      error: null,
    });

    const { TrafficChannelsTab } = await import('./TrafficChannelsTab');
    render(<TrafficChannelsTab />);

    await waitFor(() => {
      expect(screen.getByText('Paid Search')).toBeInTheDocument();
    });

    // Three rows, sorted by visits desc → Paid Search (1000), Organic (500),
    // Direct (200). Read all data rows from the table and inspect first cell.
    const rows = screen.getAllByRole('button', { name: /View .* retention curve/ });
    expect(rows).toHaveLength(3);
    const firstRowChannel = within(rows[0]).getByText('Paid Search');
    expect(firstRowChannel).toBeInTheDocument();
    expect(within(rows[1]).getByText('Organic Search')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Direct')).toBeInTheDocument();

    // CAC cell on Paid Search row formatted as $20.00.
    expect(within(rows[0]).getByText('$20.00')).toBeInTheDocument();
  });

  it('Test 2 — permission denied (42501): error banner + Retry button', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied for function' },
    });

    const { TrafficChannelsTab } = await import('./TrafficChannelsTab');
    render(<TrafficChannelsTab />);

    await waitFor(() => {
      expect(
        screen.getByText('Permission denied — admin role required'),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: 'Retry channel rollup' }),
    ).toBeInTheDocument();
  });

  it('Test 3 — drill-in opens Sheet with sparkline + paid-channel deep-link', async () => {
    rpcMock.mockResolvedValue({
      data: [
        makeRow({
          channel_group: 'Paid Search',
          visits: 500,
          activations: 20,
          ad_spend_usd: 400,
          d1_retained_count: 18,
          d7_retained_count: 15,
          d14_retained_count: 12,
          d30_retained_count: 9,
          d60_retained_count: 6,
        }),
      ],
      error: null,
    });

    const { TrafficChannelsTab } = await import('./TrafficChannelsTab');
    render(<TrafficChannelsTab />);

    const rowBtn = await screen.findByRole('button', {
      name: 'View Paid Search retention curve',
    });
    fireEvent.click(rowBtn);

    await waitFor(() => {
      // Sheet renders the retention-curve section eyebrow
      expect(screen.getByText('Retention curve')).toBeInTheDocument();
    });

    // Sparkline rendered with aria-label
    expect(
      screen.getByLabelText('Retention curve for Paid Search'),
    ).toBeInTheDocument();

    // Paid-channel deep-link present and points at growth/cac with channel q-param
    const deepLink = screen.getByRole('link', { name: /View ad-spend detail/i });
    expect(deepLink).toBeInTheDocument();
    expect(deepLink.getAttribute('href')).toBe(
      '/admin/growth/cac?channel=Paid%20Search',
    );

    // Bucket digits visible (D1 18 • D7 15 …)
    expect(screen.getByText(/D1 18.*D7 15.*D14 12.*D30 9.*D60 6/)).toBeInTheDocument();
  });

  it('Test 4 — non-paid channel drill-in hides the CAC deep-link', async () => {
    rpcMock.mockResolvedValue({
      data: [
        makeRow({
          channel_group: 'Organic Search',
          visits: 500,
          activations: 20,
        }),
      ],
      error: null,
    });

    const { TrafficChannelsTab } = await import('./TrafficChannelsTab');
    render(<TrafficChannelsTab />);

    const rowBtn = await screen.findByRole('button', {
      name: 'View Organic Search retention curve',
    });
    fireEvent.click(rowBtn);

    await waitFor(() => {
      expect(screen.getByText('Retention curve')).toBeInTheDocument();
    });

    // Deep-link MUST NOT be present for non-paid channels.
    expect(
      screen.queryByRole('link', { name: /View ad-spend detail/i }),
    ).not.toBeInTheDocument();
  });

  it('Test 5 — touchMode toggle changes the row set (D-02 / B4 revision iter-1)', async () => {
    // Prime per-mode responses. Default mode at mount = 'last' (per UI-SPEC).
    rpcMock.mockImplementation((_fnName: string, args: Record<string, unknown>) => {
      if (args?.p_touch_mode === 'first') {
        return Promise.resolve({
          data: [
            makeRow({ channel_group: 'Direct', visits: 300 }),
            makeRow({ channel_group: 'Paid Social', visits: 200 }),
          ],
          error: null,
        });
      }
      // 'last' branch
      return Promise.resolve({
        data: [
          makeRow({ channel_group: 'Paid Search', visits: 400 }),
          makeRow({ channel_group: 'Organic Search', visits: 250 }),
        ],
        error: null,
      });
    });

    const { TrafficChannelsTab } = await import('./TrafficChannelsTab');
    render(<TrafficChannelsTab />);

    // Initial last-touch render: Paid Search + Organic Search visible; Direct
    // + Paid Social NOT present.
    await waitFor(() => {
      expect(screen.getByText('Paid Search')).toBeInTheDocument();
    });
    expect(screen.getByText('Organic Search')).toBeInTheDocument();
    expect(screen.queryByText('Direct')).not.toBeInTheDocument();
    expect(screen.queryByText('Paid Social')).not.toBeInTheDocument();

    // Initial call was with p_touch_mode='last'.
    expect(rpcMock).toHaveBeenCalledWith(
      'get_traffic_channel_rollup',
      expect.objectContaining({ p_touch_mode: 'last' }),
    );
    const callsAfterMount = rpcMock.mock.calls.length;

    // Click First-touch pill.
    const firstTouchPill = screen.getByRole('button', { name: 'First-touch' });
    fireEvent.click(firstTouchPill);

    // (a) RPC was called a SECOND time with p_touch_mode='first'.
    await waitFor(() => {
      expect(rpcMock.mock.calls.length).toBeGreaterThan(callsAfterMount);
    });
    expect(rpcMock).toHaveBeenCalledWith(
      'get_traffic_channel_rollup',
      expect.objectContaining({ p_touch_mode: 'first' }),
    );

    // (b) The rendered row set actually CHANGED — Direct + Paid Social now
    //     visible; Paid Search + Organic Search now GONE.
    await waitFor(() => {
      expect(screen.getByText('Direct')).toBeInTheDocument();
    });
    expect(screen.getByText('Paid Social')).toBeInTheDocument();
    expect(screen.queryByText('Paid Search')).not.toBeInTheDocument();
    expect(screen.queryByText('Organic Search')).not.toBeInTheDocument();
  });
});
