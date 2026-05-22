/**
 * Phase 36 Plan 36-04 Task 2 — RuleFormPanel tests (Surface D form).
 *
 * Covers:
 *  - Trigger picker is filtered to EVENTS where nps_trigger_eligible === true
 *  - Form has EXACTLY 1 trigger field + 1 cohort field (no AND/OR composition — D-02)
 *  - Save click invokes create_review_prompt_rule with the right payload
 *  - If no events are flagged nps_trigger_eligible, the fallback message renders
 *    and the Save button is disabled
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RuleFormPanel from '../RuleFormPanel';

const mockRpc = vi.fn();
const mockOrder = vi.fn();
const mockToast = vi.fn();

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
  useToast: () => mockToast,
}));

// Mock events module so we can control which events have nps_trigger_eligible set.
const mockEventsControl: { events: Record<string, unknown> } = { events: {} };
vi.mock('@/lib/analytics/events', () => ({
  get EVENTS() {
    return mockEventsControl.events;
  },
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockOrder.mockReset();
  mockToast.mockReset();
  mockOrder.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  cleanup();
});

describe('RuleFormPanel (Phase 36 Plan 36-04 Task 2 — D-02 single-condition)', () => {
  it('renders ONLY events with nps_trigger_eligible=true in the trigger picker', () => {
    mockEventsControl.events = {
      activation_completed: {
        name: 'activation_completed',
        description: 'User completed activation',
        nps_trigger_eligible: true,
      },
      payment_failed: {
        name: 'payment_failed',
        description: 'Payment failed',
        // no nps_trigger_eligible
      },
      level_up: {
        name: 'level_up',
        description: 'User levelled up',
        nps_trigger_eligible: true,
      },
    };

    render(<RuleFormPanel open onSave={() => undefined} onCancel={() => undefined} />);

    const select = screen.getByLabelText(/Trigger event/i) as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(options).toContain('activation_completed');
    expect(options).toContain('level_up');
    expect(options).not.toContain('payment_failed');
  });

  it('renders EXACTLY one trigger picker + one cohort picker — no AND/OR composition (D-02)', async () => {
    mockEventsControl.events = {
      activation_completed: {
        name: 'activation_completed',
        description: 'User completed activation',
        nps_trigger_eligible: true,
      },
    };

    const { container } = render(
      <RuleFormPanel open onSave={() => undefined} onCancel={() => undefined} />,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Cohort filter/i).length).toBe(1);
    });
    expect(screen.getAllByLabelText(/Trigger event/i).length).toBe(1);
    // D-02 enforcement: there must be NO "add condition" or AND/OR buttons.
    const addClause = container.querySelectorAll(
      'button[aria-label*="add condition" i], [data-clause-op="and"], [data-clause-op="or"]',
    );
    expect(addClause.length).toBe(0);
  });

  it('renders fallback message + disables Save when no trigger-eligible events exist', () => {
    mockEventsControl.events = {
      payment_failed: {
        name: 'payment_failed',
        description: 'Payment failed',
      },
    };

    render(<RuleFormPanel open onSave={() => undefined} onCancel={() => undefined} />);

    expect(screen.getByText(/No trigger-eligible events registered/i)).toBeTruthy();
    const saveBtn = screen.getByRole('button', { name: /Save rule/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('Save click calls create_review_prompt_rule with the form payload', async () => {
    mockEventsControl.events = {
      activation_completed: {
        name: 'activation_completed',
        description: 'User completed activation',
        nps_trigger_eligible: true,
      },
    };
    mockRpc.mockResolvedValueOnce({ data: 'new-rule-id', error: null });

    const onSave = vi.fn();
    render(<RuleFormPanel open onSave={onSave} onCancel={() => undefined} />);

    // Fill name.
    fireEvent.change(screen.getByLabelText(/Rule name/i), {
      target: { value: 'Post-activation NPS' },
    });

    // Save.
    fireEvent.click(screen.getByRole('button', { name: /Save rule/i }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith(
        'create_review_prompt_rule',
        expect.objectContaining({
          p_name: 'Post-activation NPS',
          p_trigger_event: 'activation_completed',
        }),
      );
    });
    expect(onSave).toHaveBeenCalled();
  });
});
