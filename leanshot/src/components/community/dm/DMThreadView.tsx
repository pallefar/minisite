/**
 * Phase 45 Plan 07b — DMThreadView.
 *
 * Replaces the 45-07a stub at leanshot/src/components/community/DMThreadView.tsx.
 * Per memory feedback_stub_then_replace_sibling_collision: same-wave sibling
 * 45-07a shipped a final-prop-signature stub; this plan ships the real surface.
 *
 * Responsibilities (truth-bound from 45-07b PLAN must_haves):
 *   - Virtualized message list via react-virtuoso (already in deps; same package
 *     already used by BodyTab.tsx for the photo grid). Variable-height items, so
 *     <Virtuoso> rather than <VirtuosoGrid>.
 *   - Per-message body rendered via Phase 44 renderPostBodyHtml so the same
 *     dompurify allowlist applies to DM bodies (T-45-05). NO new DOMPurify
 *     instantiation in this file — the grep gate in <verify> enforces this.
 *   - Image attachments resolved via getDmAttachmentSignedUrl helper from 45-03
 *     (5 MB cap + jpeg/png/webp whitelist enforced upstream in the uploader).
 *   - <ReportButton targetType="dm_message" targetId={m.id} /> mounted per row
 *     so any participant can report (the 45-07a ReportButton ships the modal).
 *   - On mount call public.update_community_last_active() (D-20 5-min presence
 *     debounce; matches the inbox focus-ping so opening a thread also counts).
 *   - DMComposer (Task 2) rendered at the bottom in `mode="reply"` so each new
 *     message direct-inserts into direct_messages (rate-limit only applies to
 *     NEW threads — D-07).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { Virtuoso } from 'react-virtuoso';

import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { renderPostBodyHtml } from '@/lib/community/dompurify-config';
import { getDmAttachmentSignedUrl } from '@/lib/community/community-storage';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

import { ReportButton } from '../ReportButton';
import { useDmInboxRealtime } from '../use-dm-inbox-realtime';
import { DMComposer } from './DMComposer';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DirectMessageRow {
  id: string;
  thread_id: string;
  sender_user_id: string;
  body: string;
  attachment_path: string | null;
  created_at: string;
}

interface ThreadCounterparty {
  user_id: string;
  handle: string | null;
  display_name: string | null;
}

export interface DMThreadViewProps {
  threadId: string;
  currentUserId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DMThreadView({ threadId, currentUserId }: DMThreadViewProps): JSX.Element {
  const setActiveDmThread = useStore((s) => s.setActiveDmThread);

  const [messages, setMessages] = useState<DirectMessageRow[] | null>(null);
  const [counterparty, setCounterparty] = useState<ThreadCounterparty | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Signed-URL cache keyed by attachment_path. 60-min TTL matches D-09; once a
  // URL is in the cache we never re-sign during the session — Map keeps this
  // identity-stable so Virtuoso item renders are cheap.
  const signedUrlCache = useRef<Map<string, string>>(new Map());

  // ── Fetch thread + messages ─────────────────────────────────────────────────
  useEffect(() => {
    if (!threadId || !currentUserId) return;
    let cancelled = false;

    async function fetchThread(): Promise<void> {
      // Read the thread row to identify the counterparty (RLS rejects if not a
      // participant).
      const { data: threadRow, error: threadErr } = await supabase
        .from('dm_threads')
        .select('id, creator_user_id, recipient_user_id')
        .eq('id', threadId)
        .single();
      if (threadErr || !threadRow) {
        if (!cancelled) setMessages([]);
        return;
      }
      const tr = threadRow as {
        id: string;
        creator_user_id: string;
        recipient_user_id: string;
      };
      const counterpartyId =
        tr.creator_user_id === currentUserId ? tr.recipient_user_id : tr.creator_user_id;

      const { data: profileRow } = await supabase
        .from('profiles')
        .select('id, handle, display_name')
        .eq('id', counterpartyId)
        .single();
      if (!cancelled && profileRow) {
        const p = profileRow as { id: string; handle: string | null; display_name: string | null };
        setCounterparty({
          user_id: p.id,
          handle: p.handle,
          display_name: p.display_name,
        });
      }

      // Message rows: oldest-first so Virtuoso scrolls bottom-up naturally
      // (initialTopMostItemIndex = messages.length - 1).
      const { data: msgRows, error: msgErr } = await supabase
        .from('direct_messages')
        .select('id, thread_id, sender_user_id, body, attachment_path, created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .limit(500); // hard cap for the initial paint; v1.3 may paginate
      if (msgErr || !msgRows) {
        if (!cancelled) setMessages([]);
        return;
      }
      if (!cancelled) setMessages(msgRows as DirectMessageRow[]);
    }

    void fetchThread();
    return () => {
      cancelled = true;
    };
  }, [threadId, currentUserId, refreshNonce]);

  // ── Realtime — re-fetch on new INSERT scoped to this thread ────────────────
  // Reuses the per-user inbox channel (dm:${userId}) from 45-07a. The handler
  // filters to this thread so unrelated thread inserts don't trigger a re-fetch
  // here (the inbox view handles those).
  const handleInboxMessage = useCallback(
    (msg: { thread_id: string; sender_user_id: string }) => {
      if (msg.thread_id === threadId) {
        setRefreshNonce((n) => n + 1);
      }
    },
    [threadId],
  );
  useDmInboxRealtime(currentUserId || null, handleInboxMessage);

  // ── D-20 presence debounce — fire update_community_last_active on mount ────
  useEffect(() => {
    if (!currentUserId) return;
    // Wrap in Promise.resolve() so a rejection becomes a no-op catch (the
    // PostgrestFilterBuilder returned by .rpc() is thenable but its return
    // type does not expose .catch directly).
    void Promise.resolve(supabase.rpc('update_community_last_active')).then(
      () => undefined,
      () => undefined,
    );
  }, [currentUserId, threadId]);

  // Counterparty header label
  const headerLabel = useMemo(() => {
    if (!counterparty) return '';
    return counterparty.display_name ?? counterparty.handle ?? 'Unknown';
  }, [counterparty]);

  const handleBack = useCallback(() => {
    setActiveDmThread(null);
  }, [setActiveDmThread]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (messages === null) {
    return (
      <div className="p-4 space-y-2" role="status" aria-live="polite" aria-label="Loading thread">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-12 w-3/4 rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 p-3 border-b border-[var(--color-border)]">
        <button
          type="button"
          onClick={handleBack}
          className="text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] rounded-md px-2 py-1"
          aria-label="Back to inbox"
        >
          ← Inbox
        </button>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-[var(--color-text)] truncate">
            {headerLabel || ' '}
          </span>
          {counterparty?.handle ? (
            <span className="text-xs text-[var(--color-fg-muted)] truncate">
              @{counterparty.handle}
            </span>
          ) : null}
        </div>
      </div>

      {/* ── Message list (virtualized) ─────────────────────────────────────── */}
      <div className="flex-1 min-h-[300px]">
        {messages.length === 0 ? (
          <EmptyState
            title="No messages yet"
            body="Send the first message below to start the conversation."
          />
        ) : (
          <Virtuoso
            data={messages}
            initialTopMostItemIndex={Math.max(0, messages.length - 1)}
            itemContent={(_idx, m) => (
              <MessageRow message={m} isMine={m.sender_user_id === currentUserId} signedUrlCache={signedUrlCache.current} />
            )}
            // followOutput keeps the view pinned to the latest message when
            // new INSERTs arrive (matches the inbox-realtime nonce bump above).
            followOutput="smooth"
          />
        )}
      </div>

      {/* ── Composer (reply mode — direct insert; no rate-limit per D-07) ──── */}
      <div className="border-t border-[var(--color-border)]">
        <DMComposer
          mode="reply"
          threadId={threadId}
          recipientUserId={counterparty?.user_id ?? ''}
          currentUserId={currentUserId}
          onSent={() => setRefreshNonce((n) => n + 1)}
        />
      </div>
    </div>
  );
}

