/**
 * Phase 27 Plan 27-01 — RED tests for executeBulkAction dispatcher.
 *
 * Covers:
 *   (a) All 5 action types dispatch with correct RPC params.
 *   (b) SQLSTATE 42501 surfaces as BulkApiError('not_staff').
 *   (c) SQLSTATE 22023 with 'too_many_rows' message → BulkApiError('too_many_rows').
 *   (d) SQLSTATE 22023 with 'invalid_action' message → BulkApiError('invalid_action').
 *   (e) Network/thrown error → BulkApiError('network').
 *   (f) Sync response with undo_token (ban/comp_plan/tag) → undoToken populated.
 *   (g) Async response → jobId populated, undoToken null.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeBulkAction } from '@/lib/admin/bulk/action-handlers';
import { BulkApiError } from '@/lib/admin/bulk/types';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, params: unknown) => mockRpc(name, params),
  },
}));

describe('executeBulkAction (Phase 27 ADMIN-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches csv_export with correct RPC params', async () => {
    mockRpc.mockResolvedValue({
      data: { mode: 'sync', affected: 3, undo_token: null, job_id: null },
      error: null,
    });
    await executeBulkAction('csv_export', ['u1', 'u2', 'u3']);
    expect(mockRpc).toHaveBeenCalledWith('admin_bulk_action_execute', {
      p_action_type: 'csv_export',
      p_target_user_ids: ['u1', 'u2', 'u3'],
      p_params: {},
    });
  });

  it('dispatches tag with params.tag', async () => {
    mockRpc.mockResolvedValue({
      data: { mode: 'sync', affected: 2, undo_token: 't-1', job_id: null },
      error: null,
    });
    await executeBulkAction('tag', ['u1', 'u2'], { tag: 'priority' });
    expect(mockRpc).toHaveBeenCalledWith('admin_bulk_action_execute', {
      p_action_type: 'tag',
      p_target_user_ids: ['u1', 'u2'],
      p_params: { tag: 'priority' },
    });
  });

  it('dispatches comp_plan with params.days', async () => {
    mockRpc.mockResolvedValue({
      data: { mode: 'sync', affected: 1, undo_token: 't-2', job_id: null },
      error: null,
    });
    await executeBulkAction('comp_plan', ['u1'], { days: 30 });
    expect(mockRpc).toHaveBeenCalledWith('admin_bulk_action_execute', {
      p_action_type: 'comp_plan',
      p_target_user_ids: ['u1'],
      p_params: { days: 30 },
    });
  });

  it('dispatches ban with empty params', async () => {
    mockRpc.mockResolvedValue({
      data: { mode: 'sync', affected: 5, undo_token: 't-3', job_id: null },
      error: null,
    });
    await executeBulkAction('ban', ['u1', 'u2', 'u3', 'u4', 'u5']);
    expect(mockRpc).toHaveBeenCalledWith('admin_bulk_action_execute', {
      p_action_type: 'ban',
      p_target_user_ids: ['u1', 'u2', 'u3', 'u4', 'u5'],
      p_params: {},
    });
  });

  it('dispatches force_password_reset', async () => {
    mockRpc.mockResolvedValue({
      data: { mode: 'sync', affected: 4, undo_token: null, job_id: null },
      error: null,
    });
    const result = await executeBulkAction('force_password_reset', ['u1', 'u2', 'u3', 'u4']);
    expect(mockRpc).toHaveBeenCalledWith('admin_bulk_action_execute', {
      p_action_type: 'force_password_reset',
      p_target_user_ids: ['u1', 'u2', 'u3', 'u4'],
      p_params: {},
    });
    expect(result).toEqual({ mode: 'sync', affected: 4, undoToken: null, jobId: null });
  });

  it('returns sync result with undoToken for ban', async () => {
    mockRpc.mockResolvedValue({
      data: { mode: 'sync', affected: 5, undo_token: 'undo-abc', job_id: null },
      error: null,
    });
    const result = await executeBulkAction('ban', ['u1', 'u2', 'u3', 'u4', 'u5']);
    expect(result).toEqual({
      mode: 'sync',
      affected: 5,
      undoToken: 'undo-abc',
      jobId: null,
    });
  });

  it('returns async result with jobId when RPC returns mode=async', async () => {
    mockRpc.mockResolvedValue({
      data: { mode: 'async', affected: 0, undo_token: null, job_id: 'job-xyz' },
      error: null,
    });
    const result = await executeBulkAction('ban', Array.from({ length: 150 }, (_, i) => `u${i}`));
    expect(result).toEqual({
      mode: 'async',
      affected: 0,
      undoToken: null,
      jobId: 'job-xyz',
    });
  });

  it('surfaces 42501 as BulkApiError("not_staff")', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'forbidden' },
    });
    await expect(executeBulkAction('ban', ['u1'])).rejects.toBeInstanceOf(BulkApiError);
    await expect(executeBulkAction('ban', ['u1'])).rejects.toMatchObject({ code: 'not_staff' });
  });

  it('surfaces 22023 with too_many_rows message as BulkApiError("too_many_rows")', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'too_many_rows: 20000' },
    });
    await expect(
      executeBulkAction('ban', Array.from({ length: 20000 }, (_, i) => `u${i}`)),
    ).rejects.toMatchObject({ code: 'too_many_rows' });
  });

  it('surfaces 22023 with invalid_action message as BulkApiError("invalid_action")', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'invalid_action: tag requires params.tag' },
    });
    await expect(executeBulkAction('tag', ['u1'])).rejects.toMatchObject({
      code: 'invalid_action',
    });
  });

  it('wraps thrown errors as BulkApiError("network")', async () => {
    mockRpc.mockRejectedValue(new Error('fetch failed'));
    await expect(executeBulkAction('ban', ['u1'])).rejects.toMatchObject({ code: 'network' });
  });

  it('surfaces 28000 as BulkApiError("not_authenticated")', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '28000', message: 'not_authenticated' },
    });
    await expect(executeBulkAction('ban', ['u1'])).rejects.toMatchObject({
      code: 'not_authenticated',
    });
  });
});
