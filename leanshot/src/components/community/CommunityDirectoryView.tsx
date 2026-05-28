/**
 * Phase 45 Plan 07a — CommunityDirectoryView.
 *
 * Lists directory-visible profiles with a handle-prefix search + tier filter
 * (filter currently UI-only — server-side tier filter requires a join on
 * tier_effective that is out of scope for this plan). Pagination via cursor
 * on (handle, id) per D-04.
 *
 * Fix-C decision (CRITICAL — see PLAN line 23, 177, threat T-45-01):
 *   Uses direct `supabase.from('profiles').select(...)` for visibility-gated
 *   browsing. The RLS policy `directory_members_select` (two-mode org-scope
 *   + directory_opt_in=true) does the visibility filtering; the client query
 *   is unable to bypass. (No RPC indirection — 45-01 does not ship one for
 *   this surface; see plan PATTERNS for the full rationale.)
 *
 * Back navigation: a small "Back" link resets activeCommunityView to null
 * (Zustand-driven, no router).
 *
 * Analog: leanshot/src/components/community/CommunitySpaceView.tsx (data fetch
 * shape, skeleton fallback, role="main" + Back button).
 */
import { ArrowLeft, Search } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import type { TierLabel } from '@/lib/community/tier-gate';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type { DirectoryProfile } from './ProfileCard';

// ─── Lazy ProfileCard (community-directory chunk per 45-07b vite config) ─────

const ProfileCard = lazy(() => import('./ProfileCard').then((m) => ({ default: m.ProfileCard })));

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommunityDirectoryViewProps {
  currentUserId: string;
  /**
   * Caller's tier; currently unused by the directory query itself (RLS gates
   * visibility) but reserved for future per-tier UX (e.g. locked-card hint
   * for free users browsing pro-only handles).
   */
  currentTier: TierLabel;
}

interface Cursor {
  handle: string;
  id: string;
}

const PAGE_SIZE = 20;

// ─── Component ────────────────────────────────────────────────────────────────

export function CommunityDirectoryView({
  currentUserId,
  currentTier: _currentTier,
}: CommunityDirectoryViewProps) {
  // CLAUDE.md State Management rule: one selector per primitive.
  const setActiveCommunityView = useStore((s) => s.setActiveCommunityView);
  const setActiveDmThread = useStore((s) => s.setActiveDmThread);

  const [profiles, setProfiles] = useState<DirectoryProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Fix-C: direct .from('profiles').select(...) — RLS gates visibility.
  // This is the canonical query path for this surface (no RPC indirection).
  const fetchPage = useCallback(
    async (opts: { reset: boolean; prefix: string; afterCursor: Cursor | null }) => {
      const { reset, prefix, afterCursor } = opts;
      if (reset) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);

      let query = supabase
        .from('profiles')
        .select(
          'id, handle, display_name, bio, links, is_clinician_verified, show_tier_badge, show_streak_badge',
        )
        .eq('directory_opt_in', true)
        .order('handle', { ascending: true })
        .order('id', { ascending: true })
        .limit(PAGE_SIZE);

      if (prefix.length > 0) {
        // Lowercase prefix — handle CHECK constraint enforces lowercase storage.
        query = query.ilike('handle', `${prefix.toLowerCase()}%`);
      }

      // Cursor pagination on (handle, id) — RLS still gates rows after the .or().
      if (afterCursor) {
        query = query.or(
          `handle.gt.${afterCursor.handle},and(handle.eq.${afterCursor.handle},id.gt.${afterCursor.id})`,
        );
      }

      const { data, error: qErr } = await query;

      if (qErr) {
        setError(qErr.message);
        if (reset) setProfiles([]);
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      const rows = (data ?? []) as DirectoryProfile[];
      setProfiles((prev) => (reset ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
      const last = rows[rows.length - 1];
      if (last && last.handle) {
        setCursor({ handle: last.handle, id: last.id });
      } else if (rows.length === 0 && reset) {
        setCursor(null);
      }
      setLoading(false);
      setLoadingMore(false);
    },
    [],
  );

  // Initial + search-debounced load.
  useEffect(() => {
    void fetchPage({ reset: true, prefix: appliedSearch, afterCursor: null });
  }, [appliedSearch, fetchPage]);

  // Debounce search input → applied search.
  useEffect(() => {
    const t = setTimeout(() => setAppliedSearch(searchTerm.trim()), 250);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const handleBack = () => {
    setActiveCommunityView(null);
  };

  // Message CTA: 45-07b's DM surface owns thread lookup/creation. For now we
  // flip the view to 'dm' with a null thread id → DMInboxView dispatches.
  // 45-07b will replace this surface (or extend it) with a thread-lookup hop.
  const handleMessage = (_recipientUserId: string) => {
    setActiveDmThread(null);
    setActiveCommunityView('dm');
  };

  return (
    <div role="main" aria-label="Community directory" className="flex flex-col gap-4 pb-20">
      {/* Header */}
      <header className="flex items-start gap-3 px-4 pt-4">
        <button
          onClick={handleBack}
          aria-label="Back to community"
          className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded shrink-0"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-[var(--color-text)]">Directory</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Members who have opted in to be discoverable.
          </p>
        </div>
      </header>

      {/* Search */}
      <div className="px-4">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-text-secondary)]"
            aria-hidden
          />
          <Input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search handles…"
            aria-label="Search directory by handle"
            className="pl-9"
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div
          className="px-4 space-y-3"
          role="status"
          aria-live="polite"
          aria-label="Loading directory"
        >
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : error ? (
        <div className="px-4">
          <p className="text-sm text-[var(--color-danger,#b91c1c)]" role="alert">
            Could not load directory: {error}
          </p>
        </div>
      ) : profiles.length === 0 ? (
        <div className="px-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            No members found{appliedSearch ? ` matching "${appliedSearch}"` : ''}.
          </p>
        </div>
      ) : (
        <ul className="px-4 space-y-3" aria-label="Directory profiles">
          {profiles.map((profile) => (
            <li key={profile.id}>
              <Suspense fallback={<Skeleton className="h-24 w-full rounded-xl" />}>
                <ProfileCard
                  profile={profile}
                  currentUserId={currentUserId}
                  onMessage={handleMessage}
                />
              </Suspense>
            </li>
          ))}
        </ul>
      )}

      {/* Load more */}
      {!loading && hasMore && (
        <div className="px-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              void fetchPage({ reset: false, prefix: appliedSearch, afterCursor: cursor })
            }
            disabled={loadingMore}
            aria-label="Load more profiles"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}

export default CommunityDirectoryView;
