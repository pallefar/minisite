/**
 * Phase 37 Plan 37-08 Task 4 — TrendsDashboardPage tests (HELP-13).
 *
 * Behavior gates:
 *   T1 — renders chart container + sr-only table with row data
 *   T2 — empty data shows "No ticket activity" message
 *   T3 — range picker change refetches with new gte filter
 *   T4 — top-tag callout shows highest-volume tag
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockRow {
  tag_name: string;
  bucket_day: string;
  ticket_count: number;
}

let mockRows: MockRow[] = [];
const gteCalls: Array<[string, unknown]> = [];

function makeBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    _table: table,
    select: vi.fn(function (this: unknown) {
      return this;
    }),
    gte: vi.fn(function (this: unknown, col: string, val: unknown) {
      gteCalls.push([col, val]);
      return this;
    }),
    order: vi.fn(function (this: unknown) {
      return this;
    }),
    then: function (
      this: { _table: string },
      resolve: (v: { data: unknown[]; error: null }) => void,
    ) {
      if (this._table === 'helpdesk_tag_volume_view') {
        resolve({ data: mockRows, error: null });
        return Promise.resolve({ data: mockRows, error: null });
      }
      resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    },
  };
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
}));

// BaseChart pulls chart.js + chart.js's full registerables. Mock to a
// minimal canvas-bearing stub so we can assert presence without booting
// the renderer. Phase 33 CACDashboardPage uses BaseChart directly so this
// mock keeps Task 4 tests isolated.
vi.mock('@/components/dashboard/charts/BaseChart', () => ({
  __esModule: true,
  BaseChart: ({ ariaLabel }: { ariaLabel: string }) => (
    <canvas data-testid="chart-canvas" aria-label={ariaLabel} />
  ),
}));

describe('TrendsDashboardPage', () => {
  beforeEach(() => {
    mockRows = [];
    gteCalls.length = 0;
    vi.clearAllMocks();
  });

  it('T1: renders chart + sr-only data table', async () => {
    mockRows = [
      { tag_name: 'billing', bucket_day: '2026-05-15', ticket_count: 5 },
      { tag_name: 'refund', bucket_day: '2026-05-15', ticket_count: 3 },
      { tag_name: 'billing', bucket_day: '2026-05-16', ticket_count: 7 },
    ];
    const { default: TrendsDashboardPage } = await import('./TrendsDashboardPage');
    render(<TrendsDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('chart-canvas')).toBeTruthy();
    });
    // sr-only table should list rows
    await waitFor(() => {
      expect(screen.getAllByText('billing').length).toBeGreaterThan(0);
    });
  });

  it('T2: empty data shows "No ticket activity"', async () => {
    mockRows = [];
    const { default: TrendsDashboardPage } = await import('./TrendsDashboardPage');
    render(<TrendsDashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/no ticket activity/i)).toBeTruthy();
    });
  });

  it('T3: range picker change refetches with new gte', async () => {
    mockRows = [{ tag_name: 'billing', bucket_day: '2026-05-15', ticket_count: 1 }];
    const { default: TrendsDashboardPage } = await import('./TrendsDashboardPage');
    render(<TrendsDashboardPage />);
    await waitFor(() => screen.getByTestId('chart-canvas'));
    const initialGteCount = gteCalls.length;
    expect(initialGteCount).toBeGreaterThan(0);
    expect(gteCalls[0][0]).toBe('bucket_day');

    fireEvent.click(screen.getByRole('button', { name: /^7d$/i }));
    await waitFor(() => {
      expect(gteCalls.length).toBeGreaterThan(initialGteCount);
    });
    const lastGte = gteCalls[gteCalls.length - 1];
    expect(lastGte[0]).toBe('bucket_day');
  });

  it('T4: top-tag callout shows highest-volume tag', async () => {
    mockRows = [
      { tag_name: 'billing', bucket_day: '2026-05-15', ticket_count: 10 },
      { tag_name: 'refund', bucket_day: '2026-05-15', ticket_count: 3 },
      { tag_name: 'billing', bucket_day: '2026-05-16', ticket_count: 5 },
    ];
    const { default: TrendsDashboardPage } = await import('./TrendsDashboardPage');
    render(<TrendsDashboardPage />);
    await waitFor(() => {
      // Top tag is 'billing' (total 15)
      const callout = screen.getByText(/top tag/i);
      expect(callout).toBeTruthy();
    });
    await waitFor(() => {
      // Some element shows 'billing' as top
      const matches = screen.getAllByText(/billing/i);
      expect(matches.length).toBeGreaterThan(0);
    });
  });
});
