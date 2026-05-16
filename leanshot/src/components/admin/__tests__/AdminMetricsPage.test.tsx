/**
 * Phase 22 Plan 22-08 — AdminMetricsPage RTL coverage (RED phase).
 *
 * Coverage:
 *   T1: staff user — renders 4 KPI tiles (MRR, ARR, 30d churn, clinic-seat utilization).
 *   T2: period Pill click → re-fetches with new p_period.
 *   T3: main chart container renders (canvas with aria-label).
 *   T4: clinic-seat list renders one row per clinic.
 *   T5: empty state when MRR + ARR + paid_count + clinic_seat_count all zero.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminMetricsPage } from '@/components/admin/pages/AdminMetricsPage';

// ---------------------------------------------------------------------------
// Supabase mocks — mirror AdminAffiliatesScaffold.test.tsx pattern.
// ---------------------------------------------------------------------------
const mockAuthGetUser = vi.fn();
const mockProfilesMaybeSingle = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => mockAuthGetUser(),
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => mockProfilesMaybeSingle(),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// Mock BaseChart — jsdom has no Canvas API and chart.js explodes on getContext().
// The chart shell + aria-label are validated; chart.js correctness is covered by
// existing dashboard chart tests + Phase 02.1 BaseChart coverage.
vi.mock('@/components/dashboard/charts/BaseChart', () => ({
  BaseChart: ({ ariaLabel }: { ariaLabel: string }) => (
    <div role="img" aria-label={ariaLabel} data-testid="base-chart-mock" />
  ),
}));

const STAFF_RPC = {
  period: '30d',
  mrr_cents: 19980,
  arr_cents: 239760,
  churn_pct_30d: 4.5,
  paid_count: 20,
  free_count: 100,
  past_due_count: 0,
  clinic_seat_count: 5,
  churn_series: [{ bucket: '2026-05', free: 100, paid: 20, churn_pct: 4.5 }],
  clinic_seat_utilization: [
    { clinic_id: 'org-1', clinic_name: 'Acme Clinic', used: 4, total: 10, series: [] },
    { clinic_id: 'org-2', clinic_name: 'Beta Health', used: 1, total: 5, series: [] },
  ],
  computed_at: '2026-05-16T10:00:00Z',
};

const EMPTY_RPC = {
  ...STAFF_RPC,
  mrr_cents: 0,
  arr_cents: 0,
  paid_count: 0,
  clinic_seat_count: 0,
  clinic_seat_utilization: [],
};

function primeStaff() {
  mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'staff-1' } } });
  mockProfilesMaybeSingle.mockResolvedValue({ data: { is_staff: true }, error: null });
}

describe('<AdminMetricsPage /> — Plan 22-08', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T1 — staff user renders 4 KPI tiles (MRR / ARR / 30d churn / clinic-seat utilization)', async () => {
    primeStaff();
    mockRpc.mockResolvedValue({ data: STAFF_RPC, error: null });
    render(<AdminMetricsPage />);
    await waitFor(() => expect(screen.getByText('MRR')).toBeInTheDocument());
    expect(screen.getByText('ARR')).toBeInTheDocument();
    expect(screen.getByText('30d churn')).toBeInTheDocument();
    // "Clinic seat utilization" appears in BOTH the KPI strip (label) and the
    // seat list CardHeader — assert at least one.
    expect(screen.getAllByText('Clinic seat utilization').length).toBeGreaterThanOrEqual(1);
  });

  it('T2 — period Pill click re-fetches with new p_period', async () => {
    primeStaff();
    mockRpc.mockResolvedValue({ data: STAFF_RPC, error: null });
    const user = userEvent.setup();
    render(<AdminMetricsPage />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('admin_compute_mrr_arr', { p_period: '30d' }));
    mockRpc.mockClear();
    mockRpc.mockResolvedValue({ data: STAFF_RPC, error: null });
    const pill90 = await screen.findByRole('tab', { name: /90d/i });
    await user.click(pill90);
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('admin_compute_mrr_arr', { p_period: '90d' }));
  });

  it('T3 — main chart container renders with descriptive aria-label', async () => {
    primeStaff();
    mockRpc.mockResolvedValue({ data: STAFF_RPC, error: null });
    render(<AdminMetricsPage />);
    await waitFor(() => {
      const chart = screen.getByRole('img', { name: /subscribers.*churn/i });
      expect(chart).toBeInTheDocument();
    });
  });

  it('T4 — clinic-seat list renders one row per clinic', async () => {
    primeStaff();
    mockRpc.mockResolvedValue({ data: STAFF_RPC, error: null });
    render(<AdminMetricsPage />);
    await waitFor(() => expect(screen.getByText('Acme Clinic')).toBeInTheDocument());
    expect(screen.getByText('Beta Health')).toBeInTheDocument();
    // "4/10 seats" appears for Acme.
    expect(screen.getByText(/4\/10/)).toBeInTheDocument();
    expect(screen.getByText(/1\/5/)).toBeInTheDocument();
  });

  it('T5 — empty state when all KPIs are zero', async () => {
    primeStaff();
    mockRpc.mockResolvedValue({ data: EMPTY_RPC, error: null });
    render(<AdminMetricsPage />);
    await waitFor(() => expect(screen.getByText(/No revenue data yet/i)).toBeInTheDocument());
    expect(screen.getByText(/Connect Stripe to see MRR and ARR here/i)).toBeInTheDocument();
  });
});
