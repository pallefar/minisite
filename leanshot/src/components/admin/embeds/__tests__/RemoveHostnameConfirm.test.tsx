/**
 * Phase 41 Plan 41-06 — RemoveHostnameConfirm RTL tests.
 *
 * 4 behaviors per PLAN.md §Task 1 <behavior>:
 *   T1 (unused):   title + body variant + confirm CTA "Remove hostname"
 *   T2 (in use):   in-use body variant + --color-danger-soft banner
 *   T3 (cancel):   Cancel button label "Keep on allowlist"
 *   T4 (confirm):  removeHostname called + Toast success + onRemoved fires
 *
 * NOTE: prop API was `referenceCount: number` until 41-REVIEW WR-04 — fake
 * cardinality removed; now `inUse: boolean` until v1.4 ships the real scan.
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

  async function renderConfirm(overrides: { inUse?: boolean; onClose?: () => void; onRemoved?: () => void } = {}) {
    const { RemoveHostnameConfirm } = await import('../RemoveHostnameConfirm');
    const onClose = overrides.onClose ?? vi.fn();
    const onRemoved = overrides.onRemoved ?? vi.fn();
    render(
      <RemoveHostnameConfirm
        open
        hostname="meet.example.com"
        hostnameId="row-abc"
        inUse={overrides.inUse ?? false}
        onClose={onClose}
        onRemoved={onRemoved}
      />,
    );
    return { onClose, onRemoved };
  }

  it('T1: unused renders title + unused body + confirm CTA "Remove hostname"', async () => {
    await renderConfirm({ inUse: false });
    // Modal title may render twice (header + aria-label); use getAllByText
    expect(
      screen.getAllByText(/Remove meet\.example\.com from allowlist\?/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/This hostname is not in use on any page/i),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove hostname' })).toBeTruthy();
  });

  it('T2: in-use renders in-use body variant (no fake cardinality)', async () => {
    await renderConfirm({ inUse: true });
    expect(
      screen.getByText(/This hostname is currently in use on at least one page/i),
    ).toBeTruthy();
    // WR-04 contract: no synthesized count rendered.
    expect(screen.queryByText(/\d+ pages currently embed/i)).toBeNull();
  });

  it('T3: cancel button label is "Keep on allowlist"', async () => {
    const onClose = vi.fn();
    await renderConfirm({ inUse: false, onClose });
    const cancel = screen.getByRole('button', { name: 'Keep on allowlist' });
    fireEvent.click(cancel);
    expect(onClose).toHaveBeenCalled();
  });

  it('T4: confirm calls removeHostname + onRemoved + toast success', async () => {
    mockRemoveHostname.mockResolvedValue(undefined);
    const onClose = vi.fn();
    const onRemoved = vi.fn();
    await renderConfirm({ inUse: false, onClose, onRemoved });
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
