/**
 * Phase 47 Plan 10 (EVENT-01) — single event card for the chronological list.
 *
 * Forks the CommunityPost Card composition idiom: clickable Card → drill-in
 * to the detail sheet via `setActiveEvent(event.id)`. Renders cover (16:9 or
 * EmptyState fallback), title, start_at (formatted in the user's locale +
 * TZ), capacity badge ("X going / Y waitlist / capacity Z"), and the
 * three-pill RsvpPills row.
 *
 * Per D-14 (list-only, no month-grid lib), the card is the sole consumer
 * surface for an event in the list; the detail sheet provides full markdown
 * description + JoinMeetingButton.
 *
 * a11y per CLAUDE.md:
 *   - Card itself is a <button> with descriptive aria-label
 *   - cover image is `aria-hidden` (title is the accessible label)
 *   - RsvpPills row is wrapped in `onClick` stopPropagation so a pill click
 *     does NOT also trigger the drill-in (button-inside-button avoidance)
 */
import { Calendar, Users as UsersIcon } from 'lucide-react';
import { useCallback, type JSX } from 'react';
import type { Event, RsvpStatus } from '@/lib/events/event-types';
import { useStore } from '@/lib/store';
import { RsvpPills } from './RsvpPills';

export interface EventCardProps {
  event: Event;
  /** The current user's RSVP for this event (server-confirmed); null if none. */
  currentUserRsvp?: { status: RsvpStatus; waitlist_position: number | null } | null;
  /** Aggregate counts for the capacity badge (server-derived). */
  counts?: { going: number; waitlist: number };
  /** Called when the RsvpPills RPC resolves (parent re-fetches or merges). */
  onRsvpChange?: (
    eventId: string,
    next: { status: RsvpStatus; waitlist_position: number | null },
  ) => void;
}

export function EventCard({
  event,
  currentUserRsvp = null,
  counts,
  onRsvpChange,
}: EventCardProps): JSX.Element {
  const setActiveEvent = useStore((s) => s.setActiveEvent);
  const handleOpen = useCallback(() => {
    setActiveEvent(event.id);
  }, [event.id, setActiveEvent]);

  // Format start_at in the user's local TZ. Intl.DateTimeFormat is locale-
  // sensitive; we pass `undefined` deliberately here (per-card display in the
  // viewer's surface) rather than a forced 'en' (which formatLong does for
  // share-card / PDF render contexts).
  const startLabel = formatEventStart(event.start_at);
  const going = counts?.going ?? 0;
  const waitlist = counts?.waitlist ?? 0;

  return (
    <article
      className={[
        'group relative w-full rounded-2xl overflow-hidden text-left',
        'bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-xs)]',
        'hover:shadow-[var(--shadow)] hover:-translate-y-[2px] hover:border-[var(--color-primary-soft)]',
        'transition-[transform,box-shadow,border-color]',
        'focus-within:ring-2 focus-within:ring-[var(--color-primary)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--color-bg)]',
      ].join(' ')}
    >
      {/* Cover region (clickable — drills into detail sheet) */}
      <button
        type="button"
        onClick={handleOpen}
        aria-label={`Open event: ${event.title}, ${startLabel}`}
        className="block w-full text-left focus:outline-none"
      >
        <div className="aspect-[16/9] w-full bg-[var(--color-surface-elevated)] overflow-hidden">
          {event.cover_url ? (
            <img
              src={event.cover_url}
              alt=""
              aria-hidden
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              aria-hidden
              className="w-full h-full flex items-center justify-center text-[var(--color-text-secondary)]"
            >
              <Calendar className="size-12" strokeWidth={1.4} />
            </div>
          )}
        </div>
        <div className="p-4 flex flex-col gap-1.5">
          <h3 className="text-lg font-semibold tracking-tight text-[var(--color-text)] line-clamp-2">
            {event.title}
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3.5" aria-hidden strokeWidth={1.8} />
              {startLabel}
            </span>
            <span className="inline-flex items-center gap-1">
              <UsersIcon className="size-3.5" aria-hidden strokeWidth={1.8} />
              {going} going
              {waitlist > 0 && ` / ${waitlist} waitlist`}
              {' / '}
              capacity {event.capacity}
            </span>
          </div>
        </div>
      </button>

      {/* RSVP row — stop propagation so a pill click does NOT trigger the
          drill-in (button-inside-button avoidance per a11y rules). */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stopPropagation wrapper to avoid pill click triggering drill-in; RsvpPills are keyboard-accessible buttons */}
      <div
        className="px-4 pb-4 pt-1"
        onClick={(e) => e.stopPropagation()}
      >
        <RsvpPills
          eventId={event.id}
          currentStatus={currentUserRsvp?.status ?? null}
          waitlistPosition={currentUserRsvp?.waitlist_position ?? null}
          onChange={(next) => onRsvpChange?.(event.id, next)}
        />
      </div>
    </article>
  );
}

function formatEventStart(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

export default EventCard;
