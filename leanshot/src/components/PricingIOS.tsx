/**
 * Phase 16 Plan 16-05 Task 2 — Native paywall surface (iOS + Android).
 *
 * Replaces the published pricing-page block tree on native platforms via the
 * lazy `getPricingComponent(platform)` switch in pricing-page-content.ts.
 * This module exists because Apple §3.1.1 (and Google Play §3.1.1) mandate
 * StoreKit / Play Billing for any digital subscription — serving the
 * Phase 14 Stripe Checkout button on iOS would fail review.
 *
 * Decisions implemented:
 *   • D-01 — single `plus` entitlement, two products (monthly + yearly).
 *   • D-03 — reverse-DNS product IDs (app.leanshot.plus.{monthly,yearly}).
 *   • D-13 — paywall fork (native vs web).
 *   • D-22 — trial-eligibility hides "Start with 7 days free" when the
 *     device already used the intro offer (or is in UNKNOWN state).
 *   • D-24 — clinic-owner role hides IAP entirely; portal redirect via
 *     @capacitor/browser opens Stripe Portal in Safari View Controller /
 *     Chrome Custom Tab (NOT in-app WKWebView nav).
 *
 * Anti-steering (Apple §3.1.1 / T-16-05-08): rendered DOM in the
 * NON-clinic-owner branch contains zero references to the web payment
 * provider or the web upgrade path — enforced by PricingIOS.test.tsx
 * runtime grep gate.
 * The clinic-owner caption "Opens Stripe billing in your browser" is the
 * one allowed Stripe mention (the user is managing an EXISTING enterprise
 * subscription per D-24 — not steering a consumer to web purchase).
 *
 * Single-SDK boundary: this component imports purchase calls from
 * `@/lib/native/iap` ONLY — never from `@revenuecat/purchases-capacitor`
 * directly. The iap.ts module is the sole legitimate RC importer.
 */
import { Building2, Check, ExternalLink } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button';
import { invalidateProCache, useCurrentUserHasPro } from '@/lib/entitlement/current-user-has-pro';
import {
  checkTrialEligibility,
  configureRC,
  getOfferings,
  purchaseSubscription,
  restorePurchases,
  type Offering,
  type TrialEligibility,
} from '@/lib/native/iap';
import { detectPlatform } from '@/lib/native/platform';
import { useStore } from '@/lib/store';

type PlanKey = 'monthly' | 'yearly';

const PRODUCT_IDS: Record<PlanKey, string> = {
  monthly: 'app.leanshot.plus.monthly',
  yearly: 'app.leanshot.plus.yearly',
};

const CLINIC_PORTAL_URL = 'https://leanshot.app/clinic/billing';
const PRIMARY_TOOLBAR_COLOR = '#1b4842';

function legalCopyForPlatform(platform: ReturnType<typeof detectPlatform>): string {
  if (platform === 'android') {
    return 'Payment processed by Google Play. Subscription renews automatically. Cancel anytime in Settings.';
  }
  return 'Payment processed by Apple. Subscription renews automatically. Cancel anytime in Settings.';
}

