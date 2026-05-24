/**
 * Phase 39 Plan 39-07 Task 2 — PaywallExperimentTab tests.
 *
 * Contract per <interfaces> + UI-SPEC:
 *   (a) one row per ExperimentRow with variant_name + cohort_label +
 *       composite_score formatted + BayesianBadge + refund_rate_7d when present
 *   (b) Ship-Winner button per row with data-action='ship-winner' attribute
 *   (c) clicking Ship-Winner with posterior >= 0.95 invokes onShip directly
 *   (d) clicking with posterior < 0.95 opens ShipWinnerConfirmModal
 *   (e) archived_at non-null → refund-rate kill-switch banner with
 *       'Re-enable variant' danger CTA
 *   (f) composite score callout text per UI-SPEC
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExperimentRow } from './experiment-types';
import { PaywallExperimentTab } from './PaywallExperimentTab';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }) },
  },
}));

function makeRow(overrides: Partial<ExperimentRow> = {}): ExperimentRow {
  return {
    variant_id: 'v1',
    variant_name: 'Lean Copy',
    surface: 'paywall',
    cohort_id: 'c1',
    cohort_label: 'trial-day-7',
    sample_size: 100,
    paid_rate: 0.12,
    retention_30d_rate: 0.4,
    composite_score: 0.048,
    posterior: 0.82,
    refund_rate_7d: 0.015,
    refund_rate_baseline_30d: 0.01,
    warned_at: null,
    archived_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('PaywallExperimentTab', () => {
  const onShip = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(a) renders one row per ExperimentRow with variant_name + cohort + composite + BayesianBadge + refund_rate_7d', () => {
    const rows = [makeRow({ variant_id: 'v1', variant_name: 'Lean Copy' }), makeRow({ variant_id: 'v2', variant_name: 'Transformation Copy', cohort_label: 'past-due' })];
    render(<PaywallExperimentTab rows={rows} onShip={onShip} busyKey={null} />);

    expect(screen.getByText('Lean Copy')).toBeInTheDocument();
    expect(screen.getByText('Transformation Copy')).toBeInTheDocument();
    expect(screen.getByText('trial-day-7')).toBeInTheDocument();
    expect(screen.getByText('past-due')).toBeInTheDocument();
    // BayesianBadge posterior 0.82 → "Trending (82%)"
    expect(screen.getAllByText('Trending (82%)').length).toBeGreaterThan(0);
    // Refund 7d rendered as a percent
    expect(screen.getAllByText(/1\.5%/).length).toBeGreaterThan(0);
  });

  it('(b) renders Ship-Winner button per row with data-action="ship-winner" attribute', () => {
    const rows = [makeRow()];
    const { container } = render(
      <PaywallExperimentTab rows={rows} onShip={onShip} busyKey={null} />,
    );
    const shipBtn = container.querySelector('[data-action="ship-winner"]');
    expect(shipBtn).toBeInTheDocument();
  });

  it('(c) Ship-Winner click with posterior >= 0.95 calls onShip(variantId) directly (no modal)', () => {
    const rows = [makeRow({ variant_id: 'v-high', posterior: 0.96 })];
    const { container } = render(
      <PaywallExperimentTab rows={rows} onShip={onShip} busyKey={null} />,
    );
    const shipBtn = container.querySelector('[data-action="ship-winner"]') as HTMLButtonElement;
    fireEvent.click(shipBtn);
    expect(onShip).toHaveBeenCalledWith('v-high');
    expect(
      screen.queryByText('Ship variant below 95% confidence?'),
    ).not.toBeInTheDocument();
  });

  it('(d) Ship-Winner click with posterior < 0.95 opens ShipWinnerConfirmModal', () => {
    const rows = [makeRow({ variant_id: 'v-low', posterior: 0.82 })];
    const { container } = render(
      <PaywallExperimentTab rows={rows} onShip={onShip} busyKey={null} />,
    );
    const shipBtn = container.querySelector('[data-action="ship-winner"]') as HTMLButtonElement;
    fireEvent.click(shipBtn);
    expect(
      screen.getByText('Ship variant below 95% confidence?'),
    ).toBeInTheDocument();
    // onShip NOT yet called — waits for modal confirm
    expect(onShip).not.toHaveBeenCalled();
  });

  it('(e) archived_at non-null row shows refund-rate kill banner + Re-enable variant CTA', () => {
    const rows = [
      makeRow({
        variant_id: 'v-arc',
        archived_at: '2026-05-01T00:00:00Z',
        refund_rate_7d: 0.05,
        refund_rate_baseline_30d: 0.02,
      }),
    ];
    render(<PaywallExperimentTab rows={rows} onShip={onShip} busyKey={null} />);
    expect(
      screen.getByText(/Refund rate exceeded 2× control baseline/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-enable variant' })).toBeInTheDocument();
  });

  it('(f) composite score callout shows "Composite: paid_rate × 30d_retention = N"', () => {
    const rows = [makeRow({ composite_score: 0.048 })];
    render(<PaywallExperimentTab rows={rows} onShip={onShip} busyKey={null} />);
    expect(
      screen.getByText(/Composite:.*paid_rate.*30d_retention.*=/),
    ).toBeInTheDocument();
  });

  it('renders empty when rows=[]', () => {
    render(<PaywallExperimentTab rows={[]} onShip={onShip} busyKey={null} />);
    // No row variant_name should be present
    expect(screen.queryByText('Lean Copy')).not.toBeInTheDocument();
  });

  it('busyKey matching row variant_id disables that row Ship-Winner', () => {
    const rows = [makeRow({ variant_id: 'v-busy', posterior: 0.99 })];
    const { container } = render(
      <PaywallExperimentTab rows={rows} onShip={onShip} busyKey="v-busy" />,
    );
    const shipBtn = container.querySelector('[data-action="ship-winner"]') as HTMLButtonElement;
    expect(shipBtn).toBeDisabled();
  });
});
