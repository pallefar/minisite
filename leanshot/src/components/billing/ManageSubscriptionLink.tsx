/**
 * Phase 14 Plan 14-06 — ManageSubscriptionLink component.
 *
 * Settings section row for paid and past_due users to manage their subscription.
 *
 * H2 (RC readiness): branch on the billing provider. Stripe (web) subscribers go to
 * the Stripe Customer Portal; RevenueCat (App Store / Play) subscribers go to the
 * platform's native subscription-management page. App Store / Play subscriptions are
 * NOT manageable via the Stripe portal (the portal invoke would fail with no
 * customer), and steering a mobile subscriber to a web payment provider is an App
 * Store §3.1.1 anti-steering rejection risk.
 *
 * Per D-08 / 14-CONTEXT: the Stripe portal opens in the SAME tab so the user returns
 * via Stripe's return_url. The native store pages open via @capacitor/browser.
 *
 * Patterns enforced:
 *   D — No hex literals; all colors via Phase 13 CSS token vars.
 *   G — Zero @stripe/stripe-js imports; portal URL via supabase.functions.invoke.
 */
import { CreditCard } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { detectPlatform } from '@/lib/native/platform';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

// H2: native subscription-management deep links.
const APPLE_MANAGE_URL = 'https://apps.apple.com/account/subscriptions';
const PLAY_MANAGE_URL =
  'https://play.google.com/store/account/subscriptions?package=app.leanshot.android';

export function ManageSubscriptionLink() {
  const provider = useStore((s) => s.provider);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // RevenueCat (App Store / Play) subscriptions are managed in the platform store,
  // NOT the Stripe portal (H2).
  const isRevenueCat = provider === 'revenuecat';
  const platform = detectPlatform();
  const storeLabel = platform === 'android' ? 'Google Play' : 'App Store';

  const handleStripe = async (): Promise<void> => {
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

  const handlePlatformManage = async (): Promise<void> => {
    setError(null);
    const url = platform === 'android' ? PLAY_MANAGE_URL : APPLE_MANAGE_URL;
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
    } catch {
      // Web / non-native fallback — open the store page in a new tab.
      try {
        window.open(url, '_blank', 'noopener');
      } catch {
        setError("Couldn't open the store. Try again.");
      }
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
            {isRevenueCat
              ? `Change plan or cancel in ${storeLabel}.`
              : 'Update card, change plan, or cancel.'}
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            void (isRevenueCat ? handlePlatformManage() : handleStripe());
          }}
          aria-busy={isRevenueCat ? false : loading}
          disabled={isRevenueCat ? false : loading}
        >
          {isRevenueCat ? `Open ${storeLabel}` : loading ? 'Opening Stripe…' : 'Open Stripe'}
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
