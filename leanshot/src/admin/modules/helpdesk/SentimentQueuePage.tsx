/**
 * Phase 37 Plan 37-07 — SentimentQueuePage (read-only).
 *
 * Lists tickets where sentiment_alert_fired_at IS NOT NULL ordered by
 * most-recent-alert DESC. Row click opens TicketDetailPage slide-over.
 *
 * Plan 37-08 adds a clear_sentiment_alert RPC action button.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import TicketDetailPage from './TicketDetailPage';

interface SentimentRow {
  id: string;
  subject: string;
  status: string;
  sentiment_min_score: number | null;
  sentiment_alert_fired_at: string;
  phi: boolean;
}

export default function SentimentQueuePage(): React.JSX.Element {
  const [rows, setRows] = useState<SentimentRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      const { data, error } = await supabase
        .from('tickets')
        .select('id, subject, status, sentiment_min_score, sentiment_alert_fired_at, phi')
        .not('sentiment_alert_fired_at', 'is', null)
        .order('sentiment_alert_fired_at', { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error) {
        // Pattern S3 — log error.code only.
        console.warn('[helpdesk/sentiment-queue] load-failed', error.code ?? 'unknown');
        setError('Could not load sentiment alerts.');
      } else {
        setRows((data ?? []) as SentimentRow[]);
        setError(null);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="p-6 text-sm text-[var(--color-text-secondary)]">
        Loading sentiment alerts…
      </div>
    );
  }
  if (error) {
    return <div className="p-6 text-sm text-[var(--color-danger)]">{error}</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="p-6 text-sm text-[var(--color-text-secondary)]">
        No tickets currently flagged for sentiment review.
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Sentiment Queue ({rows.length})</h2>
      <ul className="flex flex-col divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-md bg-[var(--color-surface)]">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => setOpenTicketId(r.id)}
              className="w-full text-start px-4 py-3 hover:bg-[var(--color-surface-elevated)]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium truncate">{r.subject}</span>
                {r.phi ? (
                  <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-warning/20 text-warning">
                    PHI
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-[var(--color-text-secondary)] mt-1 flex gap-3">
                <span>
                  Sentiment:{' '}
                  {r.sentiment_min_score !== null ? r.sentiment_min_score.toFixed(2) : '—'}
                </span>
                <span>Alerted: {new Date(r.sentiment_alert_fired_at).toLocaleString()}</span>
                <span>Status: {r.status}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {openTicketId ? (
        <TicketDetailPage ticketId={openTicketId} onClose={() => setOpenTicketId(null)} />
      ) : null}
    </div>
  );
}
