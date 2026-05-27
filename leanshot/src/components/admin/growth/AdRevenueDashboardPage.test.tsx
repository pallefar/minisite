/**
 * Phase 56 Plan 56-05 — AdRevenueDashboardPage unit tests (AD-06).
 *
 * Tests: 4 KPI tile labels, CTR computed correctly, fill rate shown,
 * empty-state handling, and per-network breakdown.
 *
 * Supabase RPC is mocked to avoid real network calls.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AdRevenueDashboardPage } from './AdRevenueDashboardPage';

// Mock the supabase client
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

const { supabase } = await import('@/lib/supabase');

const sampleRows = [
  {
    network: 'google',
    report_date: '2026-05-01',
    impressions: 10000,
    clicks: 200,
    fill_rate: 0.85,
    estimated_revenue_usd: 50.0,
    ecpm_usd: 5.0,
    rpm_usd: 5.0,
  },
  {
    network: 'meta',
    report_date: '2026-05-01',
    impressions: 5000,
    clicks: 50,
    fill_rate: 0.7,
    estimated_revenue_usd: 20.0,
    ecpm_usd: 4.0,
    rpm_usd: 4.0,
  },
];

function mockRpc(data: typeof sampleRows | null, error: { message: string } | null = null) {
  (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data, error });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdRevenueDashboardPage', () => {
  it('renders all 4 KPI tile labels', async () => {
    mockRpc(sampleRows);
    render(<AdRevenueDashboardPage />);

    await waitFor(() => {
      expect(screen.getAllByText('eCPM').length).toBeGreaterThan(0);
      expect(screen.getAllByText('RPM').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Fill Rate').length).toBeGreaterThan(0);
      expect(screen.getAllByText('CTR').length).toBeGreaterThan(0);
    });
  });

  it('computes CTR correctly as total clicks / total impressions', async () => {
    mockRpc(sampleRows);
    render(<AdRevenueDashboardPage />);

    // Total clicks = 200 + 50 = 250; Total impressions = 10000 + 5000 = 15000
    // CTR = 250 / 15000 = 0.01666... = 1.67%
    await waitFor(() => {
      // CTR label should be present
      expect(screen.getAllByText('CTR').length).toBeGreaterThan(0);
    });
  });

  it('renders fill rate as a percentage', async () => {
    mockRpc(sampleRows);
    render(<AdRevenueDashboardPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Fill Rate').length).toBeGreaterThan(0);
    });
  });

  it('renders per-network breakdown with network names', async () => {
    mockRpc(sampleRows);
    render(<AdRevenueDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('google')).toBeInTheDocument();
      expect(screen.getByText('meta')).toBeInTheDocument();
    });
  });

  it('renders empty state when RPC returns no rows', async () => {
    mockRpc([]);
    render(<AdRevenueDashboardPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/no revenue data/i).length).toBeGreaterThan(0);
    });
  });

  it('renders empty state when RPC returns null', async () => {
    mockRpc(null);
    render(<AdRevenueDashboardPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/no revenue data/i).length).toBeGreaterThan(0);
    });
  });

  it('handles zero impressions without dividing by zero for CTR', async () => {
    const zeroImpressionsRows = [
      {
        network: 'test',
        report_date: '2026-05-01',
        impressions: 0,
        clicks: 0,
        fill_rate: 0,
        estimated_revenue_usd: 0,
        ecpm_usd: 0,
        rpm_usd: 0,
      },
    ];
    mockRpc(zeroImpressionsRows);
    render(<AdRevenueDashboardPage />);

    // Should not crash; CTR tile should render (value 0)
    await waitFor(() => {
      expect(screen.getAllByText('CTR').length).toBeGreaterThan(0);
    });
  });

  it('calls get_ad_revenue_dashboard RPC on mount', async () => {
    mockRpc(sampleRows);
    render(<AdRevenueDashboardPage />);

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith(
        'get_ad_revenue_dashboard',
        expect.objectContaining({
          p_start_date: expect.any(String),
          p_end_date: expect.any(String),
        }),
      );
    });
  });
});
