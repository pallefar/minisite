/**
 * Phase 47 Plan 47-11 — EventAttendeesPane (admin attendee roster).
 *
 * Reads event_rsvps for one event_id, joined to profiles for handle/display_name.
 * Admin sees the full roster via RLS bypass (is_staff). Provides a "Remove"
 * action that DELETEs the rsvp row — the event_rsvps_promotion trigger cascades
 * to promote the next waitlisted user when capacity frees up (Phase 47 Plan 47-02).
 *
 * Status pills: going / maybe / not_going / waitlist (waitlist shows position).
 *
 * Admin surface — pathname-based, no client-router package imports.
 */
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/hooks/useToast';
import type { RsvpStatus } from '@/lib/events/event-types';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RsvpRow {
  id: string;
  user_id: string;
  status: RsvpStatus;
  waitlist_position: number | null;
  created_at: string;
  handle: string | null;
  display_name: string | null;
}

const STATUS_LABEL: Record<RsvpStatus, string> = {
  going: 'Going',
  maybe: 'Maybe',
  not_going: 'Not going',
  waitlist: 'Waitlist',
};

const STATUS_CLASS: Record<RsvpStatus, string> = {
  going: 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]',
  maybe: 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)]',
  not_going: 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] opacity-70',
  waitlist:
    'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border)]',
};

// ─── Component ────────────────────────────────────────────────────────────────

export interface EventAttendeesPaneProps {
  eventId: string;
}

export function EventAttendeesPane({ eventId }: EventAttendeesPaneProps) {
  const toast = useToast();
  const [rows, setRows] = useState<RsvpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('event_rsvps')
      .select(
        'id, user_id, status, waitlist_position, created_at, profile:profiles(handle, display_name)',
      )
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });

    if (error) {
      toast(`Failed to load attendees: ${error.message}`, 'error');
      setRows([]);
      setLoading(false);
      return;
    }

    const mapped: RsvpRow[] = (data ?? []).map((r) => {
      const row = r as unknown as {
        id: string;
        user_id: string;
        status: RsvpStatus;
        waitlist_position: number | null;
        created_at: string;
        profile:
          | { handle: string | null; display_name: string | null }
          | { handle: string | null; display_name: string | null }[]
          | null;
      };
      const profile = Array.isArray(row.profile) ? (row.profile[0] ?? null) : row.profile;
      return {
        id: row.id,
        user_id: row.user_id,
        status: row.status,
        waitlist_position: row.waitlist_position,
        created_at: row.created_at,
        handle: profile?.handle ?? null,
        display_name: profile?.display_name ?? null,
      };
    });
    setRows(mapped);
    setLoading(false);
  }, [eventId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRemove = async (rsvpId: string): Promise<void> => {
    if (removingId) return;
    if (
      !window.confirm(
        'Remove this RSVP? Waitlist promotion will run automatically if capacity frees up.',
      )
    ) {
      return;
    }
    setRemovingId(rsvpId);
    const { error } = await supabase.from('event_rsvps').delete().eq('id', rsvpId);
    if (error) {
      toast(`Failed to remove RSVP: ${error.message}`, 'error');
    } else {
      toast('RSVP removed; waitlist promotion (if applicable) ran.', 'success');
      await load();
    }
    setRemovingId(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Attendees</h2>
        <p className="text-xs text-[var(--color-text-secondary)]">
          {loading ? 'Loading…' : `${rows.length} total`}
        </p>
      </div>

      {loading && <p className="text-sm text-[var(--color-text-secondary)]">Loading attendees…</p>}

      {!loading && rows.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">No RSVPs yet.</p>
      )}

      {!loading && rows.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                User
              </th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Status
              </th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Waitlist #
              </th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                RSVP&apos;d
              </th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-elevated)]"
              >
                <td className="py-2 font-medium">
                  {r.display_name ?? r.handle ?? r.user_id.slice(0, 8) + '…'}
                  {r.handle && (
                    <span className="ml-2 text-xs text-[var(--color-text-secondary)] font-mono">
                      @{r.handle}
                    </span>
                  )}
                </td>
                <td className="py-2">
                  <span
                    className={
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ' +
                      STATUS_CLASS[r.status]
                    }
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                </td>
                <td className="py-2 text-[var(--color-text-secondary)]">
                  {r.status === 'waitlist' && r.waitlist_position != null
                    ? `#${r.waitlist_position}`
                    : '—'}
                </td>
                <td className="py-2 text-[var(--color-text-secondary)] font-mono text-xs">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void handleRemove(r.id)}
                    disabled={removingId === r.id}
                    aria-busy={removingId === r.id}
                    aria-label={`Remove RSVP for ${r.display_name ?? r.handle ?? r.user_id}`}
                    className="text-xs font-medium text-[var(--color-danger)] hover:underline disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-danger)] rounded"
                  >
                    {removingId === r.id ? '…' : 'Remove'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default EventAttendeesPane;
