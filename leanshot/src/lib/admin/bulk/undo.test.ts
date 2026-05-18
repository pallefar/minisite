/**
 * Phase 27 Plan 27-01 — RED tests for redeemUndoToken helper.
 *
 * Covers:
 *   (a) Successful redeem returns {reversed:N}.
 *   (b) SQLSTATE 22023 with 'token_expired' → BulkApiError('token_expired').
 *   (c) Network/thrown error → BulkApiError('network').
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BulkApiError } from '@/lib/admin/bulk/types';
import { redeemUndoToken } from '@/lib/admin/bulk/undo';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, params: unknown) => mockRpc(name, params),
  },
}));

describe('redeemUndoToken (Phase 27 ADMIN-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls admin_bulk_action_undo with p_undo_token and returns {reversed:N}', async () => {
    mockRpc.mockResolvedValue({
      data: { reversed: 5 },
      error: null,
    });
    const result = await redeemUndoToken('token-xyz');
    expect(mockRpc).toHaveBeenCalledWith('admin_bulk_action_undo', {
      p_undo_token: 'token-xyz',
    });
    expect(result).toEqual({ reversed: 5 });
  });

  it('surfaces 22023 with token_expired message as BulkApiError("token_expired")', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'token_expired' },
    });
    await expect(redeemUndoToken('expired')).rejects.toBeInstanceOf(BulkApiError);
    await expect(redeemUndoToken('expired')).rejects.toMatchObject({ code: 'token_expired' });
  });

  it('wraps thrown errors as BulkApiError("network")', async () => {
    mockRpc.mockRejectedValue(new Error('fetch failed'));
    await expect(redeemUndoToken('t')).rejects.toMatchObject({ code: 'network' });
  });
});
