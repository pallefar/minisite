/**
 * TicketThread — Phase 37 Plan 06 Task 3 (HELP-09).
 *
 * Renders the ticket message stream + ReplyComposer + TypingIndicator. The
 * Realtime channel (`ticket:<id>`) is opened via the `useTicketChannel` hook,
 * which handles the Phase 9 invariant (`realtime.setAuth()` BEFORE subscribe()).
 */
import { type JSX } from 'react';
import { Button } from '@/components/ui/Button';
import { useTicketChannel } from './hooks/useTicketChannel';
import ReplyComposer from './ReplyComposer';
import TypingIndicator from './TypingIndicator';

export interface TicketThreadProps {
  ticketId: string;
  currentUserId: string;
  onBack: () => void;
}

export default function TicketThread({
  ticketId,
  currentUserId,
  onBack,
}: TicketThreadProps): JSX.Element {
  const { messages, typingUserIds, sendTyping } = useTicketChannel(ticketId, currentUserId);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center gap-2">
        <Button onClick={onBack} variant="ghost" aria-label="Back to tickets">
          ← Back
        </Button>
        <span className="text-sm text-[var(--color-fg-muted)]">
          Ticket {ticketId.slice(0, 8)}
        </span>
      </div>
      <ol
        className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2"
        aria-label="Ticket messages"
      >
        {messages.map((m) => (
          <li
            key={m.id}
            className="flex flex-col gap-0.5 rounded-md p-2 bg-[var(--color-surface-elevated)]"
          >
            <span className="text-xs text-[var(--color-fg-muted)]">{m.author_kind}</span>
            <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
          </li>
        ))}
        {messages.length === 0 && (
          <li className="text-xs text-[var(--color-fg-muted)]">No messages yet.</li>
        )}
      </ol>
      <TypingIndicator typingUserIds={typingUserIds} />
      <ReplyComposer ticketId={ticketId} onTyping={sendTyping} />
    </div>
  );
}
