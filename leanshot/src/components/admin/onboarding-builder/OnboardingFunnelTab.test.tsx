/**
 * Phase 34 Plan 34-09 ONBOARD-09 — OnboardingFunnelTab unit tests.
 *
 * Covers:
 *   - Vendor-unconfigured → banner.
 *   - flowId=null → "Save a flow to enable funnel tracking".
 *   - Empty steps → "No step events captured yet".
 *   - Steps array → KPI tiles + table rows.
 *   - 30s polling → fetch fires twice with fake timers.
 *   - document.visibilityState='hidden' → no fetch on interval tick.
 */
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingFunnelTab from './OnboardingFunnelTab';

// Mock BaseChart — chart.js + canvas don't render in jsdom; coverage lives
// in BaseChart's own tests. Only assert that we passed sane labels/datasets.
vi.mock('@/components/dashboard/charts/BaseChart', () => ({
  BaseChart: ({ ariaLabel }: { ariaLabel: string }) => (
    <div data-testid="mock-base-chart" aria-label={ariaLabel} />
  ),
}));

const mockInvoke = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
  },
}));

beforeEach(() => {
  mockInvoke.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('OnboardingFunnelTab (Plan 34-09 ONBOARD-09)', () => {
  it('renders vendor-unconfigured banner when Edge Fn returns error vendor_unconfigured', async () => {
    mockInvoke.mockResolvedValue({
      data: { error: 'vendor_unconfigured', service: 'posthog' },
      error: null,
    });

    render(<OnboardingFunnelTab flowId="aaaa1111-2222-4333-8444-555566667777" />);

    await waitFor(() => {
      expect(screen.getByText(/PostHog Insights not yet configured/i)).toBeTruthy();
    });
  });

  it('flowId=null → renders "Save a flow to enable funnel tracking"', () => {
    render(<OnboardingFunnelTab flowId={null} />);
    expect(screen.getByText(/Save a flow to enable funnel tracking/i)).toBeTruthy();
  });

  it('empty steps array → renders "No step events captured yet"', async () => {
    mockInvoke.mockResolvedValue({ data: { steps: [] }, error: null });
    render(<OnboardingFunnelTab flowId="aaaa1111-2222-4333-8444-555566667777" />);

    await waitFor(() => {
      expect(screen.getByText(/No step events captured yet/i)).toBeTruthy();
    });
  });

  it('steps populated → KPI tiles + per-step rows render', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        steps: [
          { step_id: 'step_a', views: 100, completions: 80, drop_off_pct: 20, avg_time_ms: 1500 },
          { step_id: 'step_b', views: 80, completions: 60, drop_off_pct: 25, avg_time_ms: 2200 },
        ],
      },
      error: null,
    });

    render(<OnboardingFunnelTab flowId="aaaa1111-2222-4333-8444-555566667777" />);

    await waitFor(() => {
      // KPI summary
      expect(screen.getByText(/Total views/i)).toBeTruthy();
      expect(screen.getByText('100')).toBeTruthy();
      // Per-step table
      expect(screen.getByText('step_a')).toBeTruthy();
      expect(screen.getByText('step_b')).toBeTruthy();
    });
    // Bar chart mounted
    expect(screen.getByTestId('mock-base-chart')).toBeTruthy();
  });

  it('30s polling → fetch fires twice when timers advance 31s', async () => {
    vi.useFakeTimers();
    mockInvoke.mockResolvedValue({
      data: {
        steps: [
          { step_id: 'a', views: 1, completions: 1, drop_off_pct: 0, avg_time_ms: 0 },
        ],
      },
      error: null,
    });

    render(<OnboardingFunnelTab flowId="aaaa1111-2222-4333-8444-555566667777" />);

    // First fetch from the initial effect.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Advance 31s — interval should fire one more call.
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('document.visibilityState=hidden → no fetch on interval tick', async () => {
    vi.useFakeTimers();
    mockInvoke.mockResolvedValue({
      data: { steps: [] },
      error: null,
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    render(<OnboardingFunnelTab flowId="aaaa1111-2222-4333-8444-555566667777" />);

    // The initial effect ALWAYS fires once (no visibility gate on bootstrap).
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Advance 31s — interval should skip the fetch because tab is hidden.
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Restore for other tests.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });
});
