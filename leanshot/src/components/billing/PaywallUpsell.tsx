/**
 * Phase 14 Plan 14-05 — PaywallUpsell component.
 *
 * Renders a tonal upsell card with an "Upgrade" CTA that redirects to the
 * Stripe Checkout session (Plan 14-04 Edge Function).
 *
 * CRITICAL (RESEARCH Pitfall 10 / CONTEXT D-05 / Pattern G):
 * This component does NOT import @stripe/stripe-js. The Upgrade button fires
 * a plain fetch to the stripe-checkout Edge Function and assigns
 * window.location.href to the returned session URL. No Stripe.js loaded here.
 *
 * variant="overlay" — centered card positioned above blurred chart content.
 * variant="cta"     — inline/pill card rendered in place of gated UI element.
 *
 * Plan 14-06 will refactor fetchCheckoutUrl into a shared useUpgradeRedirect()
 * hook. For now it's a thin local async function so 14-05 ships independently.
 */
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { FeatureKey } from '@/lib/billing';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface PaywallUpsellProps {
  variant: 'overlay' | 'cta';
  feature: FeatureKey;
  /** Optional override of upsell headline; defaults derived from feature key. */
  headline?: string;
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

/**
 * fetchCheckoutUrl — thin local helper that POST-requests the Plan 14-04
 * stripe-checkout Edge Function and returns { url: string }.
 *
 * Plan 14-06 will refactor this into a shared useUpgradeRedirect() hook.
 * No @stripe/stripe-js import — direct redirect via window.location.href (Pattern G).
 */
async function fetchCheckoutUrl(): Promise<{ url: string }> {
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${base}/functions/v1/stripe-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`checkout-fetch-failed: ${res.status}`);
  }
  return res.json() as Promise<{ url: string }>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PaywallUpsell({ variant, feature, headline }: PaywallUpsellProps) {
  const reduced = useReducedMotion();
  const title = headline ?? defaultHeadline(feature);

  const handleUpgrade = async (): Promise<void> => {
    try {
      const { url } = await fetchCheckoutUrl();
      window.location.href = url;
    } catch (err) {
      // Plan 14-06 will wire a proper toast; for now log silently.
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
