/**
 * Phase 44 Plan 06 — Community Feed Foundation: ReactionBar component.
 *
 * Renders the fixed 5-emoji reaction pill row for posts and comments (D-02, D-03).
 * Fixed emoji set per D-03: like, heart, target, fire, clap.
 * Toggle is idempotent via SECDEF RPC `toggle_community_reaction` (INSERT ON CONFLICT DO DELETE).
 * Optimistic UI with own-write echo dedup per Research Pitfall 6.
 *
 * T-44-05: No user content in this component — emojis are hardcoded, counts are numbers.
 */
import { useState, type JSX } from 'react';
import type { CommunityReaction, ReactionEmoji } from '@/lib/community/community-types';
import { supabase } from '@/lib/supabase';

// ─── Fixed emoji set (D-03) ───────────────────────────────────────────────────

const EMOJIS = ['like','heart','target','fire','clap'] as const;

const EMOJI_GLYPH: Record<ReactionEmoji, string> = {
  like: '👍',
  heart: '❤️',
  target: '🎯',
  fire: '🔥',
  clap: '👏',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReactionBarProps {
  targetType: 'post' | 'comment';
  targetId: string;
  /** Pre-aggregated reactions for this target (filtered by caller). */
  reactions: CommunityReaction[];
  currentUserId: string;
}

// ─── Aggregation helpers ──────────────────────────────────────────────────────

function countsByEmoji(reactions: CommunityReaction[]): Record<ReactionEmoji, number> {
  return reactions.reduce(
    (acc, r) => {
      acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
      return acc;
    },
    {} as Record<ReactionEmoji, number>,
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ReactionBar({
  targetType,
  targetId,
  reactions,
  currentUserId,
}: ReactionBarProps): JSX.Element {
  // Optimistic local overrides: map of emoji → 'added' | 'removed' | null
  // When a pending RPC call is in flight we flip this; on success we reconcile
  // with the returned aggregate; on failure we revert. (Pitfall 6 guard)
  const [optimisticDelta, setOptimisticDelta] = useState<
    Partial<Record<ReactionEmoji, 'added' | 'removed'>>
  >({});

  const baseCounts = countsByEmoji(reactions);

  async function handleToggle(emoji: ReactionEmoji) {
    const myReaction = reactions.find(
      (r) => r.user_id === currentUserId && r.emoji === emoji,
    );
    const willAdd = !myReaction;
    // Apply optimistic delta
    setOptimisticDelta((prev) => ({ ...prev, [emoji]: willAdd ? 'added' : 'removed' }));

    const { error } = await supabase.rpc('toggle_community_reaction', {
      p_target_type: targetType,
      p_target_id: targetId,
      p_emoji: emoji,
    });

    if (error) {
      // Revert on failure
      setOptimisticDelta((prev) => {
        const next = { ...prev };
        delete next[emoji];
        return next;
      });
    } else {
      // RPC succeeded — clear the optimistic override for this emoji
      // (the parent will receive a Realtime broadcast or re-fetch; we clear
      // our delta so the broadcast does not double-apply per Pitfall 6)
      setOptimisticDelta((prev) => {
        const next = { ...prev };
        delete next[emoji];
        return next;
      });
    }
  }

  return (
    <div
      className="flex flex-wrap gap-1"
      role="group"
      aria-label="Reactions"
    >
      {EMOJIS.map((emoji) => {
        const myReaction = reactions.find(
          (r) => r.user_id === currentUserId && r.emoji === emoji,
        );
        const delta = optimisticDelta[emoji];
        // Apply optimistic delta to active state
        const isActive =
          delta === 'added' ? true : delta === 'removed' ? false : !!myReaction;
        // Apply optimistic delta to count
        const baseCount = baseCounts[emoji] ?? 0;
        const count =
          delta === 'added'
            ? baseCount + (myReaction ? 0 : 1)
            : delta === 'removed'
              ? Math.max(0, baseCount - (myReaction ? 1 : 0))
              : baseCount;

        return (
          <button
            key={emoji}
            type="button"
            aria-pressed={isActive}
            aria-label={`React with ${emoji}`}
            onClick={() => void handleToggle(emoji)}
            className={[
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors',
              isActive
                ? 'bg-[var(--color-primary-soft)] border-[var(--color-primary)] text-[var(--color-primary)]'
                : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-primary-soft)]',
            ].join(' ')}
          >
            <span aria-hidden="true">{EMOJI_GLYPH[emoji]}</span>
            {count > 0 && (
              <span className="font-medium tabular-nums">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default ReactionBar;
