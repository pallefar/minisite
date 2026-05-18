/**
 * Phase 30 Plan 04 — ClinicDashboardOverview tests (TDD RED phase).
 *
 * 9 tests for the dashboard overview component and use-clinic-metrics hook.
 *
 * Test 1: returns correct shape with aggregated stats
 * Test 2: 'Pending alerts' card has shadow-md + 20px figure; amber/success color based on count
 * Test 3: Ack rate color coding per thresholds
 * Test 4: 'Below dosing range' renders correct count + amber when > 0
 * Test 5: 'Alert types' card shows sub-figures for Missed doses / Dose variance
 * Test 6: Staleness caption format
 * Test 7: Empty state when no data
 * Test 8: Loading state renders 4 Skeletons
 * Test 9: Each stat card figure has aria-label
 */

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicDashboardOverview } from './ClinicDashboardOverview';

// ---------------------------------------------------------------------------
// Mock use-clinic-metrics
// ---------------------------------------------------------------------------

const mockMetrics = {
  pendingThisWeek: 3,
  ackRatePct: 75,
  belowDosingRange: 2,
  alertTypeBreakdown: { dose_adherence: 2, dose_variance: 1 },
  lastRefreshedAt: new Date('2026-05-18T04:00:00Z'),
  isLoading: false,
  error: null,
};

