/**
 * useTicketChannel — Phase 37 Plan 06 Task 3 (HELP-09).
 *
 * Subscribes to the per-ticket Realtime channel `ticket:<ticketId>` and
 * surfaces:
 *  - `messages`: append-only ticket_messages rows (initial backfill + INSERT events)
 *  - `typingUserIds`: remote users currently broadcasting `event: 'typing'` (3s timeout)
 *  - `sendTyping()`: 500ms-throttled outbound typing broadcast
 *
 * Phase 9 invariant: `supabase.realtime.setAuth(token)` MUST be called BEFORE
 * `channel.subscribe()` or the subscription fails with CHANNEL_ERROR on
 * private channels (postgres_changes filtered by ticket_id RLS).
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type TicketMessage = {
  id: string;
  ticket_id: string;
  author_kind: string;
  body: string;
  created_at: string;
};

export interface UseTicketChannelResult {
  messages: TicketMessage[];
  typingUserIds: string[];
  sendTyping: () => void;
}

export function useTicketChannel(
  ticketId: string,
  currentUserId: string,
): UseTicketChannelResult {
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!ticketId) return;
    let cancelled = false;

    const setup = async (): Promise<void> => {
      const channel = supabase.channel(`ticket:${ticketId}`, {
        config: { broadcast: { self: false } },
      });

      // Typing broadcast — filter out our own userId (in case broadcast.self leaks).
      channel.on('broadcast', { event: 'typing' }, (payload) => {
        const userId = String(
          (payload as { payload?: { userId?: string } }).payload?.userId ?? '',
        );
        if (!userId || userId === currentUserId) return;
        setTypingUserIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
        const existing = typingTimeouts.current.get(userId);
        if (existing) clearTimeout(existing);
        typingTimeouts.current.set(
          userId,
          setTimeout(() => {
            setTypingUserIds((prev) => prev.filter((u) => u !== userId));
            typingTimeouts.current.delete(userId);
          }, 3000),
        );
      });

      // New ticket_messages rows from postgres_changes (filtered to this ticket).
      channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ticket_messages',
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const row = (payload as unknown as { new?: TicketMessage }).new;
          if (!row || typeof row.id !== 'string') return;
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, row];
          });
        },
      );

      // Phase 9 INVARIANT — attach JWT BEFORE subscribe() or CHANNEL_ERROR on private channels.
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (token) {
        supabase.realtime.setAuth(token);
      }
      if (cancelled) return;
      channel.subscribe();
      channelRef.current = channel;
    };

    void setup();

    // Initial backfill — separate query so first-paint shows existing messages.
    void (async () => {
      const { data } = await supabase
        .from('ticket_messages')
        .select('id, ticket_id, author_kind, body, created_at')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });
      if (cancelled || !data) return;
      setMessages(data as TicketMessage[]);
    })();

    return () => {
      cancelled = true;
      const c = channelRef.current;
      if (c) void supabase.removeChannel(c);
      channelRef.current = null;
      for (const t of typingTimeouts.current.values()) clearTimeout(t);
      typingTimeouts.current.clear();
    };
  }, [ticketId, currentUserId]);

  // 500ms throttled outbound typing broadcast.
  const lastSent = useRef(0);
  const sendTyping = (): void => {
    const now = Date.now();
    if (now - lastSent.current < 500) return;
    lastSent.current = now;
    channelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: currentUserId, isTyping: true },
    });
  };

  return { messages, typingUserIds, sendTyping };
}
