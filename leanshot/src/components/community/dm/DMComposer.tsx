/**
 * Phase 45 Plan 07b — DMComposer.
 *
 * Replaces the Task-1 placeholder; ships the real composer surface.
 *
 * Two operating modes:
 *   mode="new"   — composer rendered standalone before a thread exists. The
 *                  Send button calls supabase.functions.invoke('dm-create-thread',
 *                  { body: { recipient_user_id, body, attachment_path?,
 *                  creator_user_id } }). On 201 the Fn returns
 *                  { thread_id, message_id } and we setActiveDmThread(thread_id)
 *                  so the dispatcher flips to DMThreadView.
 *   mode="reply" — composer rendered inside an existing thread. Send issues a
 *                  direct insert into direct_messages (no rate-limit on replies
 *                  per D-07; only new-thread creation is throttled).
 *
 * Error handling (D-06, D-07, D-10):
 *   429 + Retry-After → toast "You can only start 3 new conversations per day.
 *                       Try again in N hours." (D-07 rate-limit)
 *   403 dm_closed     → toast "You can't message this person right now." (D-06)
 *   403 dm_blocked    → same blocked-user copy (D-10 symmetric block)
 *
 * Body cap: 2000 chars client-side; CHECK constraint backs it up
 * (direct_messages.body_len_chk in 45-01).
 *
 * Web-push opt-in (D-21): first compose triggers requestPushPermission with
 * fromUserGesture:true (Pitfall 3 from 42-RESEARCH) IF the browser permission
 * is still 'default'. Already-granted users skip the prompt; denied users are
 * not re-prompted (Notification.requestPermission no-ops on 'denied').
 *
 * Analog: CommunityPostComposer.tsx (5000-char cap → 2000-char DM cap; same
 * disabled-state + aria-busy convention).
 */
import { useId, useState, type JSX } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { requestPushPermission } from '@/lib/notifications/permission';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { DMAttachmentUploader } from './DMAttachmentUploader';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_DM_BODY_LEN = 2000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type DMComposerMode = 'new' | 'reply';

export interface DMComposerProps {
  mode: DMComposerMode;
  /** Required for mode="reply"; ignored for mode="new". */
  threadId?: string;
  recipientUserId: string;
  currentUserId: string;
  /** Fires after a successful send so parents can refetch. */
  onSent?: (msgId?: string) => void;
}

interface DmCreateThreadOk {
  thread_id: string;
  message_id: string;
}

interface DmCreateThreadErr {
  code?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DMComposer({
  mode,
  threadId,
  recipientUserId,
  currentUserId,
  onSent,
}: DMComposerProps): JSX.Element {
  const toast = useToast();
  const setActiveDmThread = useStore((s) => s.setActiveDmThread);
  const textareaId = useId();

  const [body, setBody] = useState('');
  const [attachmentPath, setAttachmentPath] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Pending message id for attachment path construction (45-01 bucket policy:
  // path = `${threadId}/${pendingMessageId}/${uuid}.${ext}`). For mode="new" we
  // don't yet have a thread id either; we use a placeholder thread id so the
  // upload completes BEFORE we call the create-thread Fn (the Fn then takes
  // the path as input and the bucket-policy authoritative check happens
  // server-side when the message row inserts).
  const [pendingMessageId] = useState<string>(() => crypto.randomUUID());

  const overLimit = body.length > MAX_DM_BODY_LEN;
  const canSend = !submitting && body.trim().length > 0 && !overLimit && recipientUserId.length > 0;

  // For uploader path construction: in reply mode, real thread id; in new
  // mode, a placeholder until the Fn returns the real thread id (the bucket
  // policy gates on dm_threads JOIN on send; this transient client-only path
  // is upgraded by the server on insert if needed).
  const uploaderThreadId = threadId ?? `pending-${currentUserId}`;

  // Push opt-in: best-effort, fire on first compose only.
  const maybeRequestPush = async (): Promise<void> => {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission !== 'default') return;
      await requestPushPermission({ fromUserGesture: true });
    } catch {
      // Pitfall 3 guard or any error — non-fatal; the DM still sends.
    }
  };