// ─── Message row ──────────────────────────────────────────────────────────────

interface MessageRowProps {
  message: DirectMessageRow;
  isMine: boolean;
  signedUrlCache: Map<string, string>;
}

function MessageRow({ message, isMine, signedUrlCache }: MessageRowProps): JSX.Element {
  const [signedUrl, setSignedUrl] = useState<string | null>(() =>
    message.attachment_path ? (signedUrlCache.get(message.attachment_path) ?? null) : null,
  );

  // Resolve signed URL once per attachment_path (cached across renders/items).
  useEffect(() => {
    if (!message.attachment_path) return;
    if (signedUrlCache.has(message.attachment_path)) {
      setSignedUrl(signedUrlCache.get(message.attachment_path) ?? null);
      return;
    }
    let cancelled = false;
    void getDmAttachmentSignedUrl(message.attachment_path).then((res) => {
      if (cancelled) return;
      if ('url' in res) {
        signedUrlCache.set(message.attachment_path as string, res.url);
        setSignedUrl(res.url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [message.attachment_path, signedUrlCache]);

  // T-45-05: body sanitized via Phase 44 renderPostBodyHtml (no new DOMPurify).
  // DMs have no soft-delete tombstone yet, so deleted_at: null is correct for
  // every row; if v1.3 adds DM soft-delete, the helper will surface the same
  // <em>[deleted]</em> tombstone with no call-site change.
  const sanitizedBody = renderPostBodyHtml({ body: message.body, deleted_at: null });

  const alignClass = isMine ? 'items-end' : 'items-start';
  const bubbleClass = isMine
    ? 'bg-[var(--color-accent-subtle,var(--color-surface-elevated))] text-[var(--color-text)]'
    : 'bg-[var(--color-surface-elevated)] text-[var(--color-text)]';

  return (
    <div className={`px-3 py-1.5 flex flex-col ${alignClass}`}>
      <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${bubbleClass}`}>
        <div
          className="prose prose-sm max-w-none break-words"
          // T-45-05: sanitizeCommunityMarkdown is the XSS chokepoint — the body
          // arrives here ALREADY sanitized via renderPostBodyHtml above.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: sanitizedBody }}
        />
        {message.attachment_path ? (
          signedUrl ? (
            <img
              src={signedUrl}
              alt="DM attachment"
              loading="lazy"
              className="mt-2 max-h-72 rounded-lg border border-[var(--color-border)]"
            />
          ) : (
            <Skeleton className="mt-2 h-40 w-48 rounded-lg" />
          )
        ) : null}
      </div>
      <div className="flex items-center gap-2 mt-1 text-xs text-[var(--color-fg-muted)]">
        <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time>
        <ReportButton targetType="dm_message" targetId={message.id} />
      </div>
    </div>
  );
}

export default DMThreadView;
