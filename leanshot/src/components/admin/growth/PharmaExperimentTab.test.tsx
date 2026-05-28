/**
 * Phase 39 Plan 39-08 Task 2 — PharmaExperimentTab tests.
 *
 * Contract per <interfaces> + UI-SPEC Surface G:
 *   (a) one row per PharmaExperimentRow with variant_name + sample_size +
 *       nps_delta + one_star_rate_ratio columns visible + a
 *       PharmaVariantMetricsCard preview + a "Disable variant" button
 *   (b) Disable button click opens Confirm primitive with copy:
 *       "Disable pharma variant `{variant_name}`? All traffic returns to
 *        control immediately."
 *   (c) Confirm accept calls onDisable(variantId)
 *   (d) archived_at non-null row is muted/disabled and renders no
 *       Disable button
 *   (e) PharmaVersionList preview button opens a Sheet drawer rendering
 *       the version history (versions surfaced via the row.versions field)
 *
 * Pattern: data-action="disable-variant" attribute on the button so the
 * Playwright e2e can locate it without relying on copy.
 *
 * Accent policy: UI-SPEC line 132 — no teal accent on pharma surfaces.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PharmaExperimentRow } from './experiment-types';
import { PharmaExperimentTab, type PharmaExperimentRowWithVersions } from './PharmaExperimentTab';

function makeRow(
  overrides: Partial<PharmaExperimentRowWithVersions> = {},
): PharmaExperimentRowWithVersions {
  const base: PharmaExperimentRow = {
    variant_id: 'pv1',
    variant_name: 'Tirzepatide V2',
    surface: 'pharma',
    cohort_id: null,
    cohort_label: null,
    sample_size: 42,
    paid_rate: null,
    retention_30d_rate: null,
    composite_score: null,
    posterior: 0,
    refund_rate_7d: null,
    refund_rate_baseline_30d: null,
    warned_at: null,
    archived_at: null,
    created_at: '2026-05-22T00:00:00Z',
    nps_delta: 3.2,
    one_star_rate_ratio: 1.4,
    safety_categories_in_variant: [],
  };
  return { ...base, versions: [], ...overrides };
}

describe('PharmaExperimentTab', () => {
  const onDisable = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(a) renders one row per row with variant_name + sample_size + metrics + Disable button', () => {
    const rows = [
      makeRow({ variant_id: 'pv1', variant_name: 'Tirz V2', sample_size: 42 }),
      makeRow({ variant_id: 'pv2', variant_name: 'Sema V3', sample_size: 18 }),
    ];
    const { container } = render(
      <PharmaExperimentTab rows={rows} onDisable={onDisable} busyKey={null} />,
    );
    expect(screen.getByText('Tirz V2')).toBeInTheDocument();
    expect(screen.getByText('Sema V3')).toBeInTheDocument();
    // sample_size rendered with the count visible
    expect(screen.getAllByText('42').length).toBeGreaterThan(0);
    // Disable variant buttons (one per active row)
    const disables = container.querySelectorAll('[data-action="disable-variant"]');
    expect(disables.length).toBe(2);
    // UI-SPEC line 205 copy
    expect(screen.getAllByText('Disable variant').length).toBeGreaterThan(0);
  });

  it('(b) Disable click opens Confirm modal with UI-SPEC verbatim copy', () => {
    const rows = [makeRow({ variant_id: 'pv1', variant_name: 'Tirz V2' })];
    const { container } = render(
      <PharmaExperimentTab rows={rows} onDisable={onDisable} busyKey={null} />,
    );
    const disableBtn = container.querySelector(
      '[data-action="disable-variant"]',
    ) as HTMLButtonElement;
    fireEvent.click(disableBtn);
    // UI-SPEC line 206 copy
    expect(
      screen.getByText(
        /Disable pharma variant `Tirz V2`\? All traffic returns to control immediately\./,
      ),
    ).toBeInTheDocument();
  });

  it('(c) Confirm accept calls onDisable(variantId)', () => {
    const rows = [makeRow({ variant_id: 'pv1' })];
    const { container } = render(
      <PharmaExperimentTab rows={rows} onDisable={onDisable} busyKey={null} />,
    );
    const disableBtn = container.querySelector(
      '[data-action="disable-variant"]',
    ) as HTMLButtonElement;
    fireEvent.click(disableBtn);
    // Confirm primitive renders the destructive button labeled "Disable variant"
    // (UI-SPEC line 206). Pick the LAST one (inside the modal) — the row button
    // is also present.
    const confirmBtns = screen.getAllByRole('button', { name: 'Disable variant' });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);
    expect(onDisable).toHaveBeenCalledWith('pv1');
  });

  it('(d) archived row is muted and renders no Disable button', () => {
    const rows = [
      makeRow({
        variant_id: 'pv1',
        variant_name: 'Archived V',
        archived_at: '2026-05-21T00:00:00Z',
      }),
    ];
    const { container } = render(
      <PharmaExperimentTab rows={rows} onDisable={onDisable} busyKey={null} />,
    );
    expect(screen.getByText('Archived V')).toBeInTheDocument();
    expect(container.querySelector('[data-action="disable-variant"]')).toBeNull();
    // Visible "Disabled" badge or marker
    expect(screen.getByText(/Disabled/i)).toBeInTheDocument();
  });

  it('(e) version-history button opens Sheet drawer with version history', () => {
    const rows = [
      makeRow({
        variant_id: 'pv1',
        versions: [
          {
            id: 'ver-1',
            content_id: 'content-1',
            diff: {},
            author_id: 'a-1',
            author_name: 'Alice',
            clinical_signoff_by: null,
            clinical_signoff_at: null,
            clinical_signoff_name: null,
            created_at: '2026-05-22T00:00:00Z',
          },
        ],
      }),
    ];
    const { container } = render(
      <PharmaExperimentTab rows={rows} onDisable={onDisable} busyKey={null} />,
    );
    const historyBtn = container.querySelector(
      '[data-action="open-version-history"]',
    ) as HTMLButtonElement;
    expect(historyBtn).toBeInTheDocument();
    fireEvent.click(historyBtn);
    // Sheet renders the PharmaVersionList header text from inside the drawer
    expect(screen.getByText('Pharma content versions')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('busyKey disables the targeted row Disable button', () => {
    const rows = [makeRow({ variant_id: 'pv1' })];
    const { container } = render(
      <PharmaExperimentTab rows={rows} onDisable={onDisable} busyKey="pv1" />,
    );
    const disableBtn = container.querySelector(
      '[data-action="disable-variant"]',
    ) as HTMLButtonElement;
    expect(disableBtn).toBeDisabled();
  });

  it('no teal/accent class on the tab (UI-SPEC line 132)', () => {
    const rows = [makeRow()];
    const { container } = render(
      <PharmaExperimentTab rows={rows} onDisable={onDisable} busyKey={null} />,
    );
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toMatch(/teal/);
    expect(html).not.toMatch(/--color-accent[^-]/);
  });
});
