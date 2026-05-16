/**
 * Phase 22 Plan 22-06 — MemberFlagsTab tests (ADMIN-05 D-08).
 *
 * Covers:
 *   T1: lists each flag with name + default + "Overridden" badge where applicable
 *   T2: "Set override" click calls admin_set_feature_flag_override RPC
 *   T3: post-save fetches overrides again and shows "Overridden" badge
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberFlagsTab } from '@/components/admin/members/MemberFlagsTab';

const mockRpc = vi.fn();
const mockFeatureFlagsSelect = vi.fn();
const mockOverridesEq = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, params: unknown) => mockRpc(name, params),
    from: (table: string) => {
      if (table === 'feature_flags') {
        return { select: () => mockFeatureFlagsSelect() };
      }
      if (table === 'feature_flag_overrides') {
        return { select: () => ({ eq: () => mockOverridesEq() }) };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  },
}));

describe('<MemberFlagsTab /> — Phase 22 Plan 22-06', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T1 — lists every flag with its default + flags with overrides show "Overridden" badge', async () => {
    mockFeatureFlagsSelect.mockResolvedValue({
      data: [
        { key: 'aff_manual_entry', enabled: false },
        { key: 'share_link_v2', enabled: true },
      ],
      error: null,
    });
    mockOverridesEq.mockResolvedValue({
      data: [
        {
          flag_key: 'aff_manual_entry',
          value: true,
          expires_at: new Date(Date.now() + 86400_000).toISOString(),
        },
      ],
      error: null,
    });

    render(<MemberFlagsTab userId="u-1" />);
    await waitFor(() => expect(screen.getByTestId('flag-row-aff_manual_entry')).toBeInTheDocument());

    const overriddenRow = screen.getByTestId('flag-row-aff_manual_entry');
    expect(within(overriddenRow).getByText('Overridden')).toBeInTheDocument();

    const cleanRow = screen.getByTestId('flag-row-share_link_v2');
    expect(within(cleanRow).queryByText('Overridden')).not.toBeInTheDocument();
  });

  it('T2 — "Set override" click invokes admin_set_feature_flag_override RPC', async () => {
    mockFeatureFlagsSelect.mockResolvedValue({
      data: [{ key: 'aff_manual_entry', enabled: false }],
      error: null,
    });
    mockOverridesEq.mockResolvedValue({ data: [], error: null });
    mockRpc.mockResolvedValue({ data: null, error: null });

    const user = userEvent.setup();
    render(<MemberFlagsTab userId="u-1" />);
    await waitFor(() => expect(screen.getByTestId('flag-row-aff_manual_entry')).toBeInTheDocument());

    // Toggle On + click save.
    await user.click(screen.getByTestId('flag-on-aff_manual_entry'));
    await user.click(screen.getByTestId('flag-save-aff_manual_entry'));

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith(
        'admin_set_feature_flag_override',
        expect.objectContaining({
          p_user_id: 'u-1',
          p_flag_key: 'aff_manual_entry',
          p_value: true,
        }),
      ),
    );
    // p_expires_at must be an ISO timestamp string.
    const [, params] = mockRpc.mock.calls[0]!;
    expect(typeof (params as { p_expires_at?: unknown }).p_expires_at).toBe('string');
  });

  it('T3 — post-save, success status announced; refetch triggered', async () => {
    mockFeatureFlagsSelect.mockResolvedValue({
      data: [{ key: 'aff_manual_entry', enabled: false }],
      error: null,
    });
    // First overrides fetch = none; second (post-save) = active override.
    mockOverridesEq
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValue({
        data: [
          {
            flag_key: 'aff_manual_entry',
            value: true,
            expires_at: new Date(Date.now() + 86400_000).toISOString(),
          },
        ],
        error: null,
      });
    mockRpc.mockResolvedValue({ data: null, error: null });

    const user = userEvent.setup();
    render(<MemberFlagsTab userId="u-1" />);
    await waitFor(() => expect(screen.getByTestId('flag-row-aff_manual_entry')).toBeInTheDocument());

    await user.click(screen.getByTestId('flag-on-aff_manual_entry'));
    await user.click(screen.getByTestId('flag-save-aff_manual_entry'));

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/Override set/i),
    );
    // Badge appears after the refetch.
    await waitFor(() =>
      expect(within(screen.getByTestId('flag-row-aff_manual_entry')).getByText('Overridden')).toBeInTheDocument(),
    );
  });
});
