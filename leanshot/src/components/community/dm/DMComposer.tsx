/**
 * Phase 45 Plan 07b — DMComposer (Task 1 placeholder; Task 2 ships real impl).
 *
 * Task 1 commit needs this file to exist so DMThreadView's import resolves
 * for `tsc -p tsconfig.app.json --noEmit`. Task 2 replaces this file with the
 * real composer (5 MB attachment + dm-create-thread Edge Fn for new threads;
 * direct insert for replies; 429/403 toast handling; web-push opt-in gate).
 */
import type { JSX } from 'react';

export type DMComposerMode = 'new' | 'reply';

export interface DMComposerProps {
  mode: DMComposerMode;
  /** Required for mode="reply"; ignored for mode="new". */
  threadId?: string;
  recipientUserId: string;
  currentUserId: string;
  /** Fires after a successful send so parents can refetch. */
  onSent?: (msgId?: string) => void;
}

export function DMComposer(_props: DMComposerProps): JSX.Element {
  return (
    <div className="p-3 text-xs text-[var(--color-fg-muted)]" role="status" aria-live="polite">
      Composer loading…
    </div>
  );
}

export default DMComposer;
