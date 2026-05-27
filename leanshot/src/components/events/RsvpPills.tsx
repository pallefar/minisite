/**
 * Phase 47 Plan 10 (EVENT-02) — three-pill RSVP toggle.
 *
 * Forks the `ReactionBar.tsx` pill-toggle idiom (optimistic local override,
 * RPC call, revert-on-error). Three pills: Going / Maybe / Not Going. The
 * server may promote a 'going' request to 'waitlist' atomically when capacity
 * is exceeded; the returned `status` from `createRsvp` is rendered (so a
 * 'going' click resulting in `{ status: 'waitlist', waitlist_position: N }`
 * surfaces a "Waitlist (#N)" badge inline).
 *
 * a11y per CLAUDE.md:
 *   - role="group" + aria-label="RSVP"
 *   - aria-pressed on each pill
 *   - aria-busy while the RPC call is in flight
 *
 * T-47-40 mitigation: the public `onChange` signature accepts only the three
 * user-selectable values; the `Exclude<RsvpStatus, 'waitlist'>` type prevents
 * a typed caller from requesting waitlist directly.
 */
import { useState, type JSX } from 'react';
import { useToast } from '@/hooks/useToast';
import type { RsvpStatus } from '@/lib/events/event-types';
import { createRsvp } from '@/lib/events/rsvp-client';

type SelectableStatus = Exclude<RsvpStatus, 'waitlist'>;

const PILLS: { value: SelectableStatus; label: string }[] = [
  { value: 'going', label: 'Going' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'not_going', label: 'Not going' },
];

export interface RsvpPillsProps {
  eventId: string;
  /** Current RSVP status (server-confirmed); `null` when the user has not RSVP'd yet. */
  currentStatus: RsvpStatus | null;
  /** Server-assigned position; non-null only when `currentStatus === 'waitlist'`. */
  waitlistPosition?: number | null;
  /** Called with the server-confirmed status after a successful RPC. */
  onChange?: (next: { status: RsvpStatus; waitlist_position: number | null }) => void;
}

export function RsvpPills({
  eventId,
  currentStatus,
  waitlistPosition = null,
  onChange,
}: RsvpPillsProps): JSX.Element {
  const toast = useToast();
  // Optimistic display layer: overrides currentStatus when non-null.
  const [optimistic, setOptimistic] = useState<RsvpStatus | null>(null);
  const [pending, setPending] = useState(false);
  const display = optimistic ?? currentStatus;

  async function handleClick(value: SelectableStatus) {
    if (pending) return;
    setPending(true);
    setOptimistic(value);
    try {
      const next = await createRsvp(eventId, value);
      setOptimistic(next.status);
      onChange?.({ status: next.status, waitlist_position: next.waitlist_position });
      // Clear the optimistic layer once the parent has been notified — the
      // parent re-renders with `currentStatus={next.status}` and our display
      // falls through to that.
      setOptimistic(null);
    } catch (err: unknown) {
      // Revert optimistic
      setOptimistic(null);
      const msg = err instanceof Error ? err.message : 'unknown_error';
      if (msg === 'auth_required') {
        toast('Sign in to RSVP.', 'error');
      } else if (msg === 'event_not_found') {
        toast('This event is no longer available.', 'error');
      } else {
        toast('Could not save RSVP. Please try again.', 'error');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="group"
      aria-label="RSVP"
      aria-busy={pending}
      className="flex flex-wrap items-center gap-1.5"
    >
      {PILLS.map(({ value, label }) => {
        const active = display === value || (value === 'going' && display === 'waitlist');
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            aria-label={`RSVP ${label}`}
            disabled={pending}
            onClick={() => void handleClick(value)}
            className={[
              'inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]',
              active
                ? 'bg-[var(--color-primary-soft)] border-[var(--color-primary)] text-[var(--color-primary)]'
                : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary-soft)] hover:text-[var(--color-text)]',
              pending ? 'opacity-60 cursor-progress' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {label}
          </button>
        );
      })}
      {display === 'waitlist' && (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--color-warning-soft,var(--color-surface-elevated))] text-[var(--color-text)] border border-[var(--color-border)]"
          aria-label={`Waitlisted at position ${waitlistPosition ?? '—'}`}
        >
          Waitlist{waitlistPosition != null ? ` (#${waitlistPosition})` : ''}
        </span>
      )}
    </div>
  );
}

export default RsvpPills;
