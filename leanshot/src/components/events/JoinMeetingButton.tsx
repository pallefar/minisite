/**
 * Phase 47 Plan 10 (EVENT-03) — gated Join Meeting button.
 *
 * Calls the `event-join-url` Edge Fn (shipped by 47-07) on click. The Fn
 * forwards the user JWT to a SECDEF RPC that checks (a) RSVP status, (b)
 * event time window, and (c) recording / ended status — returning ONE of
 * four shapes per the plan's contract:
 *
 *   200  { url: <signed-short-lived join URL> }
 *   403  { error: 'too_early', opens_at: <ISO timestamptz> }
 *   403  { error: 'rsvp_required' }
 *   410  { error: 'event_ended' }
 *
 * The button itself renders state-appropriate UI:
 *   - default            → "Join meeting" (primary)
 *   - too_early          → "Opens in Xm Ys" countdown (disabled)
 *   - rsvp_required      → "RSVP to see meeting link" (disabled; scrolls to RsvpPills)
 *   - event_ended        → "Event ended" (disabled, ghost variant)
 *
 * T-47-39 (Info Disclosure — URL in browser history): always opens via
 * `window.open(url, '_blank', 'noopener')` so the signed URL never lands
 * in the current page's session history.
 *
 * a11y per CLAUDE.md:
 *   - aria-busy while the Fn invocation is in flight
 *   - aria-disabled on countdown / disabled states (keyboard-discoverable)
 *   - aria-live="polite" region for state changes (countdown / error messages)
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

type FnSuccess = { url: string };
type FnError =
  | { error: 'too_early'; opens_at: string }
  | { error: 'rsvp_required' }
  | { error: 'event_ended' };

type FnResponse = FnSuccess | FnError;

interface UiState {
  kind: 'idle' | 'pending' | 'too_early' | 'rsvp_required' | 'event_ended' | 'ready' | 'error';
  opens_at?: string;
  message?: string;
}

export interface JoinMeetingButtonProps {
  eventId: string;
  /** Optional anchor the "rsvp_required" path scrolls into view + focuses. */
  rsvpAnchorRef?: React.RefObject<HTMLDivElement | null>;
}

export function JoinMeetingButton({
  eventId,
  rsvpAnchorRef,
}: JoinMeetingButtonProps): JSX.Element {
  const toast = useToast();
  const reduced = useReducedMotion();
  const [ui, setUi] = useState<UiState>({ kind: 'idle' });
  const [now, setNow] = useState<number>(() => Date.now());

  // Tick clock once per second while we're rendering a countdown.
  useEffect(() => {
    if (ui.kind !== 'too_early' || !ui.opens_at) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ui.kind, ui.opens_at]);

  // Re-arm if the opens_at boundary has passed (countdown reached 0).
  useEffect(() => {
    if (ui.kind !== 'too_early' || !ui.opens_at) return;
    if (now >= new Date(ui.opens_at).getTime()) {
      setUi({ kind: 'idle' });
    }
  }, [now, ui.kind, ui.opens_at]);

  const handleClick = useCallback(async () => {
    setUi({ kind: 'pending' });
    try {
      const { data, error } = await supabase.functions.invoke('event-join-url', {
        body: { event_id: eventId },
      });
      if (error) {
        // FunctionsHttpError carries the status code but the body lives on the
        // associated response — supabase-js exposes it via `error.context`.
        // We optimistically attempt to parse `data` first (some non-200s still
        // bubble a JSON body through), then fall back to a generic error.
        const body = (data as FnResponse | null) ?? null;
        if (body && 'error' in body) {
          applyError(body);
          return;
        }
        toast('Could not load meeting link. Please try again.', 'error');
        setUi({ kind: 'error', message: 'unknown' });
        return;
      }
      const body = data as FnResponse;
      if ('url' in body && body.url) {
        // T-47-39: open in NEW tab with noopener so signed URL stays out of
        // the current-page browsing history.
        window.open(body.url, '_blank', 'noopener');
        setUi({ kind: 'ready' });
        // Reset to idle so a follow-up click works (URL is short-TTL; the Fn
        // can be re-invoked to mint a fresh one).
        window.setTimeout(() => setUi({ kind: 'idle' }), 1500);
        return;
      }
      applyError(body as FnError);
    } catch {
      toast('Network error. Please try again.', 'error');
      setUi({ kind: 'error', message: 'network' });
    }

    function applyError(body: FnError) {
      if (body.error === 'too_early') {
        setUi({ kind: 'too_early', opens_at: body.opens_at });
      } else if (body.error === 'rsvp_required') {
        setUi({ kind: 'rsvp_required' });
        if (rsvpAnchorRef?.current) {
          rsvpAnchorRef.current.scrollIntoView({
            behavior: reduced ? 'auto' : 'smooth',
            block: 'center',
          });
          // Focus the first focusable button inside the anchor for keyboard
          // discoverability.
          const focusable = rsvpAnchorRef.current.querySelector<HTMLButtonElement>('button');
          focusable?.focus();
        }
      } else if (body.error === 'event_ended') {
        setUi({ kind: 'event_ended' });
      }
    }
  }, [eventId, rsvpAnchorRef, reduced, toast]);

  // Derive label + disabled state.
  const { label, disabled, ariaDisabled } = (() => {
    switch (ui.kind) {
      case 'pending':
        return { label: 'Opening…', disabled: true, ariaDisabled: true };
      case 'too_early': {
        const remainingMs = ui.opens_at ? new Date(ui.opens_at).getTime() - now : 0;
        const safeMs = Math.max(0, remainingMs);
        return {
          label: `Opens in ${formatCountdown(safeMs)}`,
          disabled: true,
          ariaDisabled: true,
        };
      }
      case 'rsvp_required':
        return { label: 'RSVP to see meeting link', disabled: true, ariaDisabled: true };
      case 'event_ended':
        return { label: 'Event ended', disabled: true, ariaDisabled: true };
      case 'ready':
        return { label: 'Opened in new tab', disabled: true, ariaDisabled: true };
      default:
        return { label: 'Join meeting', disabled: false, ariaDisabled: false };
    }
  })();

  const variantClass =
    ui.kind === 'event_ended' || ui.kind === 'rsvp_required'
      ? 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] border-[var(--color-border)]'
      : 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] hover:opacity-90';

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={disabled}
        aria-disabled={ariaDisabled}
        aria-busy={ui.kind === 'pending'}
        className={[
          'inline-flex items-center justify-center h-10 px-4 rounded-full text-sm font-semibold border transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]',
          variantClass,
          disabled ? 'cursor-not-allowed opacity-80' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {label}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {label}
      </span>
    </div>
  );
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

export default JoinMeetingButton;
