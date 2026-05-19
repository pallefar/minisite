/**
 * Phase 42 Plan 42-08 — settings-store tests.
 *
 * Behavior:
 *  - useNotificationSettings() fetches notification_settings rows for the
 *    current user; returns a Map keyed by `${category}:${channel}` with
 *    {enabled, snoozed_until, user_cap_override}.
 *  - update({category, channel, enabled}) upserts via supabase-js with
 *    onConflict 'user_id,category,channel'; optimistic-first; rolls back
 *    on failure.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keyOf, useNotificationSettings } from './settings-store';

// Mock the supabase singleton BEFORE importing the hook under test.
const { eqMock, selectMock, upsertMock, fromMock } = vi.hoisted(() => {
  const eq = vi.fn();
  const select = vi.fn(() => ({ eq }));
  const upsert = vi.fn();
  const from = vi.fn(() => ({ select, upsert }));
  return { eqMock: eq, selectMock: select, upsertMock: upsert, fromMock: from };
});
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
  },
}));

describe('useNotificationSettings (Plan 42-08 settings-store)', () => {
  beforeEach(() => {
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockReset();
    upsertMock.mockReset();
  });

  it('fetches rows for the current user and returns a Map keyed by category:channel', async () => {
    eqMock.mockResolvedValueOnce({
      data: [
        {
          user_id: 'u1',
          category: 'ai-insights',
          channel: 'in-app',
          enabled: true,
          snoozed_until: null,
          user_cap_override: null,
        },
        {
          user_id: 'u1',
          category: 'marketing',
          channel: 'email',
          enabled: false,
          snoozed_until: null,
          user_cap_override: null,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useNotificationSettings('u1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fromMock).toHaveBeenCalledWith('notification_settings');
    expect(result.current.settings.size).toBe(2);
    expect(result.current.settings.get(keyOf('ai-insights', 'in-app'))?.enabled).toBe(true);
    expect(result.current.settings.get(keyOf('marketing', 'email'))?.enabled).toBe(false);
  });

  it('update() upserts with onConflict user_id,category,channel and applies optimistic state', async () => {
    eqMock.mockResolvedValueOnce({ data: [], error: null });
    upsertMock.mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() => useNotificationSettings('u1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let res;
    await act(async () => {
      res = await result.current.update({ category: 'billing', channel: 'email', enabled: false });
    });

    expect(res).toEqual({ ok: true });
    // Optimistic state reflected:
    expect(result.current.settings.get(keyOf('billing', 'email'))?.enabled).toBe(false);
    // Upsert was called with the canonical conflict key:
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u1',
        category: 'billing',
        channel: 'email',
        enabled: false,
      }),
      { onConflict: 'user_id,category,channel' },
    );
  });

  it('rolls back optimistic state on upsert failure', async () => {
    eqMock.mockResolvedValueOnce({
      data: [
        {
          user_id: 'u1',
          category: 'billing',
          channel: 'email',
          enabled: true,
          snoozed_until: null,
          user_cap_override: null,
        },
      ],
      error: null,
    });
    upsertMock.mockResolvedValueOnce({ error: { message: 'rls denied' } });

    const { result } = renderHook(() => useNotificationSettings('u1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings.get(keyOf('billing', 'email'))?.enabled).toBe(true);

    let res;
    await act(async () => {
      res = await result.current.update({ category: 'billing', channel: 'email', enabled: false });
    });

    expect(res?.ok).toBe(false);
    // Rollback restored the previous row:
    expect(result.current.settings.get(keyOf('billing', 'email'))?.enabled).toBe(true);
  });
});
