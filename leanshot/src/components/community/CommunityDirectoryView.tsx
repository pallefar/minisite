/**
 * Phase 45 Plan 07a — STUB. Replaced by Task 2 of this same plan.
 * Final prop signature shipped first so CommunityTabShell typecheck passes;
 * Task 2 overwrites with the full Directory + ProfileCard surface.
 */
import type { JSX } from 'react';

import type { TierLabel } from '@/lib/community/tier-gate';

export interface CommunityDirectoryViewProps {
  currentUserId: string;
  currentTier: TierLabel;
}

export function CommunityDirectoryView({
  currentUserId: _currentUserId,
  currentTier: _currentTier,
}: CommunityDirectoryViewProps): JSX.Element {
  return (
    <div className="p-4 text-sm text-[var(--color-text-secondary)]" role="status" aria-live="polite">
      Directory loading…
    </div>
  );
}

export default CommunityDirectoryView;
