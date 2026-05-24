/**
 * Phase 51 Plan 51-09 Task 3 — TrafficTaxonomyPage unit tests.
 *
 * T1: Renders seed channel groups + referrer rules from mocked supabase.from.
 * T2: Clicking + Add channel group opens the edit Sheet with empty fields.
 * T3: Save with invalid JSON shows inline 'Match rule must be valid JSON' error.
 * T4: Delete on fallback row is HIDDEN; delete on non-fallback row triggers Confirm.
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockCg {
  id: string;
  label: string;
  priority: number;
  match_rule_jsonb: Record<string, unknown>;
  attribution_window_days: number;
  is_default_fallback: boolean;
}
interface MockRr {
  id: string;
  referrer_domain: string;
  channel_group_label: string;
  priority: number;
}

const seedCgs: MockCg[] = [
  {
    id: 'cg-1',
    label: 'Paid Search',
    priority: 10,
    match_rule_jsonb: { utm_medium: ['cpc'] },
    attribution_window_days: 30,
    is_default_fallback: false,
  },
  {
    id: 'cg-2',
    label: 'Organic Search',
    priority: 40,
    match_rule_jsonb: { utm_medium: ['organic'] },
    attribution_window_days: 60,
    is_default_fallback: false,
  },
  {
    id: 'cg-3',
    label: 'Direct',
    priority: 99,
    match_rule_jsonb: {},
    attribution_window_days: 30,
    is_default_fallback: true,
  },
];

const seedRrs: MockRr[] = [
  { id: 'rr-1', referrer_domain: 'reddit.com', channel_group_label: 'Referral', priority: 50 },
  { id: 'rr-2', referrer_domain: 'hackernews.com', channel_group_label: 'Referral', priority: 50 },
];

let mockCgs = seedCgs;
let mockRrs = seedRrs;
const rpcMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const data = table === 'channel_groups' ? mockCgs : mockRrs;
      const builder: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
          resolve({ data, error: null });
          return Promise.resolve({ data, error: null });
        },
      };
      return builder;
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

beforeEach(() => {
  mockCgs = seedCgs;
  mockRrs = seedRrs;
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('TrafficTaxonomyPage', () => {
  it('T1: renders seed channel groups + referrer rules from mocked supabase.from', async () => {
    const { TrafficTaxonomyPage } = await import('./TrafficTaxonomyPage');
    render(<TrafficTaxonomyPage />);

    await waitFor(() => {
      expect(screen.getByText('Paid Search')).toBeInTheDocument();
      expect(screen.getByText('Organic Search')).toBeInTheDocument();
      expect(screen.getByText('Direct')).toBeInTheDocument();
      expect(screen.getByText(/reddit\.com/i)).toBeInTheDocument();
      expect(screen.getByText(/hackernews\.com/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/\(fallback\)/i)).toBeInTheDocument();
  });

  it('T2: clicking + Add channel group opens the edit Sheet with empty fields', async () => {
    const { TrafficTaxonomyPage } = await import('./TrafficTaxonomyPage');
    render(<TrafficTaxonomyPage />);

    await waitFor(() => screen.getByText('Paid Search'));

    fireEvent.click(screen.getByRole('button', { name: 'Add channel group' }));

    // Sheet renders title (matches editCg.id === undefined branch)
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Add channel group/i }),
      ).toBeInTheDocument();
    });

    // Label input is empty (no label prefilled for create)
    const labelInput = screen.getByLabelText('Channel group label') as HTMLInputElement;
    expect(labelInput.value).toBe('');

    // Match-rule textarea has empty JSON object as placeholder seed.
    const matchRule = screen.getByLabelText('Match rule JSON') as HTMLTextAreaElement;
    expect(matchRule.value).toBe('{}');
  });

  it('T3: save with invalid JSON shows inline Match rule must be valid JSON error', async () => {
    const { TrafficTaxonomyPage } = await import('./TrafficTaxonomyPage');
    render(<TrafficTaxonomyPage />);

    await waitFor(() => screen.getByText('Paid Search'));

    fireEvent.click(screen.getByRole('button', { name: 'Add channel group' }));
    await waitFor(() =>
      screen.getByRole('heading', { name: /Add channel group/i }),
    );

    // Fill required text fields.
    fireEvent.change(screen.getByLabelText('Channel group label'), {
      target: { value: 'Test' },
    });

    // Type intentionally invalid JSON.
    fireEvent.change(screen.getByLabelText('Match rule JSON'), {
      target: { value: '{ this is not json' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() => {
      expect(
        screen.getByText('Match rule must be valid JSON'),
      ).toBeInTheDocument();
    });

    // RPC was not called.
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('T4: delete on fallback row is hidden; delete on non-fallback row opens Confirm', async () => {
    const { TrafficTaxonomyPage } = await import('./TrafficTaxonomyPage');
    render(<TrafficTaxonomyPage />);

    await waitFor(() => screen.getByText('Paid Search'));

    // Direct (fallback) row should NOT have a delete button — assert by aria-label.
    expect(
      screen.queryByRole('button', { name: 'Delete Direct' }),
    ).not.toBeInTheDocument();

    // Non-fallback Paid Search row HAS a Delete button.
    const deleteBtn = screen.getByRole('button', { name: 'Delete Paid Search' });
    expect(deleteBtn).toBeInTheDocument();

    fireEvent.click(deleteBtn);

    // ConfirmModal renders the title.
    await waitFor(() => {
      expect(
        screen.getByText(/Delete this channel group\?/i),
      ).toBeInTheDocument();
    });
    // Body copy contains the label.
    expect(
      screen.getByText(
        /Visits previously matched to "Paid Search" will reclassify to "Direct"/i,
      ),
    ).toBeInTheDocument();

    // Click Delete to confirm — RPC fires.
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('delete_channel_group', {
        p_id: 'cg-1',
      });
    });
  });
});
