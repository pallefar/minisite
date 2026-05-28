/**
 * Phase 44 Plan 07 — CommunityPostComposer.
 *
 * Write-side composer for creating and editing community posts.
 *
 * Features:
 *   - Markdown textarea with 5000-char client cap (D-11)
 *   - Draft autosave to localStorage key `community_draft_${spaceId}_${userId}` (500ms debounce, D-11)
 *   - Draft restored on remount; cleared on successful submit
 *   - @mention typeahead via lazy-loaded MentionTypeahead (→ community-mentions chunk)
 *   - Submit resolves @mentions via parseMentions → upserts community_post_mentions
 *   - Fires notify-community Edge Fn with kind='mention' using session JWT
 *   - Edit-forever mode (editingPost prop): updates edited_at + body (D-15)
 *   - Markdown preview tab using sanitizeCommunityMarkdown (T-44-05 XSS defense)
 *
 * Bundle note: MentionTypeahead is lazy-imported so Fuse.js stays in
 * the 'community-mentions' sub-chunk and does NOT inflate 'community-feed'.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import type { CommunityPost } from '@/lib/community/community-types';
import { sanitizeCommunityMarkdown } from '@/lib/community/dompurify-config';
import { parseMentions } from '@/lib/community/mention-parse';
import { supabase } from '@/lib/supabase';

// Lazy-import routes Fuse.js into 'community-mentions' sub-chunk (44-09 vite rule).
const MentionTypeahead = lazy(() => import('./mentions/MentionTypeahead'));

// ─── Draft key ────────────────────────────────────────────────────────────────

const DRAFT_KEY = (spaceId: string, userId: string): string =>
  `community_draft_${spaceId}_${userId}`;

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_BODY_LEN = 5000;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CommunityPostComposerProps {
  spaceId: string;
  currentUserId: string;
  /** When set, composer is in edit mode (D-15 edit forever). */
  editingPost?: CommunityPost;
  onSubmitted?: (postId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommunityPostComposer({
  spaceId,
  currentUserId,
  editingPost,
  onSubmitted,
}: CommunityPostComposerProps) {
  const toast = useToast();

  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  // Mention typeahead state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchor, setMentionAnchor] = useState<{ start: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Draft autosave (D-11) ──────────────────────────────────────────────────

  // Restore draft on mount (skip when editing an existing post)
  useEffect(() => {
    if (editingPost) {
      setBody(editingPost.body);
      return;
    }
    try {
      const saved = localStorage.getItem(DRAFT_KEY(spaceId, currentUserId));
      if (saved) setBody(saved);
    } catch {
      // Private-mode browsers may throw; silent fail per CLAUDE.md error-handling
    }
  }, [spaceId, currentUserId, editingPost]);

  // Autosave on change (500ms debounce)
  useEffect(() => {
    if (editingPost) return; // Don't overwrite draft with edit-mode content
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY(spaceId, currentUserId), body);
      } catch {
        // Private-mode browsers may throw; silent fail
      }
    }, 500);
    return () => clearTimeout(t);
  }, [body, spaceId, currentUserId, editingPost]);

  // ── Character cap (D-11) ──────────────────────────────────────────────────

  const isOverLimit = body.length > MAX_BODY_LEN;

  // ── Mention trigger detection ─────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Open typeahead on '@'
    if (e.key === '@') {
      setMentionQuery('');
      setMentionAnchor({ start: textareaRef.current?.selectionStart ?? 0 });
      return;
    }
    // Close typeahead on space, newline, or Escape
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
      // Append printable characters to query
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
    // Restore focus
    setTimeout(() => {
      textarea.focus();
      const cursor = (before + mention).length;
      textarea.setSelectionRange(cursor, cursor);
    }, 0);
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (isOverLimit) {
      toast('Post is too long (5000 chars max)', 'error');
      return;
    }
    if (body.trim().length === 0) {
      toast('Post body cannot be empty', 'error');
      return;
    }

    setSubmitting(true);
    let newPostId: string;

    try {
      if (editingPost) {
        // Edit mode (D-15): update body + edited_at; RLS rejects if not author
        const { error } = await supabase
          .from('community_posts')
          .update({ body: body.trim(), edited_at: new Date().toISOString() })
          .eq('id', editingPost.id)
          .eq('author_id', currentUserId);
        if (error) {
          toast('Failed to update post — please try again.', 'error');
          setSubmitting(false);
          return;
        }
        newPostId = editingPost.id;
      } else {
        // Create mode
        const { data, error } = await supabase
          .from('community_posts')
          .insert({ space_id: spaceId, author_id: currentUserId, body: body.trim() })
          .select('id')
          .single();
        if (error || !data) {
          toast('Failed to post — please try again.', 'error');
          setSubmitting(false);
          return;
        }
        newPostId = (data as { id: string }).id;
      }

      // Resolve @mentions → upsert community_post_mentions (D-14)
      const handles = parseMentions(body);
      if (handles.length > 0) {
        const { data: mentioned } = await supabase
          .from('profiles')
          .select('id, handle')
          .in('handle', handles);

        if (mentioned && mentioned.length > 0) {
          const mentionRows = (mentioned as Array<{ id: string; handle: string }>).map((row) => ({
            post_id: newPostId,
            user_id: row.id,
          }));
          // PK (post_id, user_id) prevents duplicate-mention spam (T-44-06)
          await supabase
            .from('community_post_mentions')
            .upsert(mentionRows, { onConflict: 'post_id,user_id' });

          // Fire notify-community Edge Fn with session JWT (D-14 fan-out)
          // Plan 44-05 ships native dual-auth: service-role OR user JWT with sub self-check
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData?.session?.access_token;

          if (accessToken) {
            // Fetch display_name for notification copy
            const { data: profileData } = await supabase
              .from('profiles')
              .select('display_name')
              .eq('id', currentUserId)
              .single();
            const displayName =
              (profileData as { display_name: string | null } | null)?.display_name ?? '';

            await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-community`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                kind: 'mention',
                target_type: 'post',
                target_id: newPostId,
                space_id: spaceId,
                mentioned_by_user_id: currentUserId,
                mentioned_by_name: displayName,
              }),
            }).catch(() => {
              // Notification is best-effort; post is already saved
            });
          }
        }
      }

      // Clear draft from localStorage on success
      if (!editingPost) {
        try {
          localStorage.removeItem(DRAFT_KEY(spaceId, currentUserId));
        } catch {
          // Silent fail
        }
        setBody('');
      }

      setSubmitting(false);
      onSubmitted?.(newPostId);
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
    <div className="space-y-3">
      {/* Preview / Write toggle */}
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setPreviewMode(false)}
          className={`px-3 py-1 rounded-md ${!previewMode ? 'bg-[var(--color-surface-elevated)] font-medium' : 'text-[var(--color-fg-muted)]'}`}
        >
          Write
        </button>
        <button
          type="button"
          onClick={() => setPreviewMode(true)}
          className={`px-3 py-1 rounded-md ${previewMode ? 'bg-[var(--color-surface-elevated)] font-medium' : 'text-[var(--color-fg-muted)]'}`}
        >
          Preview
        </button>
      </div>

      {previewMode ? (
        <div
          className="min-h-[120px] p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] prose prose-sm max-w-none"
          // T-44-05: sanitizeCommunityMarkdown is the XSS chokepoint (DOMPurify allowlist + FORBID_TAGS)

          dangerouslySetInnerHTML={{ __html: sanitizeCommunityMarkdown(body) }}
        />
      ) : (
        <div className="relative">
          <textarea
            ref={textareaRef}
            aria-label="Post body"
            value={body}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            rows={6}
            placeholder="Write your post… Use @ to mention someone"
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
      )}

      {/* Character counter (aria-live for screen reader updates) */}
      <div className={`text-xs text-end ${charCountClass}`} aria-live="polite">
        {body.length} / {MAX_BODY_LEN}
        {isOverLimit && ' — too long'}
      </div>

      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={() => void handleSubmit()}
          disabled={isOverLimit || submitting || body.trim().length === 0}
          aria-busy={submitting}
        >
          {submitting ? 'Posting…' : editingPost ? 'Save changes' : 'Post'}
        </Button>
      </div>
    </div>
  );
}
