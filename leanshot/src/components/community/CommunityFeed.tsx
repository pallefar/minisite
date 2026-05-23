/**
 * Phase 44 Plan 06 — Community Feed Foundation: CommunityFeed.
 *
 * Cursor-paginated feed list scoped to one space. Calls useFeed(spaceId) for
 * the post list and resolves signed URLs for each post's media.
 *
 * Signed URL caching: resolved once per post on first render; cached in a ref keyed
 * by storage path. TTL = 60 min (matches SIGNED_URL_TTL in community-storage.ts).
 *
 * Realtime wiring: exposes `refreshNonce?: number` prop so 44-09 can trigger a
 * re-fetch by incrementing the nonce when the per-space Realtime channel fires.
 *
 * Reactions: fetched in bulk after feed loads via a single
 * `from('community_reactions').select().in('target_id', postIds)` query (option B
 * per plan — avoids over-fetching reactions inline in the feed query).
 *
 * Empty state: "No posts yet" card rendered when !loading && posts.length === 0.
 * Load More: button shown when hasMore.
 *
 * T-44-01 mitigation: query scoped to spaceId; RLS on community_posts is the gate.
 */
import { useEffect, useRef, useState, type JSX } from 'react';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { getCommunityMediaSignedUrl } from '@/lib/community/community-storage';
import type { CommunityReaction } from '@/lib/community/community-types';
import { supabase } from '@/lib/supabase';

import { CommunityPost } from './CommunityPost';
import { useFeed } from './use-feed';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommunityFeedProps {
  spaceId: string;
  currentUserId: string;
  /** 44-09 entry seam: bump to trigger a re-fetch when Realtime fires. */
  refreshNonce?: number;
  onEditPost?: (postId: string) => void;
  onDeletePost?: (postId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommunityFeed({
  spaceId,
  currentUserId,
  refreshNonce,
  onEditPost,
  onDeletePost,
}: CommunityFeedProps): JSX.Element {
  const { posts, loading, error, loadMore, hasMore } = useFeed(spaceId);

  // Signed URL cache: path → { url, resolvedAt }
  const urlCacheRef = useRef<Map<string, { url: string; resolvedAt: number }>>(new Map());
  const [mediaSignedUrls, setMediaSignedUrls] = useState<Record<string, string>>({});

  // Reactions: keyed by target_id → flat array of reactions for that post
  const [reactionsByPost, setReactionsByPost] = useState<Record<string, CommunityReaction[]>>({});

  // Resolve signed URLs for all media paths in the loaded posts
  useEffect(() => {
    if (posts.length === 0) return;

    let cancelled = false;

    void (async () => {
      const allPaths: string[] = [];
      for (const post of posts) {
        for (const m of post.community_post_media) {
          const cached = urlCacheRef.current.get(m.path);
          const TTL_MS = 50 * 60 * 1000; // refresh at 50 min (10 min buffer vs 60 min TTL)
          if (!cached || Date.now() - cached.resolvedAt > TTL_MS) {
            allPaths.push(m.path);
          }
        }
      }

      if (allPaths.length === 0) return;

      const results = await Promise.all(
        allPaths.map((path) => getCommunityMediaSignedUrl(path).then((r) => ({ path, r }))),
      );

      if (cancelled) return;

      const newUrls: Record<string, string> = {};
      for (const { path, r } of results) {
        if ('url' in r) {
          urlCacheRef.current.set(path, { url: r.url, resolvedAt: Date.now() });
          newUrls[path] = r.url;
        }
      }

      // Merge with cached URLs
      const merged: Record<string, string> = {};
      for (const [path, entry] of urlCacheRef.current.entries()) {
        merged[path] = entry.url;
      }
      setMediaSignedUrls((prev) => ({ ...prev, ...merged, ...newUrls }));
    })();

    return () => {
      cancelled = true;
    };
  }, [posts]);

  // Fetch reactions for all loaded posts
  useEffect(() => {
    if (posts.length === 0) return;

    let cancelled = false;

    void (async () => {
      const postIds = posts.map((p) => p.id);

      const { data } = await supabase
        .from('community_reactions')
        .select('id, user_id, target_type, target_id, emoji, created_at')
        .eq('target_type', 'post')
        .in('target_id', postIds);

      if (cancelled) return;

      const reactions = (data ?? []) as CommunityReaction[];
      const byPost: Record<string, CommunityReaction[]> = {};
      for (const r of reactions) {
        if (!byPost[r.target_id]) byPost[r.target_id] = [];
        byPost[r.target_id].push(r);
      }
      setReactionsByPost(byPost);
    })();

    return () => {
      cancelled = true;
    };
  }, [posts]);

  // refreshNonce wiring: 44-09 bumps this to trigger a re-fetch.
  // useFeed already re-runs on spaceId change; here we use a key trick — when
  // refreshNonce changes, the feed consumer (44-09) can reset state by passing
  // a new key prop to CommunityFeed. For now we just track the nonce for 44-09.
  const prevNonceRef = useRef(refreshNonce);
  useEffect(() => {
    if (refreshNonce !== prevNonceRef.current) {
      prevNonceRef.current = refreshNonce;
      // 44-09 wiring: trigger re-fetch by resetting feed state.
      // useFeed hook re-initializes on spaceId change; for nonce-based refresh
      // 44-09 will pass a refreshKey prop — this effect documents the seam.
    }
  }, [refreshNonce]);

  if (error) {
    return (
      <div
        role="alert"
        className="text-sm text-[var(--color-destructive)] py-4 text-center"
      >
        Failed to load posts: {error}
      </div>
    );
  }

  return (
    <section aria-label="Community feed" className="flex flex-col gap-4">
      {loading && posts.length === 0 ? (
        <div className="text-sm text-[var(--color-fg-muted)] py-6 text-center" aria-busy="true">
          Loading posts…
        </div>
      ) : (
        <>
          {posts.length === 0 ? (
            <EmptyState
              title="No posts yet"
              body="Be the first to post in this space."
              inline
            />
          ) : (
            <ul
              role="list"
              aria-label="Posts in this space"
              className="flex flex-col gap-4"
            >
              {posts.map((post) => (
                <li key={post.id} role="listitem">
                  <CommunityPost
                    post={post}
                    reactions={reactionsByPost[post.id] ?? []}
                    mediaSignedUrls={mediaSignedUrls}
                    currentUserId={currentUserId}
                    onEdit={onEditPost}
                    onDelete={onDeletePost}
                  />
                </li>
              ))}
            </ul>
          )}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="ghost"
                aria-label="Load more posts"
                onClick={loadMore}
                aria-busy={loading}
              >
                {loading ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default CommunityFeed;
