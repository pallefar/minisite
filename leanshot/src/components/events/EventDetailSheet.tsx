/**
 * Phase 47 Plan 10 (EVENT-01 / 02 / 03) — Event detail sheet (drill-in view).
 *
 * Forks the CommunitySpaceView Sheet preamble. Renders:
 *   - Event title + start_at / end_at + space tag
 *   - Cover image (16:9)
 *   - Full description via ReactMarkdown + Phase 44 dompurify pipeline
 *     (T-47-41 mitigation — DO NOT introduce a new renderer per RESEARCH
 *     "Don't Hand-Roll" guidance)
 *   - Capacity bar (going / waitlist / capacity)
 *   - RsvpPills (writes via SECDEF RPC; optimistic + revert)
 *   - JoinMeetingButton (calls event-join-url Edge Fn; branches on response)
 *
 * The sheet is opened by EventsTab when `activeEventId !== null`; the parent
 * is responsible for fetching the Event row + the current user's RSVP and
 * passing them in. (This component is presentation-only.)
 *
 * a11y per CLAUDE.md:
 *   - Sheet primitive already provides role="dialog" + aria-modal
 *   - JoinMeetingButton receives a ref to the RSVP anchor so the
 *     "rsvp_required" path can scroll-into-view + focus the first pill
 */
import { useRef, type JSX } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

import { Sheet } from '@/components/ui/Sheet';
import { useStore } from '@/lib/store';
import { sanitizeCommunityMarkdown } from '@/lib/community/dompurify-config';
import type { Event, RsvpStatus } from '@/lib/events/event-types';

import { JoinMeetingButton } from './JoinMeetingButton';
import { RsvpPills } from './RsvpPills';

export interface EventDetailSheetProps {
  /** When non-null, the sheet is open. Driven by Zustand `activeEventId`. */
  event: Event | null;
  /** Current user's RSVP for this event (server-confirmed); null if none. */
  currentUserRsvp?: { status: RsvpStatus; waitlist_position: number | null } | null;
  /** Aggregate counts for the capacity bar. */
  counts?: { going: number; waitlist: number };
  onRsvpChange?: (next: { status: RsvpStatus; waitlist_position: number | null }) => void;
}

export function EventDetailSheet({
  event,
  currentUserRsvp = null,
  counts,
  onRsvpChange,
}: EventDetailSheetProps): JSX.Element {
  const setActiveEvent = useStore((s) => s.setActiveEvent);
  const rsvpAnchorRef = useRef<HTMLDivElement | null>(null);

  const open = event !== null;
  const handleClose = () => setActiveEvent(null);

  // Sanitized HTML for the description (T-47-41).
  const sanitizedDescription = event?.description
    ? sanitizeCommunityMarkdown(event.description)
    : '';

  const going = counts?.going ?? 0;
  const waitlist = counts?.waitlist ?? 0;
  const capacity = event?.capacity ?? 0;
  const fillRatio = capacity > 0 ? Math.min(1, going / capacity) : 0;

  return (
    <Sheet open={open} onClose={handleClose} title={event?.title ?? 'Event'} height={0.85}>
      {event && (
        <div className="flex flex-col gap-4 px-4 pb-6">
          {/* Cover */}
          {event.cover_url && (
            <div className="aspect-[16/9] w-full rounded-2xl overflow-hidden bg-[var(--color-surface-elevated)]">
              <img
                src={event.cover_url}
                alt=""
                aria-hidden
                loading="lazy"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* When / capacity */}
          <div className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
            <div>
              <span className="font-medium text-[var(--color-text)]">When: </span>
              {formatRange(event.start_at, event.end_at)}
            </div>
            <div>
              <span className="font-medium text-[var(--color-text)]">Capacity: </span>
              {going} going{waitlist > 0 ? ` · ${waitlist} waitlist` : ''} · {capacity} total
            </div>
            <div
              className="mt-1 h-1.5 w-full rounded-full bg-[var(--color-surface-elevated)] overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(fillRatio * 100)}
              aria-label="Capacity fill"
            >
              <div
                className="h-full bg-[var(--color-primary)]"
                style={{ width: `${Math.round(fillRatio * 100)}%` }}
              />
            </div>
          </div>

          {/* Description (sanitized markdown — T-47-41) */}
          {event.description && (
            <div className="prose prose-sm max-w-none text-[var(--color-text)]">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
              >
                {sanitizedDescription}
              </ReactMarkdown>
            </div>
          )}

          {/* RSVP — anchored so JoinMeetingButton's "rsvp_required" path can
              scroll-into-view + focus the first pill. */}
          <div ref={rsvpAnchorRef} className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
              Your RSVP
            </span>
            <RsvpPills
              eventId={event.id}
              currentStatus={currentUserRsvp?.status ?? null}
              waitlistPosition={currentUserRsvp?.waitlist_position ?? null}
              onChange={onRsvpChange}
            />
          </div>

          {/* Join meeting (gated via event-join-url Edge Fn) */}
          <JoinMeetingButton eventId={event.id} rsvpAnchorRef={rsvpAnchorRef} />
        </div>
      )}
    </Sheet>
  );
}

function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startIso} — ${endIso}`;
  }
  const startStr = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(start);
  const endStr = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(end);
  return `${startStr} – ${endStr}`;
}

export default EventDetailSheet;
