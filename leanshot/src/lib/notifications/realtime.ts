/**
 * Phase 42 Plan 42-08 — user_notifications Realtime subscription.
 *
 * Opens a Supabase Realtime channel scoped to the current user's INSERT
 * events on `user_notifications`. The channel name includes the userId so
 * each browser opens its own channel (NOT a global channel — RLS on
 * user_notifications enforces row isolation; the filter is the second-layer
 * defense per T-42-08-02 threat model).
 *
 * Pattern follows leanshot/src/lib/admin/anomaly/realtime-channel.ts but
 * uses postgres_changes (not broadcast) because notification-send INSERTs
 * the source-of-truth row directly into user_notifications — Realtime's
 * native CDC stream is the right delivery surface here.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { UserNotificationRow } from './types';

export type UnsubscribeFn = () => void;

/**
 * Subscribe to INSERT events on user_notifications for a single user.
 * Returns an unsubscribe function — callers MUST invoke on unmount /
 * sign-out to avoid leaking channels.
 *
 * The channel is scoped by user_id in TWO places:
 *   1. channel name `user_notifications:<userId>` — per-user channel
 *      isolation in the supabase-js client side
 *   2. filter `user_id=eq.<userId>` — server-side filter on the postgres
 *      CDC stream
 *
 * RLS on user_notifications (Plan 42-05 migration 20270704000006) is the
 * authoritative gate; the filter is for client-side bandwidth efficiency.
 */
export function subscribeToUserNotifications(
  userId: string,
  onFire: (row: UserNotificationRow) => void,
): UnsubscribeFn {
  if (!userId) return () => {};

  const channel: RealtimeChannel = supabase
    .channel(`user_notifications:${userId}`)
    .on(
      // supabase-js v2's typings for `.on('postgres_changes', ...)` require
      // a literal event type; the second-arg shape matches the postgres-CDC
      // filter API.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      {
        event: 'INSERT',
        schema: 'public',
        table: 'user_notifications',
        filter: `user_id=eq.${userId}`,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payload: any) => {
        const row = payload?.new as UserNotificationRow | undefined;
        if (row && row.user_id === userId) {
          onFire(row);
        }
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
