/**
 * Phase 47 Plan 10 (EVENT-01 / 02 / 03) — Events tab shell (consumer surface).
 *
 * Zustand-driven list-vs-detail switch (per CLAUDE.md no-router rule):
 *
 *   activeEventId === null  → chronological EventList (upcoming events, RLS-filtered)
 *   activeEventId !== null  → EventDetailSheet (drilled into one event)
 *
 * Data fetch (RLS-aware): two parallel reads on mount —
 *   - `events`     (start_at >= now, order by start_at asc, limit 50)
 *   - `event_rsvps` (user_id = auth.uid()) → keyed by event_id for fast lookup
 *
 * Counts:
 *   For v1 (this plan) we render only "X going" / "Y waitlist" derived from the
 *   user's own RSVP join. Aggregate counts across users are a server view
 *   shipped by a sibling plan (or future EVENT-04); the UI surface uses
 *   `event_rsvps_aggregate` if it exists, otherwise falls back to zero —
 *   capacity badge still renders the cap.
 *
 * No video-player import here (D-17: past-event recordings link out to the
 * Classroom surface; executor verifies via a grep guard on the player
 * package name across the events/ tree).
 */
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Event, EventRsvp, RsvpStatus } from '@/lib/events/event-types';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { EventCard } from './EventCard';
import { EventDetailSheet } from './EventDetailSheet';

type UserRsvpMap = Record<
  string,
  { status: RsvpStatus; waitlist_position: number | null }
>;

export default function EventsTab(): JSX.Element {
  const activeEventId = useStore((s) => s.activeEventId);
  const [events, setEvents] = useState<Event[] | null>(null);
  const [userRsvps, setUserRsvps] = useState<UserRsvpMap>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadError(null);
      const nowIso = new Date().toISOString();
      const [eventsResult, rsvpsResult, sessionResult] = await Promise.all([
        supabase
          .from('events')
          .select(
            'id, space_id, title, description, start_at, end_at, capacity, cover_url, zoom_managed, attach_to_module_id, recording_mux_asset_id, recording_playback_id, created_by, created_at, updated_at',
          )
          .gte('start_at', nowIso)
          .order('start_at', { ascending: true })
          .limit(50),
        // RLS scopes event_rsvps to (user_id = auth.uid()); we don't need to
        // filter explicitly. If the user is anonymous, this returns [].
        supabase
          .from('event_rsvps')
          .select('id, event_id, user_id, status, waitlist_position, created_at, updated_at'),
        supabase.auth.getSession(),
      ]);

      if (cancelled) return;

      if (eventsResult.error) {
        setLoadError(eventsResult.error.message);
        setEvents([]);
        return;
      }
      setEvents((eventsResult.data ?? []) as Event[]);

      // Filter rsvps to the authenticated user. RLS already restricts this,
      // but we double-check by uid match for defence-in-depth.
      const uid = sessionResult.data.session?.user.id ?? null;
      const rsvpRows = (rsvpsResult.data ?? []) as EventRsvp[];
      const map: UserRsvpMap = {};
      for (const row of rsvpRows) {
        if (uid && row.user_id !== uid) continue;
        map[row.event_id] = {
          status: row.status,
          waitlist_position: row.waitlist_position,
        };
      }
      setUserRsvps(map);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeEvent = useMemo<Event | null>(() => {
    if (!activeEventId || !events) return null;
    return events.find((e) => e.id === activeEventId) ?? null;
  }, [activeEventId, events]);

  const handleRsvpChange = useCallback(
    (
      eventId: string,
      next: { status: RsvpStatus; waitlist_position: number | null },
    ) => {
      setUserRsvps((prev) => ({ ...prev, [eventId]: next }));
    },
    [],
  );

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)]">
          Events
        </h1>
        {events && events.length > 0 && (
          <span className="text-xs text-[var(--color-text-secondary)]">
            {events.length} upcoming
          </span>
        )}
      </header>

      {/* LIST */}
      {events === null ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[16/9] w-full rounded-2xl" />
          ))}
        </div>
      ) : loadError ? (
        <div className="text-sm text-[var(--color-text-secondary)] py-8 text-center">
          Could not load events. Please try again.
        </div>
      ) : events.length === 0 ? (
        <div className="text-sm text-[var(--color-text-secondary)] py-8 text-center">
          No upcoming events. Check back soon.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              currentUserRsvp={userRsvps[event.id] ?? null}
              onRsvpChange={handleRsvpChange}
            />
          ))}
        </div>
      )}

      {/* DETAIL — Sheet handles its own open/close via Zustand */}
      <EventDetailSheet
        event={activeEvent}
        currentUserRsvp={activeEventId ? (userRsvps[activeEventId] ?? null) : null}
        onRsvpChange={(next) => {
          if (activeEventId) handleRsvpChange(activeEventId, next);
        }}
      />
    </div>
  );
}
