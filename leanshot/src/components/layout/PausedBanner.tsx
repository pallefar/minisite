/**
 * Phase 40 Plan 40-07 D-07 — PausedBanner component.
 *
 * Global chrome banner that renders only when the user's subscription is
 * paused (is_paused=true). Per D-07 (CONTEXT), this is always-on chrome at
 * the top of every dashboard view, mounted ONCE in AppShell.tsx BETWEEN
 * PastDueBanner and WorkspaceSwitcher.
 *
 * Patterns enforced:
 *   D — No hex literals; all colors via Phase 13 CSS token vars.
 *   E — Reduced-motion gating via useReducedMotion().
 *   G — Zero network calls from the banner itself; CTA dispatches
 *       leanshot:open-settings (existing 35-08 listener in App.tsx).
 *
 * ARIA: role="status" + aria-live="polite" — pause is a known scheduled state
 * (informational, NOT assertive like PastDueBanner's payment failure).
 *
 * Color tokens: --color-info-soft (background) + --color-info (text/border).
 * No --color-info-foreground token exists; info-soft + info pair is the
 * teal-palette informational treatment consistent with info toasts.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { PauseCircle } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/helpers';
import { useStore } from '@/lib/store';

/**
 * Format paused_until for human display.
 * Uses toLocaleDateString with month/day/year for locale-aware short date.
 * Fallback to 'soon' when paused_until is null (defensive).
 */
function formatPausedUntil(paused_until: string | null): string {
  if (!paused_until) return 'soon';
  try {
    return new Date(paused_until).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return 'soon';
  }
}

export function PausedBanner() {
  const is_paused = useStore((s) => s.is_paused);
  const paused_until = useStore((s) => s.paused_until);
  const reduced = useReducedMotion();

  // D-07: banner is independent of TierGate; self-hides when not paused.
  if (!is_paused) return null;

  const formattedDate = formatPausedUntil(paused_until);

  const handleResume = (): void => {
    // Reuses the EXISTING leanshot:open-settings listener wired at
    // App.tsx:1332-1333 (35-08 pattern). No new event listener needed.
    window.dispatchEvent(new CustomEvent('leanshot:open-settings'));
  };

  // D-07 verbatim copy — billing status strings not subject to translation pipeline.
  const bannerCopy = `Your account is paused — logging resumes ${formattedDate}. Resume now?`;
  const ctaLabel = 'Resume now?';

  const bannerContent = (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <PauseCircle className="size-4 shrink-0" aria-hidden="true" />
        <span className="text-[13px] font-semibold">{bannerCopy}</span>
      </div>
      <button
        onClick={handleResume}
        className={cn(
          'shrink-0 text-[12px] font-semibold px-3 py-1 rounded-lg',
          'bg-[var(--color-info)] text-[var(--color-bg)]',
          'hover:opacity-80 active:opacity-70 transition-opacity',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-info)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-info-soft)]',
        )}
      >
        {ctaLabel}
      </button>
    </>
  );

  // Pattern E: reduced-motion fallback — static block, no AnimatePresence/motion.div.
  if (reduced) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-[var(--color-info-soft)] text-[var(--color-info)] border-b border-[var(--color-border)] px-4 py-2.5 flex items-center justify-between gap-3"
      >
        {bannerContent}
      </div>
    );
  }

  // Full motion variant: slide-in animation (prefers-reduced-motion: false).
  return (
    <AnimatePresence>
      <motion.div
        role="status"
        aria-live="polite"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
        className="bg-[var(--color-info-soft)] text-[var(--color-info)] border-b border-[var(--color-border)] px-4 py-2.5 flex items-center justify-between gap-3"
      >
        {bannerContent}
      </motion.div>
    </AnimatePresence>
  );
}
