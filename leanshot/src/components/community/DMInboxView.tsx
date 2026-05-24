/**
 * Phase 45 Plan 07a — STUB. Replaced by sibling plan 45-07b.
 *
 * Final prop signature shipped here so 45-07a's CommunityTabShell dispatch can
 * lazy-import this module without breaking TypeScript / build. 45-07b will
 * replace this file with the real DM-inbox surface (thread list + unread badges
 * + use-dm-inbox-realtime wiring).
 *
 * Per memory feedback_stub_then_replace_sibling_collision: same-wave plans
 * touching one new file ship final prop signature here; sibling plan replaces
 * via `git checkout --ours` at merge.
 */
import type { JSX } from 'react';

export interface DMInboxViewProps {
  currentUserId: string;
}

export function DMInboxView({ currentUserId: _currentUserId }: DMInboxViewProps): JSX.Element {
  return (
    <div
      className="p-4 text-sm text-[var(--color-text-secondary)]"
      role="status"
      aria-live="polite"
    >
      Inbox loading…
    </div>
  );
}

export default DMInboxView;
