/**
 * TypingIndicator — Phase 37 Plan 06 Task 3.
 *
 * Renders a polite live-region "X is typing…" message when at least one
 * remote user is broadcasting `event: 'typing'` on the ticket channel.
 *
 * Animation note: per CLAUDE.md, useReducedMotion() gates any motion. The
 * indicator is text-only here (no animated dots) so the hook isn't required
 * — keeping the chunk lighter. If a future polish plan adds an animated
 * dot row, wrap it with `useReducedMotion()` from `@/hooks/useReducedMotion`.
 */
import type { JSX } from 'react';

export interface TypingIndicatorProps {
  typingUserIds: string[];
}

export default function TypingIndicator({
  typingUserIds,
}: TypingIndicatorProps): JSX.Element | null {
  if (typingUserIds.length === 0) return null;
  const label =
    typingUserIds.length === 1
      ? 'Someone is typing…'
      : `${typingUserIds.length} people are typing…`;
  return (
    <div
      role="status"
      aria-live="polite"
      className="text-xs text-[var(--color-fg-muted)] px-3 py-1"
    >
      {label}
    </div>
  );
}
