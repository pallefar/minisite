/**
 * Phase 14 Plan 14-09 — PaywallUpsell component (CR-02 gap closure).
 *
 * Renders a tonal upsell card with an "Upgrade" CTA that redirects to the
 * Stripe Checkout session via supabase.functions.invoke('stripe-checkout/session', ...).
 * Mirrors the UpgradeCTA.tsx checkout pattern exactly. Accepts a `plan` prop
 * (default 'plus_monthly') typed via the shared Plan union from @/lib/billing.
 *
 * CR-02 closed: the original fetchCheckoutUrl() posted to a bare
 * `/functions/v1/stripe-checkout` path (404) with credentials:'include' and no
 * JWT (401) and no plan body (400). The correct pattern is now via
 * supabase.functions.invoke('stripe-checkout/session', { body: { plan } }).
 *
 * CRITICAL (RESEARCH Pitfall 10 / CONTEXT D-05 / Pattern G):
 * This component does NOT import @stripe/stripe-js. The Upgrade button fires
 * supabase.functions.invoke and assigns window.location.href to the returned
 * session URL. No Stripe.js loaded here.
 *
 * variant="overlay" — centered card positioned above blurred chart content.
 * variant="cta"     — inline/pill card rendered in place of gated UI element.
 *
 * Existing consumers (MedLevelChart variant="overlay", AIChatPanel variant="cta")
 * render <PaywallUpsell> without a plan prop — the default 'plus_monthly' ensures
 * zero edits needed at those call sites.
 */
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { FeatureKey, Plan } from '@/lib/billing';
import { supabase } from '@/lib/supabase';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface PaywallUpsellProps {
  variant: 'overlay' | 'cta';
  feature: FeatureKey;
  /** Optional override of upsell headline; defaults derived from feature key. */
  headline?: string;
  /**
   * Which plan to send to the checkout endpoint. Defaults to 'plus_monthly'.
   * Existing consumers (MedLevelChart, AIChatPanel) omit this prop and get
   * the 'plus_monthly' default — zero changes needed at those call sites.
   */
  plan?: Plan;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaultHeadline(feature: FeatureKey): string {
  switch (feature) {
    case 'pharma-forecast':
      return '7-day forecast';
    case 'advanced-ai':
      return 'AI Coach Pro';
    case 'ad-free':
      return 'Ad-free experience';
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PaywallUpsell({
  variant,
  feature,
  headline,
  plan = 'plus_monthly',
}: PaywallUpsellProps) {
  const reduced = useReducedMotion();
  const title = headline ?? defaultHeadline(feature);

  const handleUpgrade = async (): Promise<void> => {
    try {
      const { data, error } = await supabase.functions.invoke(
        'stripe-checkout/session',
        { body: { plan } },
      );
      if (error || !data?.url) {
        // Pattern G / Pitfall 8: do NOT echo upstream error message to UI.
        console.error('[PaywallUpsell] checkout invoke failed', error?.message ?? 'no-url');
        return;
      }
      // Pattern G: plain redirect, no @stripe/stripe-js required.
      window.location.href = data.url;
    } catch (err) {
      console.error('[PaywallUpsell] upgrade redirect failed', err);
    }
  };

  if (variant === 'overlay') {
    return (
      <div
        className={
          'absolute inset-0 z-10 flex items-center justify-center p-4' +
          (reduced ? '' : ' transition-opacity duration-200')
        }
      >
        <Card
          variant="tonal"
          padding="md"
          className="max-w-xs w-full text-center shadow-lg"
        >
          <p className="text-[15px] font-bold text-[var(--color-text)] mb-1">{title}</p>
          <p className="text-[12px] text-[var(--color-text-secondary)] mb-4">
            7-day free trial — cancel anytime
          </p>
          <Button
            variant="primary"
            size="md"
            aria-label={`Upgrade to unlock ${title}`}
            onClick={() => {
              void handleUpgrade();
            }}
          >
            Upgrade
          </Button>
        </Card>
      </div>
    );
  }

  // variant="cta" — inline pill card (replaces gated UI element in header)
  return (
    <Card
      variant="tonal"
      padding="none"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-pill"
    >
      <span className="text-[12px] font-semibold text-[var(--color-primary)]">Free</span>
      <Button
        variant="tonal"
        size="sm"
        aria-label={`Upgrade to unlock ${title}`}
        onClick={() => {
          void handleUpgrade();
        }}
      >
        Upgrade
      </Button>
    </Card>
  );
}
