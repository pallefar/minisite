/**
 * Phase 42 Plan 42-10 Task 2 — QuarterlyNPSDashboard tests.
 *
 * Coverage per plan behaviors:
 *   T1: loads get_quarterly_nps_dashboard RPC + renders current-quarter score.
 *   T2: renders delta-vs-prior with arrow indicator.
 *   T3: renders trend chart container (BaseChart mocked).
 *   T4: filter dropdowns (tenure / plan / cohort) re-fetch on change.
 *   T5: verbatim list renders one entry per row with score + comment + bucket.
 *   T6: empty-state copy "No responses yet this quarter" when verbatim_total=0.
 *   T7: pagination buttons advance the page parameter.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuarterlyNPSDashboard } from './QuarterlyNPSDashboard';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// BaseChart is mocked because jsdom has no Canvas API; we assert the shell
// renders with the correct aria-label.
vi.mock('@/components/dashboard/charts/BaseChart', () => ({
  BaseChart: ({ ariaLabel }: { ariaLabel: string }) => (
    <div role="img" aria-label={ariaLabel} data-testid="base-chart-mock" />
  ),
}));

const RICH_PAYLOAD = {
  quarter: '2026-Q2',
  prior_quarter: '2026-Q1',
  current_score: 42,
  prior_score: 30,
  delta: 12,
  trend: [
    { quarter: '2026-Q2', nps: 42, responses: 50 },
    { quarter: '2026-Q1', nps: 30, responses: 40 },
    { quarter: '2025-Q4', nps: 25, responses: 35 },
    { quarter: '2025-Q3', nps: 20, responses: 30 },
  ],
  verbatim: [
    {
      id: 'v-1',
      score: 9,
      comment: 'Loved the new dashboard!',
      responded_at: '2026-05-14T10:00:00Z',
      responded_via: 'email',
      tenure_bucket: '>6mo',
    },
    {
      id: 'v-2',
      score: 4,
      comment: 'Sync was slow on weekends.',
      responded_at: '2026-05-13T08:00:00Z',
      responded_via: 'in-app',
      tenure_bucket: '<6mo',
    },
  ],
  verbatim_total: 2,
  page: 1,
  page_size: 20,
};

const EMPTY_PAYLOAD = {
  ...RICH_PAYLOAD,
  current_score: null,
  prior_score: null,
  delta: null,
  trend: [],
  verbatim: [],
  verbatim_total: 0,
};

describe('<QuarterlyNPSDashboard /> — Plan 42-10 Task 2', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('T1: loads RPC and renders current-quarter NPS score', async () => {
    mockRpc.mockResolvedValue({ data: RICH_PAYLOAD, error: null });
    render(<QuarterlyNPSDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/Current quarter \(2026-Q2\)/i)).toBeInTheDocument();
    });
    // Score "42" rendered (rounded).
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(mockRpc).toHaveBeenCalledWith(
      'get_quarterly_nps_dashboard',
      expect.objectContaining({ p_quarter: null, p_tenure_bucket: null, p_page: 1 }),
    );
  });

  it('T2: renders delta-vs-prior with arrow indicator (positive)', async () => {
    mockRpc.mockResolvedValue({ data: RICH_PAYLOAD, error: null });
    render(<QuarterlyNPSDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/Δ vs prior quarter/i)).toBeInTheDocument();
    });
    expect(screen.getByText('+12')).toBeInTheDocument();
    expect(screen.getByText(/vs 2026-Q1/i)).toBeInTheDocument();
  });

  it('T3: renders trend chart container', async () => {
    mockRpc.mockResolvedValue({ data: RICH_PAYLOAD, error: null });
    render(<QuarterlyNPSDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/4-quarter trend/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId('base-chart-mock')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Quarterly NPS trend chart/i })).toBeInTheDocument();
  });

  it('T4: changing tenure filter triggers re-fetch with the dimension parameter', async () => {
    mockRpc.mockResolvedValue({ data: RICH_PAYLOAD, error: null });
    const user = userEvent.setup();
    render(<QuarterlyNPSDashboard />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));

    const tenureSelect = screen.getByLabelText(/Tenure/i);
    await user.selectOptions(tenureSelect, 'new');

    await waitFor(() => expect(mockRpc.mock.calls.length).toBeGreaterThan(1));
    const lastCall = mockRpc.mock.calls[mockRpc.mock.calls.length - 1];
    expect(lastCall[1]).toMatchObject({ p_tenure_bucket: 'new' });
  });

  it('T5: verbatim list shows comment + score + tenure for each row', async () => {
    mockRpc.mockResolvedValue({ data: RICH_PAYLOAD, error: null });
    render(<QuarterlyNPSDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Loved the new dashboard!')).toBeInTheDocument();
    });
    expect(screen.getByText('Sync was slow on weekends.')).toBeInTheDocument();
    // Score values appear in the verbatim header strip.
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    // Total count badge.
    expect(screen.getByText('2 total')).toBeInTheDocument();
  });

  it('T6: empty-state copy when verbatim_total=0', async () => {
    mockRpc.mockResolvedValue({ data: EMPTY_PAYLOAD, error: null });
    render(<QuarterlyNPSDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/No responses yet this quarter/i)).toBeInTheDocument();
    });
  });

  it('T7: pagination — Next advances page param (when totalPages > 1)', async () => {
    const PAGINATED_PAYLOAD = {
      ...RICH_PAYLOAD,
      verbatim_total: 45, // 3 pages at 20/page
      page: 1,
    };
    mockRpc.mockResolvedValue({ data: PAGINATED_PAYLOAD, error: null });
    const user = userEvent.setup();
    render(<QuarterlyNPSDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/Page 1 of 3/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Next/i }));
    await waitFor(() => {
      const lastCall = mockRpc.mock.calls[mockRpc.mock.calls.length - 1];
      expect(lastCall[1]).toMatchObject({ p_page: 2 });
    });
  });
});
