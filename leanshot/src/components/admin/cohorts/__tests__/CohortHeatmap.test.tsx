/**
 * Phase 22 Plan 22-08 — CohortHeatmap behavior tests (ADMIN-08).
 *
 * Replaces Wave 0 scaffold (plan 22-01) — impl owner is now 22-08, not 22-06.
 *
 * Coverage per plan 22-08 <behavior>:
 *   T1: CSS-grid container uses grid-cols-[120px_repeat(91,_minmax(8px,_1fr))].
 *   T2: 13 cohort rows × 91 day cells = 1183 cells when full 13×91 data.
 *   T3: cell with retention_pct = 80 uses inline color-mix style.
 *   T4: k-anonymity — cell with active_users < 10 renders "<10" (T-22-10 guard).
 *   T5: tooltip text format matches UI-SPEC line 546.
 *   T6: empty state when no rows.
 *   T7: legend renders with 5 tick marks (0/25/50/75/100).
 *   T8: cells have descriptive aria-label.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CohortHeatmap, type CohortCell } from '@/components/admin/cohorts/CohortHeatmap';

function makeRows(weeks: number, daysPerWeek: number, fixed?: Partial<CohortCell>): CohortCell[] {
  const rows: CohortCell[] = [];
  const baseDate = new Date('2026-05-04'); // Monday
  for (let w = 0; w < weeks; w++) {
    const cohortStart = new Date(baseDate.getTime() - w * 7 * 86_400_000);
    const cohortWeek = cohortStart.toISOString().slice(0, 10);
    for (let d = 0; d < daysPerWeek; d++) {
      rows.push({
        cohort_week: cohortWeek,
        day_offset: d,
        active_users: fixed?.active_users ?? 50,
        retention_pct: fixed?.retention_pct ?? 75,
        cohort_size: fixed?.cohort_size ?? 100,
      });
    }
  }
  return rows;
}

describe('<CohortHeatmap /> — Plan 22-08 (ADMIN-08)', () => {
  it('T1 — container uses CSS-grid with 120px label + repeat(91, minmax(8px, 1fr))', () => {
    render(<CohortHeatmap rows={makeRows(1, 91)} />);
    const grid = screen.getByTestId('cohort-heatmap-grid');
    expect(grid.className).toMatch(/grid-cols-\[120px_repeat\(91,_minmax\(8px,_1fr\)\)\]/);
  });

  it('T2 — 13 cohort rows × 91 day cells renders 1183 data cells + 13 label cells', () => {
    render(<CohortHeatmap rows={makeRows(13, 91)} />);
    const dataCells = screen.getAllByTestId(/^cohort-cell-/);
    expect(dataCells).toHaveLength(13 * 91);
    const labelCells = screen.getAllByTestId(/^cohort-row-label-/);
    expect(labelCells).toHaveLength(13);
  });

  it('T3 — cell with retention_pct = 80 uses inline color-mix style with 80%', () => {
    render(<CohortHeatmap rows={makeRows(1, 1, { retention_pct: 80, active_users: 50 })} />);
    const cell = screen.getByTestId(/^cohort-cell-/);
    const style = cell.getAttribute('style') ?? '';
    expect(style).toContain('color-mix');
    expect(style).toContain('80%');
    expect(style).toContain('var(--color-primary)');
    expect(style).toContain('var(--color-surface)');
  });

  it('T4 — k-anonymity: active_users < 10 cell renders "<10" instead of exact count', () => {
    const rows = makeRows(1, 1, { active_users: 7, retention_pct: 7, cohort_size: 100 });
    render(<CohortHeatmap rows={rows} />);
    const cell = screen.getByTestId(/^cohort-cell-/);
    expect(within(cell).getByText('<10')).toBeInTheDocument();
    // aria-label should signal privacy suppression.
    expect(cell.getAttribute('aria-label')).toMatch(/Hidden for privacy|<10/i);
  });

  it('T5 — tooltip (title attr) format matches UI-SPEC line 546', () => {
    const rows = makeRows(1, 1, { active_users: 50, retention_pct: 50, cohort_size: 100 });
    render(<CohortHeatmap rows={rows} />);
    const cell = screen.getByTestId(/^cohort-cell-/);
    const title = cell.getAttribute('title') ?? '';
    // UI-SPEC line 546: "{pct}% retention · {active_users}/{cohort_size} users active on day {day} of cohort starting {date}"
    expect(title).toMatch(/50% retention/);
    expect(title).toMatch(/50\/100 users/);
    expect(title).toMatch(/day 0/);
    expect(title).toMatch(/cohort starting/);
  });

  it('T6 — empty state when no rows', () => {
    render(<CohortHeatmap rows={[]} />);
    expect(screen.getByText(/No cohort data yet/i)).toBeInTheDocument();
    expect(screen.getByText(/refreshes daily at 02:00 UTC/i)).toBeInTheDocument();
  });

  it('T7 — legend renders with 5 tick marks (0/25/50/75/100)', () => {
    render(<CohortHeatmap rows={makeRows(1, 1)} />);
    const legend = screen.getByTestId('cohort-heatmap-legend');
    for (const tick of ['0%', '25%', '50%', '75%', '100%']) {
      expect(within(legend).getByText(tick)).toBeInTheDocument();
    }
  });

  it('T8 — non-suppressed cell has descriptive aria-label including pct, users, day', () => {
    const rows = makeRows(1, 1, { active_users: 42, retention_pct: 42, cohort_size: 100 });
    render(<CohortHeatmap rows={rows} />);
    const cell = screen.getByTestId(/^cohort-cell-/);
    const aria = cell.getAttribute('aria-label') ?? '';
    expect(aria).toMatch(/42/);
    expect(aria).toMatch(/day 0/);
  });
});
