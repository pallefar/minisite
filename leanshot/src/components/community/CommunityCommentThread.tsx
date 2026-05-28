/**
 * Phase 44 Plan 06 — Community Feed Foundation: CommunityCommentThread.
 *
 * Renders a flat 1-level comment list under a post (D-01: no reply-to-comment).
 * Schema ships `parent_comment_id` nullable for Phase 45+ depth-lifting; UI enforces
 * depth=1 in v1.
 *
 * Soft-delete render: comments with deleted_at !== null show `[deleted]` tombstone (D-15).
 * Edit/Delete buttons visible only to the comment author.
 * Per-comment ReactionBar using targetType='comment' (D-02).
 *
 * Composer slot: renders {children} or <CommentComposerPlaceholder /> for 44-07 to fill.
 *
 * T-44-05: comment bodies pass through sanitizeCommunityMarkdown before ReactMarkdown render.
 */
import { useEffect, useState, type JSX, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import type { CommunityComment, CommunityReaction } from '@/lib/community/community-types';
import { sanitizeCommunityMarkdown } from '@/lib/community/dompurify-config';
import { supabase } from '@/lib/supabase';
import { ReactionBar } from './ReactionBar';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommunityCommentThreadProps {
  postId: string;
  spaceId: string;
  currentUserId: string;
  /** Slot for the comment composer (owned by 44-07). */
  children?: ReactNode;
}

// ─── Relative timestamp (mirrors CommunityPost helper) ───────────────────────

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ─── CommentComposerPlaceholder (slot — 44-07 replaces with real composer) ───

function CommentComposerPlaceholder(): JSX.Element {
  return (
    <div
      className="text-xs text-[var(--color-fg-muted)] italic px-2 py-3 border border-dashed border-[var(--color-border)] rounded-lg"
      aria-label="Comment composer placeholder"
    >
      Comment composer (44-07)
    </div>
  );
}

// ─── Single comment row ───────────────────────────────────────────────────────

interface CommentRowProps {
  comment: CommunityComment;
  reactions: CommunityReaction[];
  currentUserId: string;
  onEdit?: (commentId: string) => void;
  onDelete?: (commentId: string) => void;
}

function CommentRow({
  comment,
  reactions,
  currentUserId,
  onEdit,
  onDelete,
}: CommentRowProps): JSX.Element {
  const isAuthor = comment.author_id === currentUserId;
  const isDeleted = comment.deleted_at !== null;

  // T-44-05: sanitize body at render trust boundary (D-15 tombstone handling).
  const sanitizedBody = isDeleted ? '<em>[deleted]</em>' : sanitizeCommunityMarkdown(comment.body);

  const displayName = comment.author_id ? `User ${comment.author_id.slice(0, 8)}` : 'Unknown';

  const commentReactions = reactions.filter(
    (r) => r.target_type === 'comment' && r.target_id === comment.id,
  );

  return (
    <li className="flex flex-col gap-2 py-2 border-b border-[var(--color-border)] last:border-b-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-full bg-[var(--color-surface-elevated)] border border-[var(--color-border)] flex items-center justify-center text-xs font-medium text-[var(--color-fg-muted)]"
            aria-hidden="true"
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-[var(--color-text)]">{displayName}</span>
            <time dateTime={comment.created_at} className="text-xs text-[var(--color-fg-muted)]">
              {relativeTime(comment.created_at)}
            </time>
            {comment.edited_at && !isDeleted && (
              <span className="text-xs text-[var(--color-fg-muted)]">(edited)</span>
            )}
          </div>
        </div>

        {/* Author controls */}
        {isAuthor && !isDeleted && (
          <div className="flex items-center gap-1">
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(comment.id)}
                aria-label="Edit comment"
                className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-text)] px-1 py-0.5 rounded transition-colors"
              >
                Edit
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(comment.id)}
                aria-label="Delete comment"
                className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-destructive)] px-1 py-0.5 rounded transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="prose prose-sm max-w-none ps-8">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
          {sanitizedBody}
        </ReactMarkdown>
      </div>

      {/* Reactions */}
      <div className="ps-8">
        <ReactionBar
          targetType="comment"
          targetId={comment.id}
          reactions={commentReactions}
          currentUserId={currentUserId}
        />
      </div>
    </li>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CommunityCommentThread({
  postId,
  spaceId: _spaceId,
  currentUserId,
  children,
}: CommunityCommentThreadProps): JSX.Element {
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [reactions, setReactions] = useState<CommunityReaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch comments on mount / postId change — cancelled-fetch guard (44-PATTERNS.md lines 967–975)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void (async () => {
      const { data } = await supabase
        .from('community_comments')
        .select(
          'id, post_id, space_id, parent_comment_id, author_id, body, created_at, edited_at, deleted_at',
        )
        .eq('post_id', postId)
        .order('created_at', { ascending: true });

      if (cancelled) return;
      const loaded = (data ?? []) as CommunityComment[];
      setComments(loaded);

      // Fetch reactions for all comments in this thread
      if (loaded.length > 0) {
        const commentIds = loaded.map((c) => c.id);
        const { data: rxData } = await supabase
          .from('community_reactions')
          .select('id, user_id, target_type, target_id, emoji, created_at')
          .eq('target_type', 'comment')
          .in('target_id', commentIds);

        if (!cancelled) {
          setReactions((rxData ?? []) as CommunityReaction[]);
        }
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [postId]);

  return (
    <section aria-label="Comments" className="flex flex-col gap-3 mt-2">
      {/* Comment list */}
      {loading ? (
        <div className="text-xs text-[var(--color-fg-muted)] py-2">Loading comments…</div>
      ) : (
        <ul className="flex flex-col">
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              reactions={reactions}
              currentUserId={currentUserId}
              // Edit/Delete callbacks: wired by 44-07; not in scope for 44-06 read-path
            />
          ))}
          {comments.length === 0 && (
            <li className="text-xs text-[var(--color-fg-muted)] py-2 italic">No comments yet.</li>
          )}
        </ul>
      )}

      {/* Composer slot — 44-07 passes <CommentComposer> as children */}
      {children ?? <CommentComposerPlaceholder />}
    </section>
  );
}

export default CommunityCommentThread;
