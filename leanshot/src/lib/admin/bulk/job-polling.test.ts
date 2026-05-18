/**
 * Phase 27 Plan 27-06 — useBulkJobProgress hook (ADMIN-04 async polling).
 *
 * Behavior under test:
 *   T1 — initial render returns loading state (status='loading'), then transitions
 *        to a real status after first poll resolves.
 *   T2 — hook polls every 2s while job is in flight; stops polling once status
 *        is terminal ('completed' | 'failed').
 *   T3 — percent is derived as rowsCompleted/rowsTotal * 100 (clamped 0-100).
 *   T4 — hook cleans up its interval on unmount (no setState after unmount).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBulkJobProgress } from '@/lib/admin/bulk/job-polling';

const mockSingle = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
  },
}));

function buildFromChain(data: unknown, error: unknown = null) {
  mockSingle.mockResolvedValue({ data, error });
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        single: mockSingle,
      }),
    }),
  });
}

describe('useBulkJobProgress (Phase 27 ADMIN-04 / Plan 27-06)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSingle.mockReset();
    mockFrom.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('T1 — returns initial loading state then transitions to running after first poll', async () => {
    buildFromChain({
      id: 'j1',
      status: 'running',
      rows_completed: 25,
      rows_total: 100,
      error_log: [],
    });

    const { result } = renderHook(() => useBulkJobProgress('j1'));

    expect(result.current.status).toBe('loading');

    // Flush microtasks from the initial poll.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('running');
    });
    expect(result.current.rowsCompleted).toBe(25);
    expect(result.current.rowsTotal).toBe(100);
    expect(result.current.percent).toBe(25);
  });

  it('T2 — polls every 2s while running; stops polling on completed', async () => {
    // First poll: still running.
    mockSingle.mockResolvedValueOnce({
      data: { id: 'j1', status: 'running', rows_completed: 50, rows_total: 100, error_log: [] },
      error: null,
    });
    // Second poll: completed.
    mockSingle.mockResolvedValueOnce({
      data: { id: 'j1', status: 'completed', rows_completed: 100, rows_total: 100, error_log: [] },
      error: null,
    });
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ single: mockSingle }) }),
    });

    const { result } = renderHook(() => useBulkJobProgress('j1'));

    // Flush first poll.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe('running'));
    expect(mockSingle).toHaveBeenCalledTimes(1);

    // Advance 2s + flush — should trigger 2nd poll, return 'completed'.
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe('completed'));
    expect(mockSingle).toHaveBeenCalledTimes(2);

    // Advance another 2s — should NOT poll again (terminal).
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(mockSingle).toHaveBeenCalledTimes(2);
  });

  it('T3 — percent clamps to 0..100 from rowsCompleted/rowsTotal', async () => {
    buildFromChain({
      id: 'j1',
      status: 'running',
      rows_completed: 77,
      rows_total: 250,
      error_log: [],
    });

    const { result } = renderHook(() => useBulkJobProgress('j1'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe('running'));

    // 77/250 = 30.8 → rounded to 31 (component renders integer).
    expect(result.current.percent).toBe(31);
  });

  it('T4 — cleans up interval on unmount (no further polls)', async () => {
    buildFromChain({
      id: 'j1',
      status: 'running',
      rows_completed: 10,
      rows_total: 100,
      error_log: [],
    });

    const { result, unmount } = renderHook(() => useBulkJobProgress('j1'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe('running'));
    expect(mockSingle).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });
    // No new polls after unmount.
    expect(mockSingle).toHaveBeenCalledTimes(1);
  });
});