  const handleSubmit = async (): Promise<void> => {
    if (!canSend) return;
    setSubmitting(true);

    // Fire push opt-in (best-effort; never blocks send).
    void maybeRequestPush();

    if (mode === 'new') {
      // New-thread path: invoke dm-create-thread Edge Fn with user JWT.
      try {
        const { data, error } = await supabase.functions.invoke('dm-create-thread', {
          body: {
            recipient_user_id: recipientUserId,
            body: body.trim(),
            attachment_path: attachmentPath ?? undefined,
            creator_user_id: currentUserId, // T-45-02 spoofing defense
          },
        });

        if (error) {
          await handleFnError(error, toast);
          setSubmitting(false);
          return;
        }
        const ok = data as DmCreateThreadOk | null;
        if (!ok || !ok.thread_id) {
          toast('Failed to start conversation. Please try again.', 'error');
          setSubmitting(false);
          return;
        }
        // Flip the dispatcher into the new thread.
        setActiveDmThread(ok.thread_id);
        setBody('');
        setAttachmentPath(null);
        setSubmitting(false);
        onSent?.(ok.message_id);
      } catch {
        toast('Network error. Please try again.', 'error');
        setSubmitting(false);
      }
      return;
    }

    // Reply path: direct insert (no rate-limit per D-07; RLS gates that the
    // sender is a thread participant + thread is not deleted).
    if (!threadId) {
      toast('Missing thread id.', 'error');
      setSubmitting(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('direct_messages')
        .insert({
          thread_id: threadId,
          sender_user_id: currentUserId,
          body: body.trim(),
          attachment_path: attachmentPath,
        })
        .select('id')
        .single();
      if (error) {
        toast('Failed to send. Please try again.', 'error');
        setSubmitting(false);
        return;
      }
      const inserted = data as { id: string } | null;
      setBody('');
      setAttachmentPath(null);
      setSubmitting(false);
      onSent?.(inserted?.id);
    } catch {
      toast('Network error. Please try again.', 'error');
      setSubmitting(false);
    }
  };

  const charCountClass = overLimit
    ? 'text-[var(--color-danger)] font-semibold'
    : body.length > MAX_DM_BODY_LEN * 0.9
      ? 'text-[var(--color-warning)]'
      : 'text-[var(--color-fg-muted)]';

  return (
    <div className="p-3 space-y-2">
      <label htmlFor={textareaId} className="sr-only">
        Message
      </label>
      <textarea
        id={textareaId}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder={mode === 'new' ? 'Start a conversation…' : 'Reply…'}
        className="w-full p-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        disabled={submitting}
        aria-invalid={overLimit || undefined}
      />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <DMAttachmentUploader
          threadId={uploaderThreadId}
          pendingMessageId={pendingMessageId}
          onUploaded={(path) => setAttachmentPath(path)}
          onCleared={() => setAttachmentPath(null)}
          disabled={submitting}
        />
        <div className="flex items-center gap-3">
          <span className={`text-xs ${charCountClass}`} aria-live="polite">
            {body.length} / {MAX_DM_BODY_LEN}
          </span>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={!canSend}
            aria-busy={submitting}
          >
            {submitting ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── dm-create-thread error mapper ───────────────────────────────────────────
//
// supabase.functions.invoke does NOT surface HTTP status directly; non-2xx
// responses come back as a FunctionsHttpError carrying the Response in
// `error.context`. We probe the response body for the code returned by the Fn
// (`rate_limited` / `dm_closed` / `dm_blocked`) AND read the Retry-After
// header when present (D-07 surfacing).
async function handleFnError(
  error: unknown,
  toast: (message: string, kind?: 'success' | 'error' | 'info') => void,
): Promise<void> {
  // Try to extract status + body from the FunctionsHttpError shape.
  let status: number | undefined;
  let code: string | undefined;
  let retryAfterHours: number | null = null;
  try {
    const e = error as { context?: Response; message?: string };
    if (e.context && typeof e.context === 'object' && 'status' in e.context) {
      status = e.context.status;
      try {
        // Clone before reading so a future caller can still parse.
        const cloned = e.context.clone();
        const parsed = (await cloned.json()) as DmCreateThreadErr | null;
        code = parsed?.code;
      } catch {
        /* body not json — ignore */
      }
      const retryAfter = e.context.headers.get('Retry-After');
      if (retryAfter) {
        const secs = parseInt(retryAfter, 10);
        if (Number.isFinite(secs) && secs > 0) {
          retryAfterHours = Math.max(1, Math.ceil(secs / 3600));
        }
      }
    }
  } catch {
    /* fall through to generic toast */
  }

  if (status === 429 || code === 'rate_limited') {
    const hours = retryAfterHours ?? 24;
    toast(
      `You can only start 3 new conversations per day. Try again in ${hours} hour${hours === 1 ? '' : 's'}.`,
      'error',
    );
    return;
  }
  if (status === 403 && (code === 'dm_closed' || code === 'dm_blocked')) {
    toast("You can't message this person right now.", 'error');
    return;
  }
  toast('Failed to start conversation. Please try again.', 'error');
}

export default DMComposer;
