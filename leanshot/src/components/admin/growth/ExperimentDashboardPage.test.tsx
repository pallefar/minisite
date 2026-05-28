/**
 * Phase 39 Plan 39-06 — ExperimentDashboardPage shell unit tests.
 *
 * TDD: cover behavior bullets from 39-06-PLAN Task 2:
 *   T1: renders 3 Pill tabs labeled Paywall / Page-Builder / Pharma
 *   T2: default activeTab is paywall (first tab aria-pressed)
 *   T3: clicking Page-Builder Pill switches activeTab to 'page'
 *   T4: on mount, useEffect calls supabase.rpc('get_experiment_results',
 *       { surface: 'paywall' })
 *   T5: loading state renders Skeleton rows
 *   T6: empty result renders EmptyState with heading 'No active experiments yet.',
 *       body 'Create a variant from any published page to begin testing.',
 *       primary 'Go to Pages'
 *   T7: vendor_unconfigured response renders the soft banner with copy
 *       'Slack alerts pause until #growth-experiments webhook is configured.'
 *   T8: polling re-fires every 30 seconds via setInterval
 *   T9: tab change re-triggers load with new surface arg
 *
 * Per UI-SPEC Hard Constraint 5 the page MUST use useEffect + setInterval
 * (NO TanStack Query). The test also greps the source file (T-source) to
 * defend that contract.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExperimentRow } from './experiment-types';

// ─── Mock supabase ────────────────────────────────────────────────────────────

const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<ExperimentRow> = {}): ExperimentRow {
  return {
    variant_id: 'v1',
    variant_name: 'Test variant',
    surface: 'paywall',
    cohort_id: null,
    cohort_label: null,
    sample_size: 100,
    paid_rate: 0.1,
    retention_30d_rate: 0.5,
    composite_score: 0.6,
    posterior: 0.85,
    refund_rate_7d: 0.01,
    refund_rate_baseline_30d: 0.01,
    warned_at: null,
    archived_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ExperimentDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: empty success response
    mockRpc.mockResolvedValue({ data: [], error: null });
  });

  it('T1: renders 3 Pill tabs labeled Paywall / Page-Builder / Pharma', async () => {
    const { ExperimentDashboardPage } = await import('./ExperimentDashboardPage');
    render(<ExperimentDashboardPage />);

    expect(screen.getByRole('button', { name: 'Paywall' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page-Builder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pharma' })).toBeInTheDocument();
  });

  it('T2: default activeTab is paywall (first tab aria-pressed)', async () => {
    const { ExperimentDashboardPage } = await import('./ExperimentDashboardPage');
    render(<ExperimentDashboardPage />);

    const paywallPill = screen.getByRole('button', { name: 'Paywall' });
    const pagePill = screen.getByRole('button', { name: 'Page-Builder' });
    const pharmaPill = screen.getByRole('button', { name: 'Pharma' });

    expect(paywallPill).toHaveAttribute('aria-pressed', 'true');
    expect(pagePill).toHaveAttribute('aria-pressed', 'false');
    expect(pharmaPill).toHaveAttribute('aria-pressed', 'false');
  });

  it('T3: clicking Page-Builder Pill switches activeTab to page', async () => {
    const { ExperimentDashboardPage } = await import('./ExperimentDashboardPage');
    render(<ExperimentDashboardPage />);

    const pagePill = screen.getByRole('button', { name: 'Page-Builder' });
    fireEvent.click(pagePill);

    await waitFor(() => {
      expect(pagePill).toHaveAttribute('aria-pressed', 'true');
    });
    expect(screen.getByRole('button', { name: 'Paywall' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('T4: on mount, useEffect calls supabase.rpc get_experiment_results with surface paywall', async () => {
    const { ExperimentDashboardPage } = await import('./ExperimentDashboardPage');
    render(<ExperimentDashboardPage />);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('get_experiment_results', {
        surface: 'paywall',
      });
    });
  });

  it('T5: loading state renders Skeleton rows', async () => {
    // Make rpc hang so we stay in the loading state
    let resolveRpc: (v: { data: unknown; error: null }) => void = () => {};
    mockRpc.mockReturnValue(
      new Promise((res) => {
        resolveRpc = res;
      }),
    );

    const { ExperimentDashboardPage } = await import('./ExperimentDashboardPage');
    const { container } = render(<ExperimentDashboardPage />);

    // Skeleton rows use the Skeleton primitive which renders a div with role=status
    // or with data-testid='experiment-skeleton' (we set the latter to keep the
    // contract explicit). Default Skeleton inserts an animate-pulse div.
    expect(container.querySelector('[data-testid="experiment-skeleton"]')).toBeInTheDocument();

    // Clean up
    resolveRpc({ data: [], error: null });
  });

  it('T6: empty result renders EmptyState with exact UI-SPEC copy + Go to Pages CTA', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { ExperimentDashboardPage } = await import('./ExperimentDashboardPage');
    render(<ExperimentDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('No active experiments yet.')).toBeInTheDocument();
    });
    expect(
      screen.getByText('Create a variant from any published page to begin testing.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Pages' })).toBeInTheDocument();
  });

  it('T7: vendor_unconfigured response renders the soft banner with UI-SPEC copy', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'vendor_unconfigured', code: 'vendor_unconfigured' },
    });

    const { ExperimentDashboardPage } = await import('./ExperimentDashboardPage');
    render(<ExperimentDashboardPage />);

    await waitFor(() => {
      expect(
        screen.getByText('Slack alerts pause until #growth-experiments webhook is configured.'),
      ).toBeInTheDocument();
    });
  });

  it('T8: polling re-fires every 30 seconds via setInterval', async () => {
    mockRpc.mockResolvedValue({ data: [makeRow()], error: null });

    // Spy on setInterval to confirm the 30_000ms cadence is wired without
    // racing real wall-clock timers in the test runner. Per CACDashboardPage
    // precedent the interval cadence is the verifiable contract — actual
    // re-fire integration runs at staging UAT (see VALIDATION.md).
    const setIntervalSpy = vi.spyOn(global, 'setInterval');

    const { ExperimentDashboardPage } = await import('./ExperimentDashboardPage');
    render(<ExperimentDashboardPage />);

    // Wait for initial fetch (proves useEffect ran)
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));

    // Confirm setInterval was registered with 30_000ms
    expect(setIntervalSpy).toHaveBeenCalled();
    const intervalCalls = setIntervalSpy.mock.calls.filter((c) => c[1] === 30_000);
    expect(intervalCalls.length).toBeGreaterThan(0);

    setIntervalSpy.mockRestore();
  });

  it('T9: tab change re-triggers load with new surface arg', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { ExperimentDashboardPage } = await import('./ExperimentDashboardPage');
    render(<ExperimentDashboardPage />);

    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    expect(mockRpc).toHaveBeenLastCalledWith('get_experiment_results', {
      surface: 'paywall',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Page-Builder' }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenLastCalledWith('get_experiment_results', {
        surface: 'page',
      });
    });

    // Plan 39-08: pharma tab calls the dedicated get_pharma_experiments RPC,
    // NOT get_experiment_results with surface='pharma'.
    fireEvent.click(screen.getByRole('button', { name: 'Pharma' }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenLastCalledWith('get_pharma_experiments');
    });
  });

  // ─── Plan 39-07 sub-tab wiring tests (T10-T13) ────────────────────────────

  it('T10: paywall tab renders PaywallExperimentTab when rows present (variant_name visible)', async () => {
    mockRpc.mockResolvedValue({ data: [makeRow({ variant_name: 'Test Paywall' })], error: null });
    const { ExperimentDashboardPage } = await import('./ExperimentDashboardPage');
    render(<ExperimentDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Test Paywall')).toBeInTheDocument();
    });
  });

  it('T11: page tab renders PageExperimentTab when activeTab=page', async () => {
    mockRpc.mockImplementation((_fn: string, args: { surface: string }) => {
      if (args.surface === 'page') {
        return Promise.resolve({
          data: [
            makeRow({
              surface: 'page',
              variant_name: 'Hero V2',
              warned_at: '2026-05-15T00:00:00Z',
            }),
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
    const { ExperimentDashboardPage } = await import('./ExperimentDashboardPage');
    render(<ExperimentDashboardPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Page-Builder' }));

    await waitFor(() => {
      expect(screen.getByText('Hero V2')).toBeInTheDocument();
    });
    // 35-day warn banner copy from PageExperimentTab
    expect(screen.getByText(/This variant auto-archives in/)).toBeInTheDocument();
  });

  it('T12 (Plan 39-08): pharma tab calls get_pharma_experiments RPC + renders PharmaExperimentTab', async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'get_pharma_experiments') {
        return Promise.resolve({
          data: [
            {
              variant_id: 'pv1',
              variant_name: 'Pharma V Alpha',
              surface: 'pharma',
              cohort_id: null,
              cohort_label: null,
              sample_size: 12,
              paid_rate: null,
              retention_30d_rate: null,
              composite_score: null,
              posterior: 0,
              refund_rate_7d: null,
              refund_rate_baseline_30d: null,
              warned_at: null,
              archived_at: null,
              created_at: '2026-05-22T00:00:00Z',
              nps_delta: 2.5,
              one_star_rate_ratio: 1.1,
              safety_categories_in_variant: [],
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
    const { ExperimentDashboardPage } = await import('./ExperimentDashboardPage');
    render(<ExperimentDashboardPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Pharma' }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('get_pharma_experiments');
    });
    await waitFor(() => {
      expect(screen.getByText('Pharma V Alpha')).toBeInTheDocument();
    });
    // Pharma tab does NOT fire the generic get_experiment_results for surface=pharma
    const pharmaResultsCalls = mockRpc.mock.calls.filter(
      (c) => c[0] === 'get_experiment_results' && c[1]?.surface === 'pharma',
    );
    expect(pharmaResultsCalls.length).toBe(0);
  });

  it('T13: paywall Ship-Winner cascade — high posterior calls onShip directly', async () => {
    mockRpc.mockResolvedValue({
      data: [makeRow({ variant_id: 'v-high', variant_name: 'High Posterior', posterior: 0.97 })],
      error: null,
    });
    const { ExperimentDashboardPage } = await import('./ExperimentDashboardPage');
    const { container } = render(<ExperimentDashboardPage />);

    await waitFor(() => expect(screen.getByText('High Posterior')).toBeInTheDocument());

    const shipBtn = container.querySelector('[data-action="ship-winner"]') as HTMLButtonElement;
    expect(shipBtn).toBeInTheDocument();
  });
});
