/**
 * Phase 51 Plan 51-08 — TrafficLandingPagesTab RTL tests (TRAFFIC-12).
 *
 * Three behavior gates from the plan (Task 2):
 *   T1 — Renders top-N rows from mock RPC (data path: get_traffic_landing_page_rollup).
 *   T2 — Typing a filter substring narrows the table client-side.
 *   T3 — Clicking the Visits header toggles sort direction.
 *
 * Mock pattern mirrors `account-delete.test.tsx` (signedIn injected via
 * useStore.setState) + `HitlQueuePage.test.tsx` (vi.mock('@/lib/supabase')).
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';

// ─── Mock supabase.rpc ────────────────────────────────────────────────────────

type Row = {
  landing_path: string;
  page_variant_id: string | null;
  audience: string;
  day: string;
  org_id: string | null;
  visits: number;
  signups: number;
  activations: number;
  paids: number;
};

let mockRows: Row[] = [];
const mockRpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      mockRpcCalls.push({ fn, args });
      return Promise.resolve({ data: mockRows, error: null });
    }),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function row(
  path: string,
  visits: number,
  signups: number,
  paids: number,
  page_variant_id: string | null = null,
  audience: string = 'consumer',
): Row {
  return {
    landing_path: path,
    page_variant_id,
    audience,
    day: '2026-05-20',
    org_id: null,
    visits,
    signups,
    activations: 0,
    paids,
  };
}

beforeEach(() => {
  mockRows = [];
  mockRpcCalls.length = 0;
  vi.clearAllMocks();
  // Default to admin (role !== 'clinic_owner' → orgFilter = null).
  useStore.setState({
    signedIn: {
      user: {
        id: 'admin-1',
        email: 'admin@example.com',
        app_metadata: { role: 'admin' },
      } as unknown as NonNullable<ReturnType<typeof useStore.getState>['signedIn']>['user'],
      session: null as never,
      verified: true,
    },
  });
});

afterEach(() => {
  useStore.setState({ signedIn: null });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TrafficLandingPagesTab', () => {
  it('T1 — renders rows from mock RPC (top-N path) with em-dash for null variant', async () => {
    mockRows = [
      row('/pricing', 1000, 50, 5),
      row('/share/clinic-acme', 400, 20, 2, 'pv-abcd1234'),
      row('/glp1', 200, 10, 1),
    ];
    const { TrafficLandingPagesTab } = await import('./TrafficLandingPagesTab');
    render(<TrafficLandingPagesTab />);

    // RPC dispatched with expected RPC name + default top_n=25.
    await waitFor(() => {
      expect(mockRpcCalls.length).toBeGreaterThan(0);
    });
    const firstCall = mockRpcCalls[0];
    expect(firstCall.fn).toBe('get_traffic_landing_page_rollup');
    expect(firstCall.args.p_top_n).toBe(25);
    expect(firstCall.args.p_audience).toBeNull(); // default audience='all' → null

    // All three landing paths visible in the rendered table.
    await waitFor(() => {
      expect(screen.getByText('/pricing')).toBeTruthy();
    });
    expect(screen.getByText('/share/clinic-acme')).toBeTruthy();
    expect(screen.getByText('/glp1')).toBeTruthy();

    // Em-dash rendered for the two null page_variant_id rows; truncated
    // variant id shown for the PAGEAB row.
    const dashCells = screen.getAllByText('—');
    expect(dashCells.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('pv-abcd1')).toBeTruthy(); // slice(0,8) of 'pv-abcd1234'
  });

  it('T2 — typing a filter substring narrows the table client-side', async () => {
    mockRows = [
      row('/pricing', 1000, 50, 5),
      row('/share/clinic-acme', 400, 20, 2),
      row('/glp1', 200, 10, 1),
    ];
    const { TrafficLandingPagesTab } = await import('./TrafficLandingPagesTab');
    render(<TrafficLandingPagesTab />);

    await waitFor(() => {
      expect(screen.getByText('/pricing')).toBeTruthy();
    });

    const filterInput = screen.getByLabelText('Filter by path');
    fireEvent.change(filterInput, { target: { value: 'clinic' } });

    // After filter: only /share/clinic-acme should remain.
    await waitFor(() => {
      expect(screen.queryByText('/pricing')).toBeNull();
    });
    expect(screen.queryByText('/glp1')).toBeNull();
    expect(screen.getByText('/share/clinic-acme')).toBeTruthy();

    // Filter is client-side — no new RPC call beyond initial fetch.
    expect(mockRpcCalls.length).toBe(1);
  });

  it('T3 — clicking the Visits header toggles sort direction', async () => {
    mockRows = [row('/low', 100, 0, 0), row('/high', 1000, 0, 0), row('/mid', 500, 0, 0)];
    const { TrafficLandingPagesTab } = await import('./TrafficLandingPagesTab');
    render(<TrafficLandingPagesTab />);

    // Default sort: visits desc → first body row should be /high.
    await waitFor(() => {
      expect(screen.getByText('/high')).toBeTruthy();
    });

    const table = screen.getByRole('table');
    const initialBodyRows = within(table).getAllByRole('row').slice(1); // skip header row
    expect(initialBodyRows[0].textContent).toMatch(/\/high/);
    expect(initialBodyRows[2].textContent).toMatch(/\/low/);
    // aria-sort: descending on visits column.
    const visitsHeader = screen.getByLabelText('Sort by visits');
    expect(visitsHeader.getAttribute('aria-sort')).toBe('descending');

    // Click Visits header — toggles to ascending.
    fireEvent.click(visitsHeader);

    await waitFor(() => {
      expect(visitsHeader.getAttribute('aria-sort')).toBe('ascending');
    });
    const afterToggleRows = within(table).getAllByRole('row').slice(1);
    expect(afterToggleRows[0].textContent).toMatch(/\/low/);
    expect(afterToggleRows[2].textContent).toMatch(/\/high/);
  });
});
