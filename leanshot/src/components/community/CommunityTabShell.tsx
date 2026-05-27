/**
 * Phase 44 Plan 09 / Phase 45 Plan 07a — CommunityTabShell.
 *
 * Consumer-surface tab shell for the Community section.
 * Uses Zustand store for navigation (per CLAUDE.md no-router rule).
 * NO react-router-dom usage here — consumer surface is entirely Zustand-driven.
 *
 * Dispatch order (Phase 45 Plan 07a — activeCommunityView extension):
 *   activeCommunityView === 'directory'                       → <CommunityDirectoryView>
 *   activeCommunityView === 'dm' AND activeDmThreadId === null → <DMInboxView>
 *   activeCommunityView === 'dm' AND activeDmThreadId !== null → <DMThreadView>
 *   activeCommunityView === null   (legacy / 'feed' implicit):
 *     activeCommunitySpaceId !== null → <CommunitySpaceView>
 *     activeCommunitySpaceId === null → <CommunitySpaceList>
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

// ─── Phase 45 Plan 07a — community-directory + community-dm sub-chunks ───────

const CommunityDirectoryView = lazy(() =>
  import('./CommunityDirectoryView').then((m) => ({ default: m.CommunityDirectoryView })),
);
// Phase 45 Plan 07b — DM components live under ./dm/ so the community-dm vite
// manualChunk rule (id.includes('/src/components/community/dm/')) routes them
// into a separate sub-chunk. The 45-07a stubs that previously sat at
// ./DMInboxView and ./DMThreadView are removed by 45-07b.
const DMInboxView = lazy(() =>
  import('./dm/DMInboxView').then((m) => ({ default: m.DMInboxView })),
);
const DMThreadView = lazy(() =>
  import('./dm/DMThreadView').then((m) => ({ default: m.DMThreadView })),
);

// ─── Component ────────────────────────────────────────────────────────────────

export default function CommunityTabShell() {
  // CLAUDE.md State Management rule: one selector per primitive.
  const currentUserId = useStore((s) => s.signedIn?.user?.id ?? '');
  const activeSpaceId = useStore((s) => s.activeCommunitySpaceId);
  const setActiveSpace = useStore((s) => s.setActiveCommunitySpace);
  const activeCommunityView = useStore((s) => s.activeCommunityView);
  const activeDmThreadId = useStore((s) => s.activeDmThreadId);
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

  // Phase 45 Plan 07a — dispatch on activeCommunityView FIRST, then legacy fall-through.
  if (activeCommunityView === 'directory') {
    return (
      <Suspense fallback={fallback}>
        <CommunityDirectoryView currentUserId={currentUserId} currentTier={currentTier} />
      </Suspense>
    );
  }

  if (activeCommunityView === 'dm') {
    return (
      <Suspense fallback={fallback}>
        {activeDmThreadId === null ? (
          <DMInboxView currentUserId={currentUserId} />
        ) : (
          <DMThreadView threadId={activeDmThreadId} currentUserId={currentUserId} />
        )}
      </Suspense>
    );
  }

  // Legacy (activeCommunityView === null): existing list/detail behavior.
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
