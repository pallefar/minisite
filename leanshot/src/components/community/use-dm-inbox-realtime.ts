/**
 * Phase 45 Plan 07a — DM inbox per-user Realtime hook.
 *
 * D-18: a single per-user `dm:${userId}` channel (NOT per-thread). Subscribes
 * to INSERTs on direct_messages filtered to `recipient_user_id=eq.${userId}` so
 * the inbox unread badge + thread-list refresh can react to incoming messages
 * across any thread the user participates in.
 *
 * onNewMessage is intentionally excluded from useEffect deps — callers must memoize
 * the callback. Re-subscribing on every render would leak channels.
 *
 * Analog: leanshot/src/components/community/use-space-realtime.ts (copied verbatim;
 * only channel name + table + filter differ).
 */
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export function useDmInboxRealtime(
  userId: string | null,
  onNewMessage: (msg: { thread_id: string; sender_user_id: string }) => void,
): void {
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`dm:${userId}`) // D-18 — per-user inbox channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `recipient_user_id=eq.${userId}`,
        },
        (payload) => onNewMessage(payload.new as { thread_id: string; sender_user_id: string }),
      )
      .subscribe((status: string) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[dm-inbox-realtime] channel error — live updates paused');
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
    // onNewMessage intentionally excluded from deps — callers must memoize.
    // Re-subscribing on every render would leak channels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