export default function PricingIOS(): ReactElement | null {
  const platform = detectPlatform();
  // Each store-read uses its own primitive selector to minimize re-renders
  // (CLAUDE.md "Components subscribe with one selector per primitive").
  const userId = useStore((s) => s.signedIn?.user?.id ?? null);
  const role = useStore(
    (s) => (s.signedIn?.user?.app_metadata as { role?: string } | undefined)?.role ?? null,
  );
  // H3: unified entitlement check — reads tier_effective.has_active across ALL
  // providers (Stripe web + RevenueCat mobile + lifetime). Gates the paywall so an
  // existing subscriber can't double-buy the `plus` entitlement.
  const { has_pro: alreadySubscribed } = useCurrentUserHasPro();

  const [offering, setOffering] = useState<Offering | null>(null);
  const [eligibility, setEligibility] = useState<TrialEligibility>({
    monthlyEligible: false,
    yearlyEligible: false,
  });
  const [selected, setSelected] = useState<PlanKey>('yearly');
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Configure RC + fetch offering + eligibility on mount. Only on native
  // platforms — the early-return below skips render on web so this effect's
  // SDK calls would also no-op via iap.ts platform guards.
  useEffect(() => {
    if (platform !== 'ios' && platform !== 'android') return;
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        await configureRC(userId);
        const [o, e] = await Promise.all([getOfferings(), checkTrialEligibility()]);
        if (cancelled) return;
        setOffering(o);
        setEligibility(e);
      } catch {
        // RcConfigError / SDK failure → render the clean disabled state.
        // No toast — the paywall just shows "Purchases temporarily unavailable".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, userId]);

  // Web → render nothing. The lazy getPricingComponent gate also returns
  // null on web, but defending here too means an accidental static import
  // path can't crash the SPA bundle.
  if (platform !== 'ios' && platform !== 'android') {
    return null;
  }

  // ─── Clinic-owner branch (D-24) ───────────────────────────────────────
  if (role === 'clinic_owner') {
    const handleOpenPortal = async (): Promise<void> => {
      try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({
          url: CLINIC_PORTAL_URL,
          toolbarColor: PRIMARY_TOOLBAR_COLOR,
        });
      } catch {
        try {
          useStore.getState().showToast("Couldn't open the billing portal. Try again.", 'error');
        } catch {
          /* toast unavailable — noop */
        }
      }
    };
    return (
      <section
        className="w-full px-6 py-16 text-start max-w-md mx-auto flex flex-col gap-6"
        aria-label="Clinic billing"
      >
        <div className="flex flex-col items-start gap-3">
          <Building2 aria-hidden className="size-5 text-[var(--color-text-secondary)]" />
          <h2 className="text-[22px] font-semibold tracking-tight">Clinic billing</h2>
          <p className="text-[16px] text-[var(--color-text-secondary)] leading-snug">
            Your subscription is managed at leanshot.app. Use the billing portal to update your plan
            or payment method.
          </p>
        </div>
        <Button variant="secondary" onClick={handleOpenPortal}>
          Go to Billing Portal
        </Button>
        <p className="text-[13px] text-[var(--color-text-secondary)] flex items-center gap-1">
          <ExternalLink aria-hidden className="size-3 inline-block" />
          Opens Stripe billing in your browser
        </p>
      </section>
    );
  }

  // ─── Already-subscribed guard (H3) ────────────────────────────────────
  // An existing subscriber (via Stripe web, a prior mobile purchase, or lifetime)
  // must NOT see a purchasable paywall — a second buy would double-charge for the
  // same `plus` entitlement. Mirrors the web UpgradeCTA guard.
  if (alreadySubscribed) {
    return (
      <section
        className="w-full px-6 py-16 text-start max-w-md mx-auto flex flex-col gap-4"
        aria-label="Subscription active"
      >
        <h2 className="text-[22px] font-semibold tracking-tight">You’re already subscribed</h2>
        <p className="text-[16px] text-[var(--color-text-secondary)] leading-snug">
          Your LeanShot Plus subscription is active. Manage or cancel it from your device’s
          subscription settings, or in LeanShot account settings.
        </p>
      </section>
    );
  }

  // ─── Non-clinic-owner paywall (D-13) ──────────────────────────────────
  const selectedPkg = selected === 'monthly' ? offering?.monthlyPackage : offering?.yearlyPackage;
  const selectedEligible =
    selected === 'monthly' ? eligibility.monthlyEligible : eligibility.yearlyEligible;
  const sdkReady = offering !== null;

  const handleSubscribe = async (): Promise<void> => {
    const productId = PRODUCT_IDS[selected];
    setPurchasing(true);
    try {
      const result = await purchaseSubscription(productId);
      if (result.cancelled) return; // silent — sheet dismissed
      // success path: Realtime channel in App.tsx will flip tier within ~5s;
      // no local mutation needed here.
    } catch {
      try {
        useStore.getState().showToast("Couldn't complete purchase. Try again.", 'error');
      } catch {
        /* toast unavailable — noop */
      }
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async (): Promise<void> => {
    setRestoring(true);
    try {
      const info = await restorePurchases();
      // M3: if restore re-granted the `plus` entitlement, resync the DB-backed
      // store tier (optimistic flip + invalidate the pro cache + re-read). A
      // reinstall or RC TRANSFER restore that the webhook no-ops would otherwise
      // leave the user gated as free despite a "Purchases restored." toast.
      const restoredPlus = Boolean(info?.entitlements.active['plus']);
      if (restoredPlus && userId) {
        invalidateProCache(userId);
        useStore.getState().setTier({ tier: 'paid', provider: 'revenuecat' });
        void import('@/lib/billing-sync').then(({ syncBillingTier }) => syncBillingTier(userId));
      }
      try {
        useStore
          .getState()
          .showToast(
            restoredPlus ? 'Purchases restored.' : 'No purchases found to restore.',
            restoredPlus ? 'success' : 'info',
          );
      } catch {
        /* noop */
      }
    } catch {
      try {
        useStore.getState().showToast("Couldn't restore purchases. Try again.", 'error');
      } catch {
        /* noop */
      }
    } finally {
      setRestoring(false);
    }
  };

  return (
    <section
      className="w-full px-6 py-16 text-start max-w-md mx-auto flex flex-col gap-6"
      aria-label="LeanShot Plus"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-[26px] font-semibold tracking-tight leading-tight">
          LeanShot <span className="font-[Fraunces,serif] italic font-normal">Plus</span>
        </h1>
        <p className="text-[16px] text-[var(--color-text-secondary)]">
          7-day forecast · AI coach · ad-free
        </p>
      </header>

      <div className="flex flex-col gap-3" role="radiogroup" aria-label="Choose plan">
        {(
          [
            {
              key: 'yearly' as const,
              label: 'Yearly',
              recommended: true,
              pkg: offering?.yearlyPackage,
              eligible: eligibility.yearlyEligible,
              savingsBadge: 'Save 15%',
            },
            {
              key: 'monthly' as const,
              label: 'Monthly',
              recommended: false,
              pkg: offering?.monthlyPackage,
              eligible: eligibility.monthlyEligible,
              savingsBadge: null,
            },
          ] as const
        ).map((tile) => {
          const isSelected = selected === tile.key;
          const planClass = tile.recommended
            ? 'bg-[var(--color-surface-elevated)] border-2 border-[var(--color-primary)] shadow-[0_0_0_4px_var(--color-primary-soft)] rounded-xl p-6 flex flex-col text-start'
            : 'bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-xs)] rounded-xl p-6 flex flex-col text-start';
          return (
            <button
              key={tile.key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setSelected(tile.key)}
              className={`${planClass} cursor-pointer ${isSelected ? '' : 'opacity-90'}`}
            >
              <span className="text-[13px] font-semibold uppercase tracking-[0.06em] opacity-70">
                {tile.label}
              </span>
              <span className="mt-2 text-[22px] font-semibold">{tile.pkg?.priceString ?? '—'}</span>
              {tile.savingsBadge && (
                <span className="mt-1 text-[13px] text-[var(--color-primary)] font-semibold">
                  {tile.savingsBadge}
                </span>
              )}
              <ul className="mt-3 flex flex-col gap-1 text-[16px]">
                <li className="flex items-start gap-2">
                  <Check
                    aria-hidden
                    className="size-4 shrink-0 mt-[2px] text-[var(--color-success)]"
                  />
                  <span>7-day drug-level forecast</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check
                    aria-hidden
                    className="size-4 shrink-0 mt-[2px] text-[var(--color-success)]"
                  />
                  <span>AI coach (BYO Anthropic key)</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check
                    aria-hidden
                    className="size-4 shrink-0 mt-[2px] text-[var(--color-success)]"
                  />
                  <span>Ad-free experience</span>
                </li>
              </ul>
            </button>
          );
        })}
      </div>

      {selectedEligible && (
        <p className="text-[16px] text-[var(--color-text-secondary)] text-center">
          Start with 7 days free
        </p>
      )}

      <Button
        variant="primary"
        onClick={handleSubscribe}
        disabled={!sdkReady || purchasing || !selectedPkg}
        aria-busy={purchasing}
      >
        Subscribe
      </Button>

      <button
        type="button"
        onClick={handleRestore}
        disabled={restoring}
        className="min-h-[44px] text-[16px] text-[var(--color-text-secondary)] underline self-center"
      >
        Restore Purchases
      </button>

      {!sdkReady && (
        <p className="text-[13px] text-[var(--color-text-secondary)] text-center">
          Purchases temporarily unavailable
        </p>
      )}

      <p className="text-[13px] text-[var(--color-text-secondary)] text-center leading-snug">
        {legalCopyForPlatform(platform)}
      </p>
    </section>
  );
}
