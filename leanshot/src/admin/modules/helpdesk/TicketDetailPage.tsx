/**
 * Phase 37 Plan 37-07 — TicketDetailPage (HELP-04, D-05, D-08).
 *
 * Slide-over surface opened from HelpdeskInboxPage or SentimentQueuePage.
 * Renders the ticket thread + AiSuggestionPane + AgentReplyComposer +
 * close/reopen actions.
 *
 * PHI audit (D-05) — fire-and-forget logPhiAccess on mount when ticket.phi:
 *   - useRef dedupes per ticket_id × agent_id pair (prevents storms on
 *     StrictMode double-mount + parent re-renders)
 *   - Pattern S3: errors logged with error.code only (handled in phi-access-rpc)
 *
 * D-08 verbatim: there is NO useEffect that calls the send path. The only
 * way to send a reply is via the AgentReplyComposer Send button.
 *
 * close_ticket / reopen_ticket: SECDEF RPCs from Plan 37-01. After success,
 * client-side capture() emits helpdesk.ticket.closed / .reopened.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { capture } from '@/lib/analytics/capture';
import { logPhiAccess } from '@/lib/hipaa/phi-access-rpc';
import { supabase } from '@/lib/supabase';
import AgentReplyComposer from './AgentReplyComposer';
import AiSuggestionPane from './AiSuggestionPane';

export interface TicketDetailPageProps {
  ticketId: string;
  onClose: () => void;
}

interface TicketRow {
  id: string;
  org_id: string;
  user_id: string;
  subject: string;
  status: 'open' | 'pending' | 'solved' | 'closed';
  phi: boolean;
}

interface MessageRow {
  id: string;
  ticket_id: string;
  author_kind: string;
  body: string;
  created_at: string;
}

export default function TicketDetailPage({
  ticketId,
  onClose,
}: TicketDetailPageProps): React.JSX.Element {
  const [ticket, setTicket] = useState<TicketRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [closing, setClosing] = useState<boolean>(false);

  // D-05 dedupe sentinel — keyed on ticket_id:agent_id. Survives re-renders.
  const phiLogKeyRef = useRef<string>('');

  const reload = useCallback(async () => {
    setLoading(true);
    // ticket
     
    const tRes = (await (supabase
      .from('tickets')
      .select('id, org_id, user_id, subject, status, phi')
      .eq('id', ticketId)
      .maybeSingle() as unknown)) as {
      data: TicketRow | null;
      error: { code?: string } | null;
    };
    if (tRes.error || !tRes.data) {
      console.warn('[helpdesk/detail] ticket-load-failed', tRes.error?.code ?? 'unknown');
      setError('Could not load ticket.');
      setLoading(false);
      return;
    }
    setTicket(tRes.data);

    // thread
     
    const mRes = (await (supabase
      .from('ticket_messages')
      .select('id, ticket_id, author_kind, body, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true }) as unknown)) as {
      data: MessageRow[] | null;
      error: { code?: string } | null;
    };
    if (mRes.error) {
      console.warn(
        '[helpdesk/detail] messages-load-failed',
        mRes.error?.code ?? 'unknown',
      );
    } else {
      setMessages(mRes.data ?? []);
    }

    setError(null);
    setLoading(false);
  }, [ticketId]);

  // Resolve agent identity (needed for the dedupe key).
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setAgentId(data?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Initial load + reload-on-id-change.
  useEffect(() => {
    void reload();
  }, [reload]);

  // PHI audit fire-and-forget (D-05) — fires once per (ticket × agent) pair.
  // useRef sentinel prevents StrictMode double-mount duplicates AND prevents
  // re-fires from parent re-renders that don't change ticket.phi.
  useEffect(() => {
    if (!ticket || !ticket.phi || !agentId || !ticketId) return;
    const logKey = `${ticketId}:${agentId}`;
    if (phiLogKeyRef.current === logKey) return;
    phiLogKeyRef.current = logKey;
    void logPhiAccess({
      accessedUserId: ticket.user_id,
      accessedFields: ['ticket.body', 'ticket_messages'],
      reason: 'agent-inbox-open',
      accessedOrgId: ticket.org_id,
    });
  }, [ticket, agentId, ticketId]);

  // Esc-to-close (a11y baseline for slide-over).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleClose(action: 'close' | 'reopen'): Promise<void> {
    if (!ticket || closing) return;
    setClosing(true);
    const rpcName = action === 'close' ? 'close_ticket' : 'reopen_ticket';
    const { error } = await supabase.rpc(rpcName, { p_ticket_id: ticketId });
    if (error) {
      console.warn(`[helpdesk/detail] ${rpcName}-failed`, error.code ?? 'unknown');
      setError(`Could not ${action} ticket.`);
      setClosing(false);
      return;
    }
    // Fire client-side capture AFTER successful RPC.
    if (action === 'close') {
      capture('helpdesk.ticket.closed', { ticket_id: ticketId });
    } else {
      capture('helpdesk.ticket.reopened', { ticket_id: ticketId });
    }
    setClosing(false);
    await reload();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ticket detail"
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={(e) => {
        // Only close on backdrop click (not on inner content clicks).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--color-bg)] w-full max-w-3xl h-full overflow-y-auto shadow-xl border-l border-[var(--color-border)]">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              aria-label="Close ticket detail"
              onClick={onClose}
              className="text-sm px-2 py-1 rounded hover:bg-[var(--color-surface-elevated)]"
            >
              ✕
            </button>
            <h2 className="text-base font-semibold truncate">
              {ticket?.subject ?? 'Ticket'}
            </h2>
            {ticket?.phi ? (
              <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-warning/20 text-warning">
                PHI
              </span>
            ) : null}
          </div>
          {ticket ? (
            <div className="flex items-center gap-2">
              {ticket.status !== 'closed' ? (
                <button
                  type="button"
                  onClick={() => void handleClose('close')}
                  disabled={closing}
                  className="text-xs font-semibold px-3 py-1.5 rounded bg-[var(--color-surface-elevated)] text-[var(--color-text)]"
                >
                  Close ticket
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleClose('reopen')}
                  disabled={closing}
                  className="text-xs font-semibold px-3 py-1.5 rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                >
                  Reopen ticket
                </button>
              )}
            </div>
          ) : null}
        </header>

        {loading ? (
          <div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading…</div>
        ) : error ? (
          <div className="p-6 text-sm text-[var(--color-danger)]">{error}</div>
        ) : ticket ? (
          <div className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
            {/* Thread (left) */}
            <section
              data-sentry-mask
              className="flex flex-col gap-3 min-w-0"
              aria-label="Ticket thread"
            >
              {messages.length === 0 ? (
                <div className="p-3 text-sm text-[var(--color-text-secondary)] rounded border border-[var(--color-border)] bg-[var(--color-surface)]">
                  No messages yet.
                </div>
              ) : (
                messages.map((m) => (
                  <article
                    key={m.id}
                    className="p-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
                  >
                    <header className="text-xs text-[var(--color-text-secondary)] mb-1 flex justify-between">
                      <span className="font-semibold">{m.author_kind}</span>
                      <time dateTime={m.created_at}>
                        {new Date(m.created_at).toLocaleString()}
                      </time>
                    </header>
                    <pre className="whitespace-pre-wrap text-sm font-sans">{m.body}</pre>
                  </article>
                ))
              )}
            </section>

            {/* Side pane (right) — AI suggestion + composer */}
            <aside className="flex flex-col gap-3 min-w-0">
              <AiSuggestionPane
                ticketId={ticketId}
                onInsertDraft={(text) => setDraft(text)}
              />
              <AgentReplyComposer
                ticketId={ticketId}
                ticketSubject={ticket.subject}
                ticketStatus={ticket.status}
                draft={draft}
                onDraftChange={setDraft}
                onSent={() => {
                  void reload();
                }}
              />
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}
