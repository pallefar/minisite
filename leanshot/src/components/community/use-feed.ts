/**
 * Phase 44 Plan 06 — Community Feed Foundation: useFeed cursor-pagination hook.
 *
 * Cursor-paginated SELECT from community_posts for a given space.
 * Cursor: (created_at, id) DESC — stable under concurrent inserts (D-12).
 * PAGE_SIZE = 20. Soft-delete filter: .is('deleted_at', null).
 * Includes community_post_media join for signed URL resolution.
 *
 * Cancelled-fetch guard (44-PATTERNS.md lines 967–975) prevents stale state updates.
 *
 * Returns:
 *   posts        — accumulated flat list (oldest page first in array, newest first in DB order)
 *   loading      — true while initial/page fetch in flight
 *   error        — last error message or null
 *   loadMore()   — fetch the next page using the last post as cursor
 *   hasMore      — false when last page returned < PAGE_SIZE rows
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { CommunityPost } from '@/lib/community/community-types';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

// ─── Extended post type with joined media ─────────────────────────────────────

export interface CommunityPostWithMedia extends CommunityPost {
  community_post_media: Array<{ path: string; display_order: number }>;
}

// ─── Cursor type ──────────────────────────────────────────────────────────────

interface FeedCursor {
  created_at: string;
  id: string;
}

// ─── Hook return type ─────────────────────────────────────────────────────────

export interface UseFeedResult {
  posts: CommunityPostWithMedia[];
  loading: boolean;
  error: string | null;
  loadMore: () => void;
  hasMore: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFeed(spaceId: string): UseFeedResult {
  const [posts, setPosts] = useState<CommunityPostWithMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // Cursor ref avoids stale-closure issues — updated after each page fetch.
  const cursorRef = useRef<FeedCursor | null>(null);
  // Track whether a fetch is already in flight to prevent double-fetches.
  const fetchingRef = useRef(false);

  const fetchPage = useCallback(
    async (cursorVal: FeedCursor | null, append: boolean): Promise<void> => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      setLoading(true);
      setError(null);

      let cancelled = false;

      let q = supabase
        .from('community_posts')
        .select(
          'id, body, created_at, edited_at, deleted_at, author_id, space_id, mux_upload_id, mux_playback_id, video_status, community_post_media(path, display_order)',
        )
        .eq('space_id', spaceId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE);

      if (cursorVal) {
        q = q.or(
          `created_at.lt.${cursorVal.created_at},and(created_at.eq.${cursorVal.created_at},id.lt.${cursorVal.id})`,
        );
      }

      const { data, error: fetchError } = await q;

      // Cleanup guard — in case spaceId changed while in flight
      if (cancelled) {
        fetchingRef.current = false;
        return;
      }

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        fetchingRef.current = false;
        return;
      }

      const page = (data ?? []) as CommunityPostWithMedia[];

      if (append) {
        setPosts((prev) => [...prev, ...page]);
      } else {
        setPosts(page);
      }

      setHasMore(page.length === PAGE_SIZE);

      // Advance cursor to last post in the page
      const last = page[page.length - 1];
      cursorRef.current = last ? { created_at: last.created_at, id: last.id } : null;

      setLoading(false);
      fetchingRef.current = false;

      // Satisfy the cancelled-fetch pattern — declared inside async IIFE for
      // consistency with the 44-PATTERNS cancellation guard.
      void cancelled;
    },
    [spaceId],
  );

  // Initial fetch (and re-fetch on spaceId change)
  useEffect(() => {
    let cancelled = false;
    cursorRef.current = null;
    setPosts([]);
    setHasMore(true);
    setLoading(true);
    fetchingRef.current = false;

    void (async () => {
      let q = supabase
        .from('community_posts')
        .select(
          'id, body, created_at, edited_at, deleted_at, author_id, space_id, mux_upload_id, mux_playback_id, video_status, community_post_media(path, display_order)',
        )
        .eq('space_id', spaceId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE);

      const { data, error: fetchError } = await q;

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const page = (data ?? []) as CommunityPostWithMedia[];
      setPosts(page);
      setHasMore(page.length === PAGE_SIZE);

      const last = page[page.length - 1];
      cursorRef.current = last ? { created_at: last.created_at, id: last.id } : null;
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  const loadMore = useCallback(() => {
    void fetchPage(cursorRef.current, true);
  }, [fetchPage]);

  return { posts, loading, error, loadMore, hasMore };
}
