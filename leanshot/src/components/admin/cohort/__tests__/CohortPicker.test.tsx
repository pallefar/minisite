/**
 * Phase 36 Plan 36-04 Task 1 — CohortPicker primitive tests.
 *
 * CohortPicker is a thin wrapper over the existing AdminCohortList that exposes
 * single-select behavior for the rule-builder form (Pitfall 5 — UI-SPEC
 * referenced this primitive but it didn't exist).
 *
 * Contract:
 *  - Props: { value: string | null; onChange: (cohortId: string | null) => void; placeholder?: string }.
 *  - Renders a list of cohort_definitions rows (active or draft); empty list → "No cohorts available" message.
 *  - Clicking a row calls onChange(cohort.id).
 *  - "Clear selection (all users)" affordance calls onChange(null).
 *  - The currently-selected row is visually distinguished (data-selected="true").
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CohortPicker } from '../CohortPicker';

const mockOrder = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        order: (...args: unknown[]) => mockOrder(...args),
      }),
    }),
  },
}));

beforeEach(() => {
  mockOrder.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('CohortPicker (Phase 36 Plan 36-04 Task 1 — Pitfall 5 fix)', () => {
  it('renders empty-state copy when no cohorts exist', async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });
    render(<CohortPicker value={null} onChange={() => undefined} />);
    await waitFor(() => {
      expect(screen.getByText(/no cohorts available/i)).toBeTruthy();
    });
  });

  it('renders rows from the cohort table and lets the user pick one', async () => {
    mockOrder.mockResolvedValue({
      data: [
        { id: 'c1', name: 'High intent', status: 'active', created_at: '2026-01-01T00:00:00Z' },
        { id: 'c2', name: 'B2B clinic', status: 'active', created_at: '2026-01-02T00:00:00Z' },
        { id: 'c3', name: 'Draft cohort', status: 'draft', created_at: '2026-01-03T00:00:00Z' },
      ],
      error: null,
    });

    const onChange = vi.fn();
    render(<CohortPicker value={null} onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByText('High intent')).toBeTruthy();
      expect(screen.getByText('B2B clinic')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('B2B clinic'));
    expect(onChange).toHaveBeenCalledWith('c2');
  });

  it('exposes a "clear selection" affordance that resets value to null', async () => {
    mockOrder.mockResolvedValue({
      data: [
        { id: 'c1', name: 'Solo users', status: 'active', created_at: '2026-01-01T00:00:00Z' },
      ],
      error: null,
    });

    const onChange = vi.fn();
    render(<CohortPicker value="c1" onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('cohort-picker-row-c1')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('marks the currently selected row with data-selected="true"', async () => {
    mockOrder.mockResolvedValue({
      data: [
        { id: 'c1', name: 'Alpha', status: 'active', created_at: '2026-01-01T00:00:00Z' },
        { id: 'c2', name: 'Beta', status: 'active', created_at: '2026-01-02T00:00:00Z' },
      ],
      error: null,
    });

    render(<CohortPicker value="c2" onChange={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByTestId('cohort-picker-row-c2')).toBeTruthy();
    });

    const selectedRow = screen.getByTestId('cohort-picker-row-c2');
    expect(selectedRow.getAttribute('data-selected')).toBe('true');
    const otherRow = screen.getByTestId('cohort-picker-row-c1');
    expect(otherRow.getAttribute('data-selected')).toBe('false');
  });
});
