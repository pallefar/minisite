/**
 * Phase 39 Plan 39-07 Task 2 — PageExperimentTab tests.
 *
 * Contract per <interfaces> + UI-SPEC + D-11:
 *   (a) 35-day warn banner when warned_at != null AND archived_at == null
 *   (b) 42-day archived banner when archived_at != null with copy
 *       'This variant was auto-archived on {date}. Traffic is back on control.'
 *   (c) Ship-Winner per row reuses the same confirm-modal cascade as Paywall
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExperimentRow } from './experiment-types';
import { PageExperimentTab } from './PageExperimentTab';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }) },
  },
}));

function makeRow(overrides: Partial<ExperimentRow> = {}): ExperimentRow {
  return {
    variant_id: 'pv1',
    variant_name: 'Hero V2',
    surface: 'page',
    cohort_id: null,
    cohort_label: null,
    sample_size: 500,
    paid_rate: null,
    retention_30d_rate: null,
    composite_score: 0.05,
    posterior: 0.91,
    refund_rate_7d: null,
    refund_rate_baseline_30d: null,
    warned_at: null,
    archived_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('PageExperimentTab', () => {
  const onShip = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(a) 35-day warn banner when warned_at != null AND archived_at == null', () => {
    const rows = [
      makeRow({
        variant_id: 'pv-warn',
        warned_at: '2026-05-15T00:00:00Z',
        archived_at: null,
      }),
    ];
    render(<PageExperimentTab rows={rows} onShip={onShip} busyKey={null} />);
    expect(
      screen.getByText(/This variant auto-archives in/),
    ).toBeInTheDocument();
  });

  it('(b) 42-day archived banner when archived_at != null with exact UI-SPEC copy', () => {
    const rows = [
      makeRow({
        variant_id: 'pv-arc',
        archived_at: '2026-05-20T12:00:00Z',
        warned_at: '2026-05-13T00:00:00Z',
      }),
    ];
    render(<PageExperimentTab rows={rows} onShip={onShip} busyKey={null} />);
    expect(
      screen.getByText(/This variant was auto-archived on .* Traffic is back on control/),
    ).toBeInTheDocument();
  });

  it('warn banner does NOT show when archived_at also set (archived takes precedence)', () => {
    const rows = [
      makeRow({
        variant_id: 'pv-both',
        warned_at: '2026-05-13T00:00:00Z',
        archived_at: '2026-05-20T00:00:00Z',
      }),
    ];
    render(<PageExperimentTab rows={rows} onShip={onShip} busyKey={null} />);
    expect(
      screen.queryByText(/This variant auto-archives in/),
    ).not.toBeInTheDocument();
  });

  it('(c) Ship-Winner click with posterior < 0.95 opens ShipWinnerConfirmModal', () => {
    const rows = [makeRow({ variant_id: 'pv-low', posterior: 0.88 })];
    const { container } = render(
      <PageExperimentTab rows={rows} onShip={onShip} busyKey={null} />,
    );
    const shipBtn = container.querySelector('[data-action="ship-winner"]') as HTMLButtonElement;
    fireEvent.click(shipBtn);
    expect(
      screen.getByText('Ship variant below 95% confidence?'),
    ).toBeInTheDocument();
  });

  it('(c) Ship-Winner click with posterior >= 0.95 calls onShip directly', () => {
    const rows = [makeRow({ variant_id: 'pv-high', posterior: 0.97 })];
    const { container } = render(
      <PageExperimentTab rows={rows} onShip={onShip} busyKey={null} />,
    );
    const shipBtn = container.querySelector('[data-action="ship-winner"]') as HTMLButtonElement;
    fireEvent.click(shipBtn);
    expect(onShip).toHaveBeenCalledWith('pv-high');
  });

  it('Ship-Winner button has data-action="ship-winner" attribute', () => {
    const rows = [makeRow()];
    const { container } = render(
      <PageExperimentTab rows={rows} onShip={onShip} busyKey={null} />,
    );
    const shipBtn = container.querySelector('[data-action="ship-winner"]');
    expect(shipBtn).toBeInTheDocument();
  });
});
