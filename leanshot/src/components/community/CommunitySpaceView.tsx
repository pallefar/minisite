/**
 * Phase 44 Plan 09 — CommunitySpaceView.
 *
 * Single-space page that composes:
 *   - useSpaceRealtime (D-13 per-space channel; increments refreshNonce on updates)
 *   - CommunityFeed (passes refreshNonce so it re-fetches on Realtime fire)
 *   - CommunityPostComposer (onSubmitted increments nonce for immediate optimistic feel)
 *
 * Security (T-44-01): SpaceView re-validates access on mount via a SELECT on
 * community_spaces with the caller's auth context. If RLS returns 0 rows
 * (tier-probe or cross-tenant), we render "Access denied / Not found".
 *
 * Back navigation: button calls store.setActiveCommunitySpace(null) — Zustand-driven,
 * NOT react-router (CLAUDE.md consumer-surface no-router rule).
 */
import { ArrowLeft } from 'lucide-react';
import { Suspense, lazy, useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import type { CommunitySpace } from '@/lib/community/community-types';
import type { TierLabel } from '@/lib/community/tier-gate';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { useSpaceRealtime } from './use-space-realtime';

// ─── Lazy community sub-components (community-feed chunk) ─────────────────────

const CommunityFeed = lazy(() =>
  import('./CommunityFeed').then((m) => ({ default: m.CommunityFeed })),
);
const CommunityPostComposer = lazy(() =>
  import('./CommunityPostComposer').then((m) => ({ default: m.CommunityPostComposer })),
);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommunitySpaceViewProps {
  spaceId: string;
  currentUserId: string;
  currentTier: TierLabel;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommunitySpaceView({ spaceId, currentUserId }: CommunitySpaceViewProps) {
  const [space, setSpace] = useState<CommunitySpace | null | 'not-found'>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // D-13: per-space Realtime channel — single channel per mounted view.
  useSpaceRealtime(spaceId, () => setRefreshNonce((n) => n + 1));

  // Re-validate space access on mount (T-44-01 — runtime tier/cross-tenant defense).
  useEffect(() => {
    if (!spaceId) return;

    void (async () => {
      const { data, error } = await supabase
        .from('community_spaces')
        .select('id, name, description, org_id, min_tier, created_at, updated_at')
        .eq('id', spaceId)
        .single();

      if (error || !data) {
        setSpace('not-found');
        return;
      }
      setSpace(data as CommunitySpace);
    })();
  }, [spaceId]);

  // Back to space list — Zustand-driven exit (NOT router navigation per CLAUDE.md).
  const handleBack = () => {
    useStore.getState().setActiveCommunitySpace(null);
  };

  // Access denied / not found state
  if (space === 'not-found') {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center" role="main">
        <p className="text-base font-semibold text-[var(--color-text)]">Space not found</p>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          This space does not exist or you do not have access.
        </p>
        <button
          onClick={handleBack}
          className="mt-4 text-sm font-semibold text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded"
        >
          Back to spaces
        </button>
      </div>
    );
  }

  // Loading skeleton
  if (space === null) {
    return (
      <div className="p-4 space-y-3" role="status" aria-live="polite" aria-label="Loading space">
        <Skeleton className="h-6 w-48 rounded" />
        <Skeleton className="h-4 w-64 rounded" />
      </div>
    );
  }

  const spaceNameId = `space-heading-${spaceId}`;

  return (
    <div role="main" aria-labelledby={spaceNameId} className="flex flex-col gap-4 pb-20">
      {/* Header */}
      <header className="flex items-start gap-3 px-4 pt-4">
        <button
          onClick={handleBack}
          aria-label="Back to space list"
          className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded shrink-0"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </button>
        <div className="min-w-0 flex-1">
          <h1 id={spaceNameId} className="text-lg font-bold text-[var(--color-text)] truncate">
            {space.name}
          </h1>
          {space.description && (
            <p className="text-sm text-[var(--color-text-secondary)] line-clamp-2">
              {space.description}
            </p>
          )}
        </div>
      </header>

      {/* Composer */}
      <div className="px-4">
        <Suspense fallback={<Skeleton className="h-24 w-full rounded-xl" />}>
          <CommunityPostComposer
            spaceId={spaceId}
            currentUserId={currentUserId}
            onSubmitted={() => setRefreshNonce((n) => n + 1)}
          />
        </Suspense>
      </div>

      {/* Feed */}
      <Suspense
        fallback={
          <div className="px-4 space-y-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        }
      >
        <CommunityFeed
          spaceId={spaceId}
          currentUserId={currentUserId}
          refreshNonce={refreshNonce}
        />
      </Suspense>
    </div>
  );
}
