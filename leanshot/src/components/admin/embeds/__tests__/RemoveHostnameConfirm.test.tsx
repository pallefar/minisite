/**
 * Phase 41 Plan 41-06 — RemoveHostnameConfirm RTL tests.
 *
 * 4 behaviors per PLAN.md §Task 1 <behavior>:
 *   T1 (0 refs): title + body variant + confirm CTA "Remove hostname"
 *   T2 (>=1 refs): plural body variant + --color-danger-soft banner
 *   T3 (cancel): Cancel button label "Keep on allowlist"
 *   T4 (confirm): removeHostname called + Toast success + onRemoved fires
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRemoveHostname = vi.fn();

vi.mock('@/lib/admin/iframe-allowlist', () => ({
  removeHostname: (...args: unknown[]) => mockRemoveHostname(...args),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { __mocked: true },
}));

const mockShowToast = vi.fn();
const mockDismissToast = vi.fn();

vi.mock('@/lib/store', () => ({
  useStore: {
    getState: () => ({
      showToast: mockShowToast,
      dismissToast: mockDismissToast,
    }),
  },
}));

describe('RemoveHostnameConfirm', () => {
  beforeEach(() => {
    mockRemoveHostname.mockReset();
    mockShowToast.mockReset();
    mockDismissToast.mockReset();
  });

  async function renderConfirm(overrides: { referenceCount?: number; onClose?: () => void; onRemoved?: () => void } = {}) {
    const { RemoveHostnameConfirm } = await import('../RemoveHostnameConfirm');
    const onClose = overrides.onClose ?? vi.fn();
    const onRemoved = overrides.onRemoved ?? vi.fn();
    render(
      <RemoveHostnameConfirm
        open
        hostname="meet.example.com"
        hostnameId="row-abc"
        referenceCount={overrides.referenceCount ?? 0}
        onClose={onClose}
        onRemoved={onRemoved}
      />,
    );
    return { onClose, onRemoved };
  }

  it('T1: 0 refs renders title + unused body + confirm CTA "Remove hostname"', async () => {
    await renderConfirm({ referenceCount: 0 });
    // Modal title may render twice (header + aria-label); use getAllByText
    expect(
      screen.getAllByText(/Remove meet\.example\.com from allowlist\?/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/This hostname is not in use on any page/i),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove hostname' })).toBeTruthy();
  });

  it('T2: >=1 refs renders plural in-use body variant', async () => {
    await renderConfirm({ referenceCount: 3 });
    expect(
      screen.getByText(/3 pages currently embed this hostname/i),
    ).toBeTruthy();
  });

  it('T3: cancel button label is "Keep on allowlist"', async () => {
    const onClose = vi.fn();
    await renderConfirm({ referenceCount: 0, onClose });
    const cancel = screen.getByRole('button', { name: 'Keep on allowlist' });
    fireEvent.click(cancel);
    expect(onClose).toHaveBeenCalled();
  });

  it('T4: confirm calls removeHostname + onRemoved + toast success', async () => {
    mockRemoveHostname.mockResolvedValue(undefined);
    const onClose = vi.fn();
    const onRemoved = vi.fn();
    await renderConfirm({ referenceCount: 0, onClose, onRemoved });
    fireEvent.click(screen.getByRole('button', { name: 'Remove hostname' }));
    await waitFor(() => {
      expect(mockRemoveHostname).toHaveBeenCalledWith(expect.anything(), 'row-abc');
    });
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(mockShowToast).toHaveBeenCalledWith(
      'Removed meet.example.com from allowlist',
      'success',
    );
    expect(onClose).toHaveBeenCalled();
  });
});
