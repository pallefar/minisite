/**
 * Phase 44 Plan 09 — CommunityTabShell.
 *
 * Consumer-surface tab shell for the Community section.
 * Uses Zustand store for list-vs-detail navigation (per CLAUDE.md no-router rule).
 * NO react-router-dom usage here — consumer surface is entirely Zustand-tab-driven.
 *
 * list view  (activeCommunitySpaceId === null) → <CommunitySpaceList>
 * detail view (activeCommunitySpaceId !== null) → <CommunitySpaceView>
 *
 * TierLabel is resolved asynchronously from the tier_effective view (readTierLabel)
 * since the store's `tier` field uses the billing Tier type ('free'|'paid'|'past_due')
 * rather than the community TierLabel ('free'|'trial'|'pro'|'lifetime').
 */
import { Suspense, lazy, useEffect, useState } from 'react';

import { Skeleton } from '@/components/ui/Skeleton';
import type { TierLabel } from '@/lib/community/tier-gate';
import { readTierLabel } from '@/lib/community/tier-gate';
import { useStore } from '@/lib/store';

// ─── Lazy community sub-components (community-feed chunk) ─────────────────────

const CommunitySpaceList = lazy(() =>
  import('./CommunitySpaceList').then((m) => ({ default: m.CommunitySpaceList })),
);
const CommunitySpaceView = lazy(() =>
  import('./CommunitySpaceView').then((m) => ({ default: m.CommunitySpaceView })),
);

// ─── Component ────────────────────────────────────────────────────────────────

export default function CommunityTabShell() {
  const currentUserId = useStore((s) => s.signedIn?.user?.id ?? '');
  const activeSpaceId = useStore((s) => s.activeCommunitySpaceId);
  const setActiveSpace = useStore((s) => s.setActiveCommunitySpace);
  const [currentTier, setCurrentTier] = useState<TierLabel>('free');

  // Resolve community TierLabel from tier_effective view.
  useEffect(() => {
    if (!currentUserId) return;

    void readTierLabel(currentUserId).then((tier) => {
      setCurrentTier(tier);
    });
  }, [currentUserId]);

  const fallback = (
    <div className="p-4 space-y-3" role="status" aria-live="polite" aria-label="Loading community">
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );

  return (
    <Suspense fallback={fallback}>
      {activeSpaceId ? (
        <CommunitySpaceView
          spaceId={activeSpaceId}
          currentUserId={currentUserId}
          currentTier={currentTier}
        />
      ) : (
        <CommunitySpaceList
          currentUserId={currentUserId}
          currentTier={currentTier}
          onSelectSpace={(id) => setActiveSpace(id)}
        />
      )}
    </Suspense>
  );
}
