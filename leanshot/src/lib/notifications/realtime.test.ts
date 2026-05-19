/**
 * Phase 42 Plan 42-08 — subscribeToUserNotifications test.
 *
 * Behavior:
 *  - opens a channel `user_notifications:<userId>` and registers a
 *    postgres_changes INSERT handler with filter user_id=eq.<userId>.
 *  - fires onFire(row) when the channel emits a matching INSERT.
 *  - returns an unsubscribe function that removes the channel.
 */
import { describe, expect, it, vi } from 'vitest';
import { subscribeToUserNotifications } from './realtime';
import type { UserNotificationRow } from './types';

const { subscribeMock, onMock, channelMock, removeChannelMock, handlerRef } = vi.hoisted(() => {
  const handlerRef: { current: ((p: { new: unknown }) => void) | null } = { current: null };
  const subscribe = vi.fn();
  const on = vi.fn(function on(
    _evt: string,
    _filter: unknown,
    handler: (p: { new: unknown }) => void,
  ) {
    handlerRef.current = handler;
    return { subscribe };
  });
  const channel = vi.fn(() => ({ on }));
  const removeChannel = vi.fn();
  return {
    subscribeMock: subscribe,
    onMock: on,
    channelMock: channel,
    removeChannelMock: removeChannel,
    handlerRef,
  };
});
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (name: string) => channelMock(name),
    removeChannel: (...args: unknown[]) => removeChannelMock(...args),
  },
}));

describe('subscribeToUserNotifications (Plan 42-08 realtime)', () => {
  it('subscribes to user_notifications:<userId> channel with user_id filter', () => {
    const onFire = vi.fn();
    const unsubscribe = subscribeToUserNotifications('u1', onFire);
    expect(channelMock).toHaveBeenCalledWith('user_notifications:u1');
    expect(onMock).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: 'INSERT',
        schema: 'public',
        table: 'user_notifications',
        filter: 'user_id=eq.u1',
      }),
      expect.any(Function),
    );
    expect(subscribeMock).toHaveBeenCalled();

    // INSERT delivery → onFire called with the row.
    const row: UserNotificationRow = {
      id: 'n1',
      user_id: 'u1',
      category: 'ai-insights',
      channel: 'in-app',
      payload: { subject: 'Hi' },
      fired_at: '2026-05-19T00:00:00Z',
      dismissed_at: null,
    };
    handlerRef.current?.({ new: row });
    expect(onFire).toHaveBeenCalledWith(row);

    unsubscribe();
    expect(removeChannelMock).toHaveBeenCalled();
  });

  it('returns a no-op unsubscribe when userId is empty', () => {
    const onFire = vi.fn();
    const unsubscribe = subscribeToUserNotifications('', onFire);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });
});
