/**
 * useTicketChannel — Phase 37 Plan 06 Task 3 (HELP-09).
 *
 * Stub created in RED; real Supabase Realtime subscription lands in Task 3 GREEN.
 */
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
  _ticketId: string,
  _currentUserId: string,
): UseTicketChannelResult {
  return {
    messages: [],
    typingUserIds: [],
    sendTyping: () => {
      /* GREEN: 500ms throttled broadcast to ticket:<id> */
    },
  };
}
