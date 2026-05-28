/**
 * Phase 19 Plan 19-04 Task 3 (BL-1 / D-23) — feature-flags client tests.
 *
 * Covers:
 *   T1: default OFF when cache empty.
 *   T2: setFlagForTest flips the value.
 *   T3: loadFeatureFlags populates from a mocked supabase-js response.
 *   T4: useFeatureFlag re-renders subscribed components on cache update.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadFeatureFlags,
  resetFlagsForTest,
  setFlagForTest,
  useFeatureFlag,
} from '../feature-flags';

// Minimal supabase-js shape we exercise: client.from('feature_flags').select(...)
// resolves with { data, error }.
function buildFakeClient(
  rows: Array<{ key: string; enabled: boolean }> | null,
  error: { message: string } | null = null,
) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => Promise.resolve({ data: rows, error }),
    }),
  } as unknown as Parameters<typeof loadFeatureFlags>[0];
}

afterEach(() => {
  resetFlagsForTest();
});

describe('feature-flags client', () => {
  it('T1: useFeatureFlag returns false when cache is empty (default OFF)', () => {
    const { result } = renderHook(() => useFeatureFlag('aff_manual_entry'));
    expect(result.current).toBe(false);
  });

  it('T2: setFlagForTest flips the value', () => {
    const { result } = renderHook(() => useFeatureFlag('aff_manual_entry'));
    expect(result.current).toBe(false);
    act(() => {
      setFlagForTest('aff_manual_entry', true);
    });
    expect(result.current).toBe(true);
  });

  it('T3: loadFeatureFlags populates the cache from a mocked supabase-js response', async () => {
    const client = buildFakeClient([
      { key: 'aff_manual_entry', enabled: true },
      { key: 'some_other_flag', enabled: false },
    ]);
    await act(async () => {
      await loadFeatureFlags(client);
    });
    const { result: r1 } = renderHook(() => useFeatureFlag('aff_manual_entry'));
    const { result: r2 } = renderHook(() => useFeatureFlag('some_other_flag'));
    expect(r1.current).toBe(true);
    expect(r2.current).toBe(false);
  });

  it('T4: useFeatureFlag subscribers re-render when the cache updates after mount', async () => {
    const { result } = renderHook(() => useFeatureFlag('aff_manual_entry'));
    expect(result.current).toBe(false);

    const client = buildFakeClient([{ key: 'aff_manual_entry', enabled: true }]);
    await act(async () => {
      await loadFeatureFlags(client);
    });
    expect(result.current).toBe(true);
  });

  it('T5: load error leaves the cache empty (failure mode — default-off)', async () => {
    const client = buildFakeClient(null, { message: 'permission denied' });
    await act(async () => {
      await loadFeatureFlags(client);
    });
    const { result } = renderHook(() => useFeatureFlag('aff_manual_entry'));
    expect(result.current).toBe(false);
  });
});
