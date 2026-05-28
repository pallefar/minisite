/**
 * Phase 44 Plan 06 — Community Feed Foundation: CommunityPost card.
 *
 * Renders a single community post with:
 *   - Sanitized markdown body via sanitizeCommunityMarkdown + ReactMarkdown (T-44-05)
 *   - Soft-delete tombstone: `[deleted]` when deleted_at is set (D-15)
 *   - (edited) marker when edited_at is set (D-15)
 *   - ReactionBar for per-post reactions (D-02)
 *   - CommunityPostMediaStrip for media delegation (stub in 44-06; replaced by 44-08)
 *   - Edit/Delete controls visible only to the post author
 *
 * T-44-05: body passes through sanitizeCommunityMarkdown before ReactMarkdown render.
 * No direct @mux/* import; no image.mux.com URL — all media delegated to CommunityPostMediaStrip.
 */
import { type JSX } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { Card } from '@/components/ui/Card';
import type { CommunityPostWithMedia, CommunityReaction } from '@/lib/community/community-types';
import { sanitizeCommunityMarkdown } from '@/lib/community/dompurify-config';
import { CommunityPostMediaStrip } from './CommunityPostMediaStrip';
import { ReactionBar } from './ReactionBar';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommunityPostProps {
  post: CommunityPostWithMedia;
  /** Pre-fetched aggregate reactions; filtered to (target_type='post', target_id=post.id) by caller. */
  reactions: CommunityReaction[];
  /** Storage path → signed URL; pre-resolved by CommunityFeed. */
  mediaSignedUrls: Record<string, string>;
  currentUserId: string;
  onEdit?: (postId: string) => void;
  onDelete?: (postId: string) => void;
}

// ─── Relative timestamp ───────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export function CommunityPost({
  post,
  reactions,
  mediaSignedUrls,
  currentUserId,
  onEdit,
  onDelete,
}: CommunityPostProps): JSX.Element {
  const isAuthor = post.author_id === currentUserId;
  const isDeleted = post.deleted_at !== null;

  // T-44-05: sanitize body before passing to ReactMarkdown.
  // If deleted_at is set, renderPostBodyHtml returns '<em>[deleted]</em>' (D-15).
  const sanitizedBody = isDeleted ? '<em>[deleted]</em>' : sanitizeCommunityMarkdown(post.body);

  // Display name: author_id truncated as fallback until profile join is wired by 44-09.
  const displayName = post.author_id ? `User ${post.author_id.slice(0, 8)}` : 'Unknown';

  return (
    <article aria-label={`Post by ${displayName}`} className="flex flex-col gap-3">
      <Card variant="default" padding="md">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {/* Avatar placeholder — profile join wired in 44-09 */}
            <div
              className="w-8 h-8 rounded-full bg-[var(--color-surface-elevated)] border border-[var(--color-border)] flex items-center justify-center text-xs font-medium text-[var(--color-fg-muted)]"
              aria-hidden="true"
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-[var(--color-text)]">{displayName}</span>
              <div className="flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]">
                <time dateTime={post.created_at}>{relativeTime(post.created_at)}</time>
                {post.edited_at && (
                  <span className="text-xs text-[var(--color-fg-muted)]">(edited)</span>
                )}
              </div>
            </div>
          </div>

          {/* ── Author controls (edit/delete) ──────────────────────────── */}
          {isAuthor && !isDeleted && (
            <div className="flex items-center gap-1">
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(post.id)}
                  aria-label="Edit post"
                  className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-text)] px-1.5 py-0.5 rounded transition-colors"
                >
                  Edit
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(post.id)}
                  aria-label="Delete post"
                  className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-destructive)] px-1.5 py-0.5 rounded transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <article className="prose prose-sm max-w-none mt-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
            {sanitizedBody}
          </ReactMarkdown>
        </article>

        {/* ── Media strip (stub; 44-08 replaces with real implementation) ── */}
        <CommunityPostMediaStrip post={post} mediaSignedUrls={mediaSignedUrls} />

        {/* ── Footer: reactions ──────────────────────────────────────────── */}
        <div className="mt-3">
          <ReactionBar
            targetType="post"
            targetId={post.id}
            reactions={reactions}
            currentUserId={currentUserId}
          />
        </div>
      </Card>
    </article>
  );
}

export default CommunityPost;
