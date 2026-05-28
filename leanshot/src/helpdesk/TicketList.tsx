/**
 * TicketList — Phase 37 Plan 06 Task 3.
 *
 * Renders the caller's tickets ordered by most-recently-updated. RLS on
 * `public.tickets` guarantees the user only sees their own rows; no client-
 * side `eq('user_id', auth.uid())` filter is required (and adding one would
 * be a Rule 1 bug if RLS were misconfigured — the principle is server-enforced).
 */
import { useEffect, useState, type JSX } from 'react';
import { supabase } from '@/lib/supabase';

type TicketRow = {
  id: string;
  subject: string;
  status: string;
  updated_at: string;
};

export interface TicketListProps {
  onSelect: (ticketId: string) => void;
}

export default function TicketList({ onSelect }: TicketListProps): JSX.Element {
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('id, subject, status, updated_at')
        .order('updated_at', { ascending: false })
        .limit(20);
      if (cancelled) return;
      setLoading(false);
      if (!error && Array.isArray(data)) {
        setTickets(data as TicketRow[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="text-xs text-[var(--color-fg-muted)] p-2">Loading your tickets…</div>;
  }

  if (tickets.length === 0) {
    return (
      <p className="text-xs text-[var(--color-fg-muted)] p-2">You have no open tickets yet.</p>
    );
  }

  return (
    <ul className="flex flex-col gap-1" aria-label="Your tickets">
      {tickets.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onSelect(t.id)}
            className="text-start w-full p-2 hover:bg-[var(--color-surface-elevated)] rounded-md"
          >
            <div className="text-sm">{t.subject}</div>
            <div className="text-xs text-[var(--color-fg-muted)]">{t.status}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}
