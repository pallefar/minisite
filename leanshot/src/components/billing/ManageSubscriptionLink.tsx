/**
 * Phase 14 Plan 14-06 — ManageSubscriptionLink component.
 *
 * Settings section row for paid and past_due users to access the Stripe
 * Customer Portal (change plan, update card, cancel).
 *
 * Per D-08 / 14-CONTEXT: opens in SAME tab (not new tab) from Settings drawer
 * so the user returns naturally via Stripe's "Return to LeanShot" return_url.
 *
 * Patterns enforced:
 *   D — No hex literals; all colors via Phase 13 CSS token vars.
 *   G — Zero @stripe/stripe-js imports; portal URL via supabase.functions.invoke.
 */
import { CreditCard } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';

export function ManageSubscriptionLink() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async (): Promise<void> => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('stripe-checkout/portal', {
        body: {},
      });
      if (invokeErr || !data?.url) {
        throw new Error('no-url');
      }
      // Same-tab redirect: Settings UX; user returns via Stripe's return_url.
      window.location.href = data.url;
    } catch {
      // Pattern G / Pitfall 8: do NOT echo upstream error message.
      setError("Couldn't open Stripe. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-3">
        <CreditCard
          className="size-5 shrink-0 text-[var(--color-text-secondary)]"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-[var(--color-text)]">Manage subscription</p>
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            Update card, change plan, or cancel.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            void handleClick();
          }}
          aria-busy={loading}
          disabled={loading}
        >
          {loading ? 'Opening Stripe…' : 'Open Stripe'}
        </Button>
      </div>
      {error && (
        <span
          role="status"
          aria-live="polite"
          className="block mt-2 text-[11px] text-[var(--color-danger)]"
        >
          {error}
        </span>
      )}
    </Card>
  );
}
