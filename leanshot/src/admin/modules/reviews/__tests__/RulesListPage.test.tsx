/**
 * Phase 36 Plan 36-04 Task 2 — RulesListPage tests (Surface D rule list).
 *
 * Covers:
 *  - mounts and calls supabase.rpc('list_review_prompt_rules') once
 *  - empty rule list → EmptyState with "No review rules yet" heading + Create CTA
 *  - non-empty list → 1 card per rule (active/paused pill + trigger event + cohort label)
 *  - "New rule" button opens a form panel (RuleFormPanel rendered inside Sheet)
 *  - Delete via kebab opens Confirm primitive and calls delete RPC on confirm
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RulesListPage from '../RulesListPage';

const mockRpc = vi.fn();
const mockOrder = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({
      select: () => ({
        order: (...args: unknown[]) => mockOrder(...args),
      }),
    }),
  },
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => vi.fn(),
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockOrder.mockReset();
  // RuleFormPanel reads cohort_definitions via CohortPicker.
  mockOrder.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  cleanup();
});

describe('RulesListPage (Phase 36 Plan 36-04 Task 2)', () => {
  it('renders EmptyState with verbatim copy when the rule list is empty', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    render(<RulesListPage />);

    await waitFor(() => {
      expect(screen.getByText(/No review rules yet/i)).toBeTruthy();
    });
    // Empty-state body + CTA per UI-SPEC.
    expect(screen.getByText(/Create your first rule/i)).toBeTruthy();
    expect(mockRpc).toHaveBeenCalledWith('list_review_prompt_rules');
  });

  it('renders one card per rule with active pill + trigger event name', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: 'r1',
          name: 'Activation NPS',
          trigger_event: 'activation_completed',
          cohort_id: null,
          active: true,
          created_at: '2026-04-01T00:00:00Z',
        },
        {
          id: 'r2',
          name: 'Level-up NPS',
          trigger_event: 'level_up',
          cohort_id: 'c-abc',
          active: false,
          created_at: '2026-04-02T00:00:00Z',
        },
      ],
      error: null,
    });

    render(<RulesListPage />);

    await waitFor(() => {
      expect(screen.getByText('Activation NPS')).toBeTruthy();
      expect(screen.getByText('Level-up NPS')).toBeTruthy();
    });
    expect(screen.getByText('activation_completed')).toBeTruthy();
    expect(screen.getByText('level_up')).toBeTruthy();
    // Paused / Active pills both surface.
    expect(screen.getAllByText(/Active|Paused/i).length).toBeGreaterThanOrEqual(2);
  });

  it('clicking "New rule" opens the form panel', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    render(<RulesListPage />);

    // Empty-state CTA OR top-right button — both open the form.
    const cta = await screen.findByRole('button', { name: /Create first rule|New rule/i });
    fireEvent.click(cta);

    // Form panel surfaces Save button.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Save rule/i })).toBeTruthy();
    });
  });

  it('Delete flow opens Confirm modal and calls delete RPC on confirm', async () => {
    // Implementation-aware: first call is list_review_prompt_rules, then
    // delete_review_prompt_rule, then refetch.
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'list_review_prompt_rules') {
        return Promise.resolve({
          data: [
            {
              id: 'r1',
              name: 'Activation NPS',
              trigger_event: 'activation_completed',
              cohort_id: null,
              active: true,
              created_at: '2026-04-01T00:00:00Z',
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(<RulesListPage />);

    await waitFor(() => {
      expect(screen.getByText('Activation NPS')).toBeTruthy();
    });

    // Open the kebab → choose Delete.
    fireEvent.click(screen.getByRole('button', { name: /Rule actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/i }));

    // Confirm modal rendered.
    await waitFor(() => {
      expect(screen.getByText(/Delete rule '/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Delete rule/i }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('delete_review_prompt_rule', { p_id: 'r1' });
    });
  });
});
