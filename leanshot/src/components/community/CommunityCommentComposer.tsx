/**
 * Phase 44 Plan 07 — CommunityCommentComposer.
 *
 * Write-side composer for creating and editing community comments.
 *
 * Shape mirrors CommunityPostComposer but with:
 *   - INSERT to community_comments (with post_id + space_id)
 *   - Mention upsert to community_comment_mentions table
 *   - Draft key: `community_comment_draft_${postId}_${userId}`
 *   - Fires notify-community BOTH for kind='mention' AND kind='reply'
 *   - 5000-char cap (same DB CHECK constraint on community_comments per 44-01)
 *   - No image attach (image uploader is post-only, D-04)
 *
 * Bundle note: MentionTypeahead is lazy-imported so Fuse.js stays in
 * the 'community-mentions' sub-chunk and does NOT inflate 'community-feed'.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import type { CommunityComment } from '@/lib/community/community-types';
import { parseMentions } from '@/lib/community/mention-parse';
import { supabase } from '@/lib/supabase';

// Lazy-import routes Fuse.js into 'community-mentions' sub-chunk (44-09 vite rule).
const MentionTypeahead = lazy(() => import('./mentions/MentionTypeahead'));

// ─── Draft key ────────────────────────────────────────────────────────────────

const COMMENT_DRAFT_KEY = (postId: string, userId: string): string =>
  `community_comment_draft_${postId}_${userId}`;

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_BODY_LEN = 5000;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CommunityCommentComposerProps {
  postId: string;
  spaceId: string;
  currentUserId: string;
  /** When set, composer is in edit mode (D-15 edit forever). */
  editingComment?: CommunityComment;
  onSubmitted?: (commentId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommunityCommentComposer({
  postId,
  spaceId,
  currentUserId,
  editingComment,
  onSubmitted,
}: CommunityCommentComposerProps) {
  const toast = useToast();

  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Mention typeahead state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchor, setMentionAnchor] = useState<{ start: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Draft autosave ────────────────────────────────────────────────────────

  // Restore draft on mount (skip when editing an existing comment)
  useEffect(() => {
    if (editingComment) {
      setBody(editingComment.body);
      return;
    }
    try {
      const saved = localStorage.getItem(COMMENT_DRAFT_KEY(postId, currentUserId));
      if (saved) setBody(saved);
    } catch {
      // Private-mode browsers may throw; silent fail
    }
  }, [postId, currentUserId, editingComment]);

  // Autosave on change (500ms debounce)
  useEffect(() => {
    if (editingComment) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(COMMENT_DRAFT_KEY(postId, currentUserId), body);
      } catch {
        // Silent fail
      }
    }, 500);
    return () => clearTimeout(t);
  }, [body, postId, currentUserId, editingComment]);

  // ── Character cap ─────────────────────────────────────────────────────────

  const isOverLimit = body.length > MAX_BODY_LEN;

  // ── Mention trigger detection ─────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === '@') {
      setMentionQuery('');
      setMentionAnchor({ start: textareaRef.current?.selectionStart ?? 0 });
      return;
    }
    if (mentionAnchor !== null) {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
        setMentionQuery(null);
        setMentionAnchor(null);
        return;
      }
      if (e.key === 'Backspace') {
        setMentionQuery((q) => (q && q.length > 0 ? q.slice(0, -1) : null));
        if (mentionQuery === null || mentionQuery.length === 0) {
          setMentionAnchor(null);
        }
        return;
      }
      if (e.key.length === 1) {
        setMentionQuery((q) => (q ?? '') + e.key);
      }
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBody(e.target.value);
  };

  const insertMention = (handle: string) => {
    if (!textareaRef.current || mentionAnchor === null) {
      setMentionQuery(null);
      setMentionAnchor(null);
      return;
    }
    const textarea = textareaRef.current;
    const before = body.slice(0, mentionAnchor.start);
    const after = body.slice(textarea.selectionStart);
    const mention = `@${handle} `;
    setBody(before + mention + after);
    setMentionQuery(null);
    setMentionAnchor(null);
    setTimeout(() => {
      textarea.focus();
      const cursor = (before + mention).length;
      textarea.setSelectionRange(cursor, cursor);
    }, 0);
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (isOverLimit) {
      toast('Comment is too long (5000 chars max)', 'error');
      return;
    }
    if (body.trim().length === 0) {
      toast('Comment body cannot be empty', 'error');
      return;
    }

    setSubmitting(true);
    let newCommentId: string;

    try {
      if (editingComment) {
        // Edit mode (D-15): update body + edited_at
        const { error } = await supabase
          .from('community_comments')
          .update({ body: body.trim(), edited_at: new Date().toISOString() })
          .eq('id', editingComment.id)
          .eq('author_id', currentUserId);
        if (error) {
          toast('Failed to update comment — please try again.', 'error');
          setSubmitting(false);
          return;
        }
        newCommentId = editingComment.id;
      } else {
        // Create mode
        const { data, error } = await supabase
          .from('community_comments')
          .insert({
            post_id: postId,
            space_id: spaceId,
            author_id: currentUserId,
            body: body.trim(),
          })
          .select('id')
          .single();
        if (error || !data) {
          toast('Failed to post comment — please try again.', 'error');
          setSubmitting(false);
          return;
        }
        newCommentId = (data as { id: string }).id;
      }

      // Get session JWT for Edge Fn calls
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      // Fetch display_name for notification copy
      let displayName = '';
      if (accessToken) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', currentUserId)
          .single();
        displayName = (profileData as { display_name: string | null } | null)?.display_name ?? '';
      }

      // Resolve @mentions → upsert community_comment_mentions (D-14)
      const handles = parseMentions(body);
      if (handles.length > 0) {
        const { data: mentioned } = await supabase
          .from('profiles')
          .select('id, handle')
          .in('handle', handles);

        if (mentioned && mentioned.length > 0) {
          const mentionRows = (mentioned as Array<{ id: string; handle: string }>).map((row) => ({
            comment_id: newCommentId,
            user_id: row.id,
          }));
          // PK (comment_id, user_id) prevents duplicate-mention spam (T-44-06)
          await supabase
            .from('community_comment_mentions')
            .upsert(mentionRows, { onConflict: 'comment_id,user_id' });

          // Fire mention notification (D-14 fan-out)
          if (accessToken) {
            await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-community`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                kind: 'mention',
                target_type: 'comment',
                target_id: newCommentId,
                space_id: spaceId,
                mentioned_by_user_id: currentUserId,
                mentioned_by_name: displayName,
              }),
            }).catch(() => {
              // Notification is best-effort; comment is already saved
            });
          }
        }
      }

      // Fire reply notification (D-14 fan-out — notify-community skips self-reply per Plan 44-05)
      if (!editingComment && accessToken) {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-community`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            kind: 'reply',
            post_id: postId,
            comment_id: newCommentId,
            space_id: spaceId,
            commenter_user_id: currentUserId,
            commenter_name: displayName,
          }),
        }).catch(() => {
          // Notification is best-effort; comment is already saved
        });
      }

      // Clear draft from localStorage on success
      if (!editingComment) {
        try {
          localStorage.removeItem(COMMENT_DRAFT_KEY(postId, currentUserId));
        } catch {
          // Silent fail
        }
        setBody('');
      }

      setSubmitting(false);
      onSubmitted?.(newCommentId);
    } catch {
      toast('An unexpected error occurred. Please try again.', 'error');
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const charCountClass = isOverLimit
    ? 'text-[var(--color-danger)] font-semibold'
    : body.length > MAX_BODY_LEN * 0.9
      ? 'text-[var(--color-warning)]'
      : 'text-[var(--color-fg-muted)]';

  return (
    <div className="space-y-2">
      <div className="relative">
        <textarea
          ref={textareaRef}
          aria-label="Comment body"
          value={body}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder="Write a comment… Use @ to mention someone"
          className="w-full p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          disabled={submitting}
        />
        {/* MentionTypeahead — only shown when mentionQuery is non-null */}
        {mentionQuery !== null && (
          <div className="absolute left-0 z-10 mt-1 w-72">
            <Suspense fallback={null}>
              <MentionTypeahead
                query={mentionQuery}
                excludeUserIds={[currentUserId]}
                onSelect={(handle, userId) => {
                  void userId; // userId reserved for future dedup logic
                  insertMention(handle);
                }}
              />
            </Suspense>
          </div>
        )}
      </div>

      {/* Character counter */}
      <div className={`text-xs text-right ${charCountClass}`} aria-live="polite">
        {body.length} / {MAX_BODY_LEN}
        {isOverLimit && ' — too long'}
      </div>

      <div className="flex justify-end">
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleSubmit()}
          disabled={isOverLimit || submitting || body.trim().length === 0}
          aria-busy={submitting}
        >
          {submitting ? 'Posting…' : editingComment ? 'Save changes' : 'Reply'}
        </Button>
      </div>
    </div>
  );
}
