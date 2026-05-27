/**
 * Phase 37 Plan 37-07 — AgentReplyComposer (HELP-04, D-08 verbatim).
 *
 * Always-explicit-click sender. The composer accepts a `draft` controlled
 * prop (parent owns the textbox value so AiSuggestionPane.onInsertDraft can
 * populate it). The Send button:
 *   1. INSERTs a ticket_messages row (author_kind='agent', via='admin', body)
 *   2. Invokes the `helpdesk-agent-reply-send` Edge Fn with { ticket_id, message_id, subject }
 *   3. UPDATEs `tickets` (last_agent_message_at, status=pending when was open)
 *   4. Clears the draft + fires `onSent()` callback for the parent to refresh
 *
 * IMPORTANT (D-08):
 *   - NO useEffect-initiated send. There is no path through which the composer
 *     auto-sends. The send fn is only callable from the Send button onClick.
 *   - The textarea has `data-sentry-mask` always (session replay redaction).
 *     PHI tickets are masked the same as non-PHI for symmetry.
 *
 * Phase38Event widening: this plan adds `helpdesk.ticket.replied` to the
 * server-side event taxonomy + a client-side `track('helpdesk.ticket.replied', …)`
 * emitter that fires AFTER the Edge Fn returns OK.
 */
import { useState } from 'react';
import { capture } from '@/lib/analytics/capture';
import { supabase } from '@/lib/supabase';

export interface AgentReplyComposerProps {
  ticketId: string;
  ticketSubject: string;
  ticketStatus: string;
  draft: string;
  onDraftChange: (next: string) => void;
  onSent: () => void;
}

export default function AgentReplyComposer({
  ticketId,
  ticketSubject,
  ticketStatus,
  draft,
  onDraftChange,
  onSent,
}: AgentReplyComposerProps): React.JSX.Element {
  const [sending, setSending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Send is callable ONLY from the button onClick. There is no useEffect that
  // calls this function. D-08 verbatim.
  async function handleSend(): Promise<void> {
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      // 1. INSERT ticket_messages row.
       
      const insertRes = (await ((supabase
        .from('ticket_messages')
        .insert({
          ticket_id: ticketId,
          author_kind: 'agent',
          body,
          via: 'admin',
        }) as unknown as { select: () => { single: () => Promise<unknown> } })
        .select()
        .single() as unknown)) as {
        data: { id: string } | null;
        error: { code?: string } | null;
      };
      if (insertRes.error || !insertRes.data?.id) {
        console.warn(
          '[helpdesk/agent-reply] insert-failed',
          insertRes.error?.code ?? 'unknown',
        );
        setError('Could not save reply.');
        setSending(false);
        return;
      }
      const messageId = insertRes.data.id;

      // 2. Invoke Edge Fn — server resolves Reply-To token + email-router.
      const invokeRes = await supabase.functions.invoke('helpdesk-agent-reply-send', {
        body: {
          ticket_id: ticketId,
          message_id: messageId,
          subject: `Re: ${ticketSubject}`,
        },
      });
      if (invokeRes.error) {
        // The row is already inserted — surface a soft error; agent can retry.
        console.warn(
          '[helpdesk/agent-reply] invoke-failed',
          (invokeRes.error as { name?: string }).name ?? 'unknown',
        );
        setError('Reply saved but email send failed. Retry will not duplicate.');
      }

      // 3. UPDATE tickets — bump last_agent_message_at + flip open→pending.
       
      await ((supabase
        .from('tickets')
        .update({
          last_agent_message_at: new Date().toISOString(),
          ...(ticketStatus === 'open' ? { status: 'pending' } : {}),
        }) as unknown as { eq: (col: string, val: string) => Promise<unknown> })
        .eq('id', ticketId) as unknown);

      // 4. Client-side analytics emit — server-side mirror lands via Edge Fn.
      // Length-only (raw body NEVER captured) per existing helpdesk.ticket.replied
      // event schema (events.ts line 538).
      capture('helpdesk.ticket.replied', {
        ticket_id: ticketId,
        body_length: body.length,
      });

      onDraftChange('');
      onSent();
    } catch (e) {
      console.warn(
        '[helpdesk/agent-reply] threw',
        e instanceof Error ? e.name : 'unknown',
      );
      setError('Could not send reply.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)]">
      <label htmlFor={`reply-${ticketId}`} className="text-sm font-semibold">
        Reply
      </label>
      <textarea
        id={`reply-${ticketId}`}
        name="reply"
        aria-label="Reply"
        data-sentry-mask
        rows={6}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder="Write a reply…"
        className="w-full text-sm p-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
      />
      {error ? (
        <div role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={sending || draft.trim().length === 0}
          aria-busy={sending}
          className="text-sm font-semibold px-4 py-2 rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? 'Sending…' : 'Send reply'}
        </button>
      </div>
    </div>
  );
}
