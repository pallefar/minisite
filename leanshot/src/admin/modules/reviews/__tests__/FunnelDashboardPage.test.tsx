/**
 * Phase 36 Plan 36-04 Task 3 — FunnelDashboardPage tests (Surface E).
 *
 * Covers:
 *  - mounts and calls review_funnel_aggregate RPC with default p_window_days=30
 *  - renders 3 funnel bars (prompts shown / rated internally / external clicked)
 *  - empty (prompts_shown === 0) → EmptyState with "No experiments running"
 *  - time-window selector change refetches with new p_window_days
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FunnelDashboardPage from '../FunnelDashboardPage';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: {
      invoke: vi.fn(),
    },
  },
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => vi.fn(),
}));

// Stub BaseChart to avoid chart.js + canvas in jsdom.
vi.mock('@/components/dashboard/charts/BaseChart', () => ({
  BaseChart: ({ ariaLabel }: { ariaLabel: string }) => (
    <div data-testid="base-chart" aria-label={ariaLabel} />
  ),
}));

beforeEach(() => {
  mockRpc.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('FunnelDashboardPage (Phase 36 Plan 36-04 Task 3 — Surface E)', () => {
  it('calls review_funnel_aggregate with default p_window_days=30 on mount', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          prompts_shown: 200,
          rated_internal: 80,
          external_clicked: 30,
          by_variant: { control: { prompts_shown: 100, rated_internal: 40 } },
        },
      ],
      error: null,
    });

    render(<FunnelDashboardPage />);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('review_funnel_aggregate', { p_window_days: 30 });
    });
  });

  it('renders 3 funnel bars when data is non-empty', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          prompts_shown: 200,
          rated_internal: 80,
          external_clicked: 30,
          by_variant: {},
        },
      ],
      error: null,
    });

    render(<FunnelDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/Prompts shown/i)).toBeTruthy();
      expect(screen.getByText(/Rated internally/i)).toBeTruthy();
      expect(screen.getByText(/Clicked external CTA/i)).toBeTruthy();
    });
  });

  it('renders EmptyState when prompts_shown === 0', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          prompts_shown: 0,
          rated_internal: 0,
          external_clicked: 0,
          by_variant: {},
        },
      ],
      error: null,
    });

    render(<FunnelDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/No experiments running/i)).toBeTruthy();
    });
  });

  it('time-window selector change refetches with new p_window_days', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          prompts_shown: 200,
          rated_internal: 80,
          external_clicked: 30,
          by_variant: {},
        },
      ],
      error: null,
    });

    render(<FunnelDashboardPage />);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('review_funnel_aggregate', { p_window_days: 30 });
    });

    fireEvent.click(screen.getByRole('button', { name: /^7d$/i }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('review_funnel_aggregate', { p_window_days: 7 });
    });
  });
});
