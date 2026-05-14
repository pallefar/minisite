/**
 * Phase 14 Plan 14-06 — PastDueBanner component.
 *
 * Global chrome banner that renders only when the user's billing tier is
 * 'past_due'. Per D-08 (CONTEXT), this is always-on chrome at the top of
 * every dashboard view — NOT a TierGate.
 *
 * Patterns enforced:
 *   D — No hex literals; all colors via Phase 13 CSS token vars.
 *   E — Reduced-motion gating via useReducedMotion().
 *   G — Zero @stripe/stripe-js imports; portal URL fetched via supabase.functions.invoke.
 *
 * ARIA: role="alert" + aria-live="assertive" — payment failure is an assertive
 * announcement per WCAG SC 4.1.3. Error status uses role="status" + polite.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/helpers';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export function PastDueBanner() {
  const tier = useStore((s) => s.tier);
  const reduced = useReducedMotion();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // D-08: banner is independent of TierGate; self-hides for non-past_due tiers.
  if (tier !== 'past_due') return null;

  const handleUpdateCard = async (): Promise<void> => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke(
        'stripe-checkout/portal',
        { body: {} },
      );
      if (invokeErr || !data?.url) {
        throw new Error('no-url');
      }
      // Open in new tab per D-08 banner spec (ManageSubscriptionLink uses same-tab).
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      // Pattern G / Pitfall 8: do NOT echo upstream error message.
      setError("Couldn't open Stripe. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const bannerContent = (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        <span className="text-[13px] font-semibold">
          Your payment failed. Update your card to keep LeanShot Plus active.
        </span>
      </div>
      <button
        onClick={() => {
          void handleUpdateCard();
        }}
        aria-busy={loading}
        disabled={loading}
        className={cn(
          'shrink-0 text-[12px] font-semibold px-3 py-1 rounded-lg',
          'bg-[var(--color-warning-foreground)] text-[var(--color-warning)]',
          'hover:opacity-80 active:opacity-70 transition-opacity',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-warning-foreground)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-warning)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        {loading ? 'Opening Stripe…' : 'Update card'}
      </button>
    </>
  );

  // Pattern E: reduced-motion fallback — static block, no AnimatePresence/motion.div.
  if (reduced) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="bg-[var(--color-warning)] text-[var(--color-warning-foreground)] border-b border-[var(--color-border)] px-4 py-2.5 flex items-center justify-between gap-3"
      >
        {bannerContent}
        {error && (
          <span
            role="status"
            aria-live="polite"
            className="text-[11px] text-[var(--color-warning-foreground)] opacity-80 mt-0.5"
          >
            {error}
          </span>
        )}
      </div>
    );
  }

  // Full motion variant: slide-in animation (prefers-reduced-motion: false).
  return (
    <AnimatePresence>
      <motion.div
        role="alert"
        aria-live="assertive"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
        className="bg-[var(--color-warning)] text-[var(--color-warning-foreground)] border-b border-[var(--color-border)] px-4 py-2.5 flex items-center justify-between gap-3"
      >
        {bannerContent}
        {error && (
          <span
            role="status"
            aria-live="polite"
            className="text-[11px] text-[var(--color-warning-foreground)] opacity-80 mt-0.5"
          >
            {error}
          </span>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
