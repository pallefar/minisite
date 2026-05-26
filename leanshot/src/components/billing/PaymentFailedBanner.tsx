/**
 * Phase 65 Plan 65-09 — PaymentFailedBanner component (PAY-06 in-app banner).
 *
 * Renders above the topbar in the app shell when the user's subscription is
 * in an active dunning state. Three copy variants ladder by severity per
 * UI-SPEC §1 (first_failed → second_failed → final_warning). Renders nothing
 * when dunning_state is null, 'none', or the terminal 'cancelled_for_payment'.
 *
 * Intentional friction:
 *   - NOT dismissible (no close button) — re-renders on every page until the
 *     user updates their payment method.
 *   - Primary CTA "Update payment method" (NOT generic "Update") opens the
 *     Stripe Customer Portal via stripe-checkout/portal Edge Fn.
 *
 * Patterns:
 *   D — Tokens only (no hex literals). Surface uses --color-rose-soft (warning
 *       surface validated in Phase 61 UI-SPEC).
 *   G — Zero @stripe/stripe-js imports; portal URL via supabase.functions.invoke.
 *   Typography ceiling: 11 / 13 / 18 / heading + weights 400 / 600 only.
 *   Spacing: standard scale (p-3 / gap-3) — no arbitrary p-2.5.
 *
 * ARIA: role="alert" + aria-live="polite" (the user has 7+ days to act, so the
 * announcement is informational rather than assertive).
 */
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { useSubscription } from '@/hooks/useSubscription';
import { cn } from '@/lib/helpers';
import { supabase } from '@/lib/supabase';
import type { DunningState } from '@/types';

const COPY: Record<Exclude<DunningState, null | 'none' | 'cancelled_for_payment'>, string> = {
  first_failed:
    "We couldn't process your last payment. Please update your payment method.",
  second_failed:
    'Second payment attempt failed. Update your payment method to keep your access.',
  final_warning:
    "Your subscription will be cancelled if payment isn't updated within 24 hours.",
};

export function PaymentFailedBanner() {
  const { subscription } = useSubscription();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = subscription?.dunning_state ?? null;

  // Self-hide when no active dunning + when in terminal cancelled state.
  if (!state || state === 'none' || state === 'cancelled_for_payment') {
    return null;
  }
  // Unknown future states — fail closed (don't render an empty banner).
  if (!(state in COPY)) {
    return null;
  }
  const headline =
    COPY[state as Exclude<DunningState, null | 'none' | 'cancelled_for_payment'>];

  const handleUpdate = async (): Promise<void> => {
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
      // Same-tab redirect — user returns through Stripe's return_url.
      window.location.href = data.url;
    } catch {
      setError("Couldn't open Stripe. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'bg-[var(--color-rose-soft)] text-[var(--color-text)]',
        'border-b border-[var(--color-border)]',
        'px-4 py-3 flex items-center justify-between gap-3',
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <AlertTriangle
          className="size-4 shrink-0 text-[var(--color-danger)]"
          aria-hidden="true"
        />
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[13px] font-semibold">{headline}</span>
          {error && (
            <span
              role="status"
              aria-live="polite"
              className="text-[11px] font-normal text-[var(--color-text-secondary)]"
            >
              {error}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          void handleUpdate();
        }}
        aria-busy={loading}
        disabled={loading}
        className={cn(
          'shrink-0 text-[13px] font-semibold px-3 py-1 rounded-lg',
          'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]',
          'hover:brightness-95 active:opacity-90 transition-opacity',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        {loading ? 'Opening Stripe…' : 'Update payment method'}
      </button>
    </div>
  );
}
