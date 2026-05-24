/**
 * Phase 45 Plan 07a — STUB. Replaced by sibling plan 45-07b.
 *
 * Final prop signature shipped here so 45-07a's CommunityTabShell dispatch can
 * lazy-import this module without breaking TypeScript / build. 45-07b will
 * replace this file with the real DM-thread surface (virtualized message list +
 * composer + signed-URL resolution for media attachments).
 *
 * Per memory feedback_stub_then_replace_sibling_collision.
 */
import type { JSX } from 'react';

export interface DMThreadViewProps {
  threadId: string;
  currentUserId: string;
}

export function DMThreadView({
  threadId: _threadId,
  currentUserId: _currentUserId,
}: DMThreadViewProps): JSX.Element {
  return (
    <div
      className="p-4 text-sm text-[var(--color-text-secondary)]"
      role="status"
      aria-live="polite"
    >
      Thread loading…
    </div>
  );
}

export default DMThreadView;
