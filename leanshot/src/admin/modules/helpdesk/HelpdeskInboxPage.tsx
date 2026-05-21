/**
 * Phase 37 Plan 37-07 — HelpdeskInboxPage (HELP-04, HELP-12).
 *
 * Agent-facing ticket inbox.
 *
 * Filter dimensions:
 *   - status      — multi-select chips (open / pending / solved / closed)
 *   - priority    — single-select chips (all / p1 / p2 / p3)
 *   - assignedTo  — 'me' | 'all' (placeholder until Plan 37-08 wires routing)
 *   - sentimentOnly — bool — narrows to sentiment_alert_fired_at IS NOT NULL
 *
 * RLS-side: org_members policy on `tickets` filters to the agent's orgs.
 * No client-side org check needed.
 *
 * Row click opens TicketDetailPage as a slide-over (no URL change) — keeps
 * the layout self-contained. Plan 37-08 may add deep-linking later.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import TicketDetailPage from './TicketDetailPage';

type Status = 'open' | 'pending' | 'solved' | 'closed';
type Priority = 'all' | 'p1' | 'p2' | 'p3';
type AssignedFilter = 'me' | 'all';

interface TicketRow {
  id: string;
  subject: string;
  status: Status;
  priority: 'p1' | 'p2' | 'p3';
  assigned_to: string | null;
  sentiment_alert_fired_at: string | null;
  last_user_message_at: string | null;
  created_at: string;
  phi: boolean;
}

const DEFAULT_STATUSES: Status[] = ['open', 'pending'];
const ALL_STATUSES: Status[] = ['open', 'pending', 'solved', 'closed'];
const PRIORITIES: Priority[] = ['all', 'p1', 'p2', 'p3'];

function priorityLabel(p: 'p1' | 'p2' | 'p3'): string {
  return p.toUpperCase();
}

function priorityTone(p: 'p1' | 'p2' | 'p3'): string {
  if (p === 'p1') return 'bg-danger/20 text-danger';
  if (p === 'p2') return 'bg-warning/20 text-warning';
  return 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)]';
}

export default function HelpdeskInboxPage(): React.JSX.Element {
  const [statuses, setStatuses] = useState<Set<Status>>(new Set(DEFAULT_STATUSES));
  const [priority, setPriority] = useState<Priority>('all');
  const [assigned, setAssigned] = useState<AssignedFilter>('all');
  const [sentimentOnly, setSentimentOnly] = useState<boolean>(false);
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);

  // Resolve agent id once for the "assigned to me" filter.
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Build query — order matters for the test mock which records each call.
      let q = supabase
        .from('tickets')
        .select(
          'id, subject, status, priority, assigned_to, sentiment_alert_fired_at, last_user_message_at, created_at, phi',
        );

      // Status filter is .in() — empty set means "match nothing"; clamp to all
      // statuses so empty set behaves like "show all".
      const statusList: Status[] =
        statuses.size === 0 ? ALL_STATUSES : (Array.from(statuses) as Status[]);
      q = (q as unknown as { in: (col: string, vals: Status[]) => typeof q }).in(
        'status',
        statusList,
      );

      if (priority !== 'all') {
        q = (q as unknown as { eq: (col: string, val: string) => typeof q }).eq(
          'priority',
          priority,
        );
      }
      if (assigned === 'me' && agentId) {
        q = (q as unknown as { eq: (col: string, val: string) => typeof q }).eq(
          'assigned_to',
          agentId,
        );
      }
      if (sentimentOnly) {
        q = (
          q as unknown as { not: (col: string, op: string, val: null) => typeof q }
        ).not('sentiment_alert_fired_at', 'is', null);
      }

      q = (
        q as unknown as {
          order: (col: string, opts: { ascending: boolean }) => typeof q;
        }
      ).order('updated_at', { ascending: false });
      q = (q as unknown as { limit: (n: number) => typeof q }).limit(50);

      const { data, error } = (await (q as unknown as Promise<{
        data: TicketRow[] | null;
        error: { code?: string } | null;
      }>)) as { data: TicketRow[] | null; error: { code?: string } | null };

      if (error) {
        console.warn('[helpdesk/inbox] load-failed', error.code ?? 'unknown');
        setError('Could not load tickets.');
      } else {
        setRows(data ?? []);
        setError(null);
      }
    } finally {
      setLoading(false);
    }
  }, [statuses, priority, assigned, sentimentOnly, agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleStatus(s: Status): void {
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  const visibleRows = useMemo(() => rows, [rows]);

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Helpdesk Inbox</h2>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {ALL_STATUSES.map((s) => {
          const active = statuses.has(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              onClick={() => toggleStatus(s)}
              className={
                active
                  ? 'inline-flex items-center h-7 px-3 rounded-pill text-xs font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                  : 'inline-flex items-center h-7 px-3 rounded-pill text-xs font-medium text-[var(--color-text-secondary)] bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)]'
              }
            >
              {s}
            </button>
          );
        })}

        <span className="mx-2 h-5 w-px bg-[var(--color-border)]" aria-hidden />

        {PRIORITIES.map((p) => {
          const active = priority === p;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={active}
              onClick={() => setPriority(p)}
              className={
                active
                  ? 'inline-flex items-center h-7 px-3 rounded-pill text-xs font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                  : 'inline-flex items-center h-7 px-3 rounded-pill text-xs font-medium text-[var(--color-text-secondary)] bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)]'
              }
            >
              {p === 'all' ? 'All priority' : p.toUpperCase()}
            </button>
          );
        })}

        <span className="mx-2 h-5 w-px bg-[var(--color-border)]" aria-hidden />

        <button
          type="button"
          aria-pressed={assigned === 'me'}
          onClick={() => setAssigned((a) => (a === 'me' ? 'all' : 'me'))}
          className={
            assigned === 'me'
              ? 'inline-flex items-center h-7 px-3 rounded-pill text-xs font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
              : 'inline-flex items-center h-7 px-3 rounded-pill text-xs font-medium text-[var(--color-text-secondary)] bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)]'
          }
        >
          Assigned to me
        </button>

        <button
          type="button"
          aria-pressed={sentimentOnly}
          onClick={() => setSentimentOnly((v) => !v)}
          className={
            sentimentOnly
              ? 'inline-flex items-center h-7 px-3 rounded-pill text-xs font-semibold bg-warning/20 text-warning'
              : 'inline-flex items-center h-7 px-3 rounded-pill text-xs font-medium text-[var(--color-text-secondary)] bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)]'
          }
        >
          Sentiment alerts only
        </button>
      </div>

      {loading ? (
        <div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading…</div>
      ) : error ? (
        <div className="p-6 text-sm text-[var(--color-danger)]">{error}</div>
      ) : visibleRows.length === 0 ? (
        <div className="p-6 text-sm text-[var(--color-text-secondary)]">
          No tickets match the current filters.
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-md bg-[var(--color-surface)]">
          {visibleRows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setOpenTicketId(r.id)}
                aria-label={r.subject}
                className="w-full text-left px-4 py-3 hover:bg-[var(--color-surface-elevated)]"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-pill ${priorityTone(r.priority)}`}
                  >
                    {priorityLabel(r.priority)}
                  </span>
                  <span className="font-medium truncate flex-1">{r.subject}</span>
                  {r.phi ? (
                    <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-warning/20 text-warning">
                      PHI
                    </span>
                  ) : null}
                  {r.sentiment_alert_fired_at ? (
                    <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-danger/20 text-danger">
                      Sentiment
                    </span>
                  ) : null}
                  <span className="shrink-0 text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)]">
                    {r.status}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {openTicketId ? (
        <TicketDetailPage
          ticketId={openTicketId}
          onClose={() => setOpenTicketId(null)}
        />
      ) : null}
    </div>
  );
}