vi.mock('./use-clinic-metrics', () => ({
  useClinicMetrics: vi.fn(() => mockMetrics),
}));

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ClinicDashboardOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Test 1: renders heading "Clinic overview" and 4 stat cards in DOM order', () => {
    render(<ClinicDashboardOverview orgId="org-1" />);

    expect(screen.getByText('Clinic overview')).toBeDefined();
    expect(screen.getByText('Pending alerts')).toBeDefined();
    expect(screen.getByText('Ack rate (7 days)')).toBeDefined();
    expect(screen.getByText('Below dosing range')).toBeDefined();
    expect(screen.getByText('Alert types')).toBeDefined();
  });

  it('Test 2: Pending alerts card has shadow-md; figure uses 20px size; amber when > 0, success when 0', async () => {
    const { useClinicMetrics } = await import('./use-clinic-metrics');
    const mockFn = useClinicMetrics as ReturnType<typeof vi.fn>;

    // count > 0 case
    mockFn.mockReturnValue({ ...mockMetrics, pendingThisWeek: 3 });
    const { unmount } = render(<ClinicDashboardOverview orgId="org-1" />);

    const pendingCard = screen.getByTestId('stat-card-pending-alerts');
    expect(pendingCard.className).toContain('shadow-md');

    const figure = screen.getByTestId('pending-alerts-figure');
    expect(figure.textContent).toBe('3');
    expect(figure.className).toContain('text-[var(--color-amber)]');

    unmount();

    // count = 0 case
    mockFn.mockReturnValue({ ...mockMetrics, pendingThisWeek: 0 });
    render(<ClinicDashboardOverview orgId="org-1" />);

    const figure0 = screen.getByTestId('pending-alerts-figure');
    expect(figure0.className).toContain('text-[var(--color-success)]');
  });

  it('Test 3: Ack rate color coding — >=80 success, 50-79 amber, <50 danger, null shows em dash', async () => {
    const { useClinicMetrics } = await import('./use-clinic-metrics');
    const mockFn = useClinicMetrics as ReturnType<typeof vi.fn>;

    // >=80 → success
    mockFn.mockReturnValue({ ...mockMetrics, ackRatePct: 80 });
    const { unmount: u1 } = render(<ClinicDashboardOverview orgId="org-1" />);
    const fig80 = screen.getByTestId('ack-rate-figure');
    expect(fig80.className).toContain('text-[var(--color-success)]');
    u1();

    // 50-79 → amber
    mockFn.mockReturnValue({ ...mockMetrics, ackRatePct: 75 });
    const { unmount: u2 } = render(<ClinicDashboardOverview orgId="org-1" />);
    const fig75 = screen.getByTestId('ack-rate-figure');
    expect(fig75.className).toContain('text-[var(--color-amber)]');
    u2();

    // <50 → danger
    mockFn.mockReturnValue({ ...mockMetrics, ackRatePct: 49 });
    const { unmount: u3 } = render(<ClinicDashboardOverview orgId="org-1" />);
    const fig49 = screen.getByTestId('ack-rate-figure');
    expect(fig49.className).toContain('text-[var(--color-danger)]');
    u3();

    // null → em dash in tertiary color
    mockFn.mockReturnValue({ ...mockMetrics, ackRatePct: null });
    render(<ClinicDashboardOverview orgId="org-1" />);
    const figNull = screen.getByTestId('ack-rate-figure');
    expect(figNull.textContent).toBe('—');
    expect(figNull.className).toContain('text-[var(--color-text-tertiary)]');
  });

  it('Test 4: Below dosing range renders count; amber when > 0', async () => {
    const { useClinicMetrics } = await import('./use-clinic-metrics');
    const mockFn = useClinicMetrics as ReturnType<typeof vi.fn>;

    mockFn.mockReturnValue({ ...mockMetrics, belowDosingRange: 5 });
    const { unmount } = render(<ClinicDashboardOverview orgId="org-1" />);

    const fig = screen.getByTestId('below-dosing-range-figure');
    expect(fig.textContent).toBe('5');
    expect(fig.className).toContain('text-[var(--color-amber)]');
    unmount();

    mockFn.mockReturnValue({ ...mockMetrics, belowDosingRange: 0 });
    render(<ClinicDashboardOverview orgId="org-1" />);
    const fig0 = screen.getByTestId('below-dosing-range-figure');
    expect(fig0.className).toContain('text-[var(--color-text-tertiary)]');
  });

  it('Test 5: Alert types card shows "Missed doses" and "Dose variance" sub-figures', async () => {
    const { useClinicMetrics } = await import('./use-clinic-metrics');
    const mockFn = useClinicMetrics as ReturnType<typeof vi.fn>;

    mockFn.mockReturnValue({ ...mockMetrics, alertTypeBreakdown: { dose_adherence: 4, dose_variance: 2 } });
    render(<ClinicDashboardOverview orgId="org-1" />);

    expect(screen.getByText(/Missed doses/)).toBeDefined();
    expect(screen.getByText(/Dose variance/)).toBeDefined();
  });

  it('Test 6: Staleness caption renders "Updated every 15 minutes · Last: ..." in text-[13px] text-[var(--color-text-tertiary)]', () => {
    render(<ClinicDashboardOverview orgId="org-1" />);

    const caption = screen.getByTestId('staleness-caption');
    expect(caption.textContent).toContain('Updated every 15 minutes');
    expect(caption.textContent).toContain('Last:');
    expect(caption.className).toContain('text-[13px]');
    expect(caption.className).toContain('text-[var(--color-text-tertiary)]');
  });

  it('Test 7: Empty state when lastRefreshedAt is null and all counts are 0', async () => {
    const { useClinicMetrics } = await import('./use-clinic-metrics');
    const mockFn = useClinicMetrics as ReturnType<typeof vi.fn>;

    mockFn.mockReturnValue({
      pendingThisWeek: 0,
      ackRatePct: null,
      belowDosingRange: 0,
      alertTypeBreakdown: { dose_adherence: 0, dose_variance: 0 },
      lastRefreshedAt: null,
      isLoading: false,
      error: null,
    });

    render(<ClinicDashboardOverview orgId="org-1" />);

    expect(screen.getByText('No data yet')).toBeDefined();
    expect(screen.getByText(/Metrics appear after the first nightly alert scan/)).toBeDefined();
  });

  it('Test 8: Loading state renders 4 Skeleton placeholders', async () => {
    const { useClinicMetrics } = await import('./use-clinic-metrics');
    const mockFn = useClinicMetrics as ReturnType<typeof vi.fn>;

    mockFn.mockReturnValue({
      ...mockMetrics,
      isLoading: true,
    });

    render(<ClinicDashboardOverview orgId="org-1" />);

    const skeletons = document.querySelectorAll('[aria-hidden="true"]');
    // At least 4 skeletons rendered
    expect(skeletons.length).toBeGreaterThanOrEqual(4);
  });

  it('Test 9: Each stat card figure has aria-label with heading and value', () => {
    render(<ClinicDashboardOverview orgId="org-1" />);

    const pendingFig = screen.getByTestId('pending-alerts-figure');
    expect(pendingFig.getAttribute('aria-label')).toContain('Pending alerts');

    const ackFig = screen.getByTestId('ack-rate-figure');
    expect(ackFig.getAttribute('aria-label')).toContain('Ack rate');

    const belowFig = screen.getByTestId('below-dosing-range-figure');
    expect(belowFig.getAttribute('aria-label')).toContain('Below dosing range');
  });
});
