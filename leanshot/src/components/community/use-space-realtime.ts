/**
 * Phase 44 Plan 09 — Community Realtime hook: per-space channel.
 *
 * Subscribes to postgres_changes for:
 *   - community_posts INSERT, filter space_id=eq.{spaceId}
 *   - community_comments INSERT, filter space_id=eq.{spaceId} (denormalized space_id per 44-01 Pitfall 5)
 *   - community_reactions event: '*' (no space filter — small broadcast, rate-limited by user action)
 *
 * Single channel per mounted space view (D-13). Torn down on unmount.
 * onUpdate is intentionally excluded from useEffect deps — callers must memoize.
 *
 * Analog: src/components/clinic/roster/use-roster-realtime.ts
 */
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export function useSpaceRealtime(spaceId: string, onUpdate: () => void): void {
  useEffect(() => {
    if (!spaceId) return;

    const channel = supabase
      .channel(`community:${spaceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_posts', filter: `space_id=eq.${spaceId}` },
        () => onUpdate(),
      )
      .on(
        'postgres_changes',
        // community_comments.space_id is denormalized per Pitfall 5 (44-01)
        // DON'T use a post_id join filter here — space_id is the direct column.
        { event: 'INSERT', schema: 'public', table: 'community_comments', filter: `space_id=eq.${spaceId}` },
        () => onUpdate(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'community_reactions' },
        () => onUpdate(),
      )
      .subscribe((status: string) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[community-realtime] channel error — live updates paused');
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
    // onUpdate intentionally excluded from deps — callers must memoize.
    // Re-subscribing on every render would leak channels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);
}
