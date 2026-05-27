/**
 * Phase 47 Plan 47-11 — EventListPage (admin events list).
 *
 * Lists existing events with title, space, start_at, capacity, going_count, status.
 * CTA "+ New event" pushes /admin/events/new. Each row links to edit + attendees +
 * recording sub-routes.
 *
 * SELECT respects the events column allowlist shipped in 20270801000002_p47_events_rls.sql
 * (join_url + zoom_meeting_id are NOT selected here — admin sees those via the edit form
 * only after clicking through, and even then they're loaded server-side via a separate
 * authorized read or staff-only allowed in future iterations).
 *
 * going_count is computed client-side from a sibling event_rsvps aggregate query
 * (lightweight; <= a few hundred events expected per admin org). Status is derived
 * from start_at/end_at relative to now() ("upcoming" / "live" / "past").
 *
 * Pathname-routed sibling of CommunityAdminLayout's SpacesListPage idiom.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  capacity: number;
  space_id: string;
  space_name: string | null;
  going_count: number;
}

type Status = 'upcoming' | 'live' | 'past';

function deriveStatus(startISO: string, endISO: string): Status {
  const now = Date.now();
  const start = Date.parse(startISO);
  const end = Date.parse(endISO);
  if (now < start) return 'upcoming';
  if (now > end) return 'past';
  return 'live';
}

const STATUS_LABEL: Record<Status, string> = {
  upcoming: 'Upcoming',
  live: 'Live',
  past: 'Past',
};

const STATUS_CLASS: Record<Status, string> = {
  upcoming: 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)]',
  live: 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]',
  past: 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] opacity-70',
};

// ─── Component ────────────────────────────────────────────────────────────────

export interface EventListPageProps {
  onNavigate: (path: string) => void;
}

export function EventListPage({ onNavigate }: EventListPageProps) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);

      // Fetch events + space join (column allowlist excludes join_url/zoom_meeting_id).
      const { data: rows, error: evErr } = await supabase
        .from('events')
        .select(
          'id, title, start_at, end_at, capacity, space_id, space:community_spaces(name)',
        )
        .order('start_at', { ascending: false })
        .limit(200);

      if (evErr) {
        setError(`Failed to load events: ${evErr.message}`);
        setEvents([]);
        setLoading(false);
        return;
      }

      const eventIds = (rows ?? []).map((r) => (r as { id: string }).id);

      // Per-event going count (one round trip) — small admin org scale.
      const goingMap = new Map<string, number>();
      if (eventIds.length > 0) {
        const { data: rsvps } = await supabase
          .from('event_rsvps')
          .select('event_id, status')
          .in('event_id', eventIds)
          .eq('status', 'going');
        for (const r of rsvps ?? []) {
          const id = (r as { event_id: string }).event_id;
          goingMap.set(id, (goingMap.get(id) ?? 0) + 1);
        }
      }

      const mapped: EventRow[] = (rows ?? []).map((r) => {
        const row = r as {
          id: string;
          title: string;
          start_at: string;
          end_at: string;
          capacity: number;
          space_id: string;
          space: { name: string } | { name: string }[] | null;
        };
        const space = Array.isArray(row.space) ? row.space[0] ?? null : row.space;
        return {
          id: row.id,
          title: row.title,
          start_at: row.start_at,
          end_at: row.end_at,
          capacity: row.capacity,
          space_id: row.space_id,
          space_name: space?.name ?? null,
          going_count: goingMap.get(row.id) ?? 0,
        };
      });

      setEvents(mapped);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Events</h2>
        <button
          type="button"
          onClick={() => onNavigate('/admin/events/new')}
          className="inline-flex h-8 items-center rounded-full bg-[var(--color-primary)] px-4 text-xs font-semibold text-[var(--color-primary-foreground)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          + New event
        </button>
      </div>

      {loading && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading events…</p>
      )}

      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      {!loading && !error && events.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No events yet. Create one to get started.
        </p>
      )}

      {!loading && !error && events.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                  Title
                </th>
                <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                  Space
                </th>
                <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                  Starts
                </th>
                <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                  Capacity
                </th>
                <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                  Going
                </th>
                <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                  Status
                </th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const status = deriveStatus(e.start_at, e.end_at);
                return (
                  <tr
                    key={e.id}
                    className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-elevated)]"
                  >
                    <td className="py-2 font-medium">{e.title}</td>
                    <td className="py-2 text-[var(--color-text-secondary)]">
                      {e.space_name ?? '—'}
                    </td>
                    <td className="py-2 text-[var(--color-text-secondary)] font-mono text-xs">
                      {new Date(e.start_at).toLocaleString()}
                    </td>
                    <td className="py-2 text-[var(--color-text-secondary)]">
                      {e.capacity === 0 ? '∞' : e.capacity}
                    </td>
                    <td className="py-2 text-[var(--color-text-secondary)]">
                      {e.going_count}
                    </td>
                    <td className="py-2">
                      <span
                        className={
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ' +
                          STATUS_CLASS[status]
                        }
                      >
                        {STATUS_LABEL[status]}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => onNavigate(`/admin/events/${e.id}/edit`)}
                          className="text-xs font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] rounded"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onNavigate(`/admin/events/${e.id}/attendees`)
                          }
                          className="text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] rounded"
                        >
                          Attendees
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onNavigate(`/admin/events/${e.id}/recording`)
                          }
                          className="text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] rounded"
                        >
                          Recording
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default EventListPage;
