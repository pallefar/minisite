/**
 * Phase 14 Plan 14-06 — UpgradeCTA component.
 *
 * Settings section entry for free users to start a subscription.
 * Renders nothing for paid or past_due users (per D-09; those see
 * ManageSubscriptionLink instead).
 *
 * Two plan options per D-09 (web pricing):
 *   plus_monthly: $12.99/mo
 *   plus_yearly:  $132.49/yr — save 15% ($12.99 × 12 × 0.85 = $132.49)
 *
 * Patterns enforced:
 *   D — No hex literals; all colors via Phase 13 CSS token vars.
 *   G — Zero @stripe/stripe-js imports; checkout URL via supabase.functions.invoke.
 *       Plain window.location.href = url redirect (Hosted Checkout pattern).
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { Plan } from '@/lib/billing';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

// Per D-09; keep in sync with leanshot/.env.example STRIPE_PRICE_PLUS_MONTHLY price object
const MONTHLY_PRICE_DISPLAY = '$12.99/mo';
// Per D-09; $12.99 × 12 × 0.85 = $132.49
const YEARLY_PRICE_DISPLAY = '$132.49/yr — save 15%';

type PlanTag = 'monthly' | 'yearly';

const PLAN_MAP: Record<PlanTag, Plan> = {
  monthly: 'plus_monthly',
  yearly: 'plus_yearly',
};

export function UpgradeCTA() {
  const tier = useStore((s) => s.tier);
  const [loading, setLoading] = useState<PlanTag | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only free users see the upgrade CTA (paid + past_due use ManageSubscriptionLink).
  if (tier !== 'free') return null;

  const startCheckout = async (planTag: PlanTag): Promise<void> => {
    if (loading) return;
    setLoading(planTag);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke(
        'stripe-checkout/session',
        { body: { plan: PLAN_MAP[planTag] } },
      );
      if (invokeErr || !data?.url) {
        throw new Error('no-url');
      }
      // Same-tab redirect: Hosted Checkout returns to success_url after card entry.
      // Pattern G: plain redirect, no @stripe/stripe-js required.
      window.location.href = data.url;
    } catch {
      // Pattern G / Pitfall 8: do NOT echo upstream error message.
      setError("Couldn't open Stripe. Try again.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card>
      <div className="space-y-3">
        <div>
          <p className="text-[14px] font-semibold text-[var(--color-text)]">Upgrade to Plus</p>
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            Unlock 7-day forecast + advanced AI coach.
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <Button
            variant="primary"
            onClick={() => {
              void startCheckout('monthly');
            }}
            aria-busy={loading === 'monthly'}
            disabled={loading !== null}
          >
            {MONTHLY_PRICE_DISPLAY}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              void startCheckout('yearly');
            }}
            aria-busy={loading === 'yearly'}
            disabled={loading !== null}
          >
            {YEARLY_PRICE_DISPLAY}
          </Button>
        </div>
        {error && (
          <span
            role="status"
            aria-live="polite"
            className="block text-[11px] text-[var(--color-danger)]"
          >
            {error}
          </span>
        )}
      </div>
    </Card>
  );
}
