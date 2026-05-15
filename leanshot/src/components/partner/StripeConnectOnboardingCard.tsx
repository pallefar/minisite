/**
 * Phase 19 Plan 19-06b — StripeConnectOnboardingCard (REAL 4-state machine).
 *
 * Overwrites the Plan 19-06a placeholder. Renders state-specific heading +
 * body + CTA per 19-UI-SPEC.md §"Stripe Connect Onboarding Card — State
 * Machine" + 19-PATTERNS.md §C.13.
 *
 * 4 states:
 *   pending     — account created, details_submitted=false
 *   needs_info  — requirements.currently_due.length > 0
 *   active      — charges_enabled && payouts_enabled → renders null (HIDDEN)
 *   restricted  — requirements.disabled_reason set
 *
 * CTA behavior (D-08): for `pending` + `needs_info` states, POST to
 *   /functions/v1/stripe-connect-onboard → response `{ url }` is opened in
 *   a NEW TAB (`target="_blank" rel="noopener noreferrer"`). URLs are 5-min
 *   single-use per Stripe — never persisted client-side.
 *
 * `restricted` state CTA is a mailto: link to support (no Stripe call).
 *
 * Slide-down animation on first render (300ms) — honors useReducedMotion.
 *
 * Consumed by:
 *   - /partner/dashboard (above KPIs, when connectState !== 'active')
 *   - /partner/payouts (above next-payout banner)
 */
import { type ReactNode, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/helpers';
import { supabase } from '@/lib/supabase';

export type ConnectState = 'pending' | 'needs_info' | 'active' | 'restricted';

export interface StripeConnectOnboardingCardProps {
  state: ConnectState;
  requirements: string[];
  disabledReason: string | null;
}

// State-specific copy locks per UI-SPEC §"Stripe Connect Onboarding Card".
// Editing copy here changes the user-visible string — must match UI-SPEC.
const COPY = {
  pending: {
    heading: 'Complete tax onboarding to receive payouts',
    body: 'We need W-9 / W-8BEN info from Stripe before your first payout. Takes about 5 minutes.',
    cta: 'Start onboarding →',
  },
  needs_info: {
    heading: 'Stripe needs more info',
    bodyPrefix: 'Stripe is requesting: ',
    bodySuffix: '. Complete to unlock payouts.',
    cta: 'Continue onboarding →',
  },
  restricted: {
    heading: 'Your payout account is on hold',
    bodyPrefix: 'Stripe has restricted payouts: ',
    bodySuffix: ". We've emailed you details. Reply to that email or contact support.",
    cta: 'Contact support',
  },
} as const;

const SUPPORT_EMAIL = 'support@leanshot.app';

async function requestOnboardingUrl(): Promise<string | null> {
  try {
    const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
    const sess = await supabase.auth.getSession();
    const jwt = sess.data.session?.access_token;
    if (!jwt) return null;
    const res = await fetch(`${base}/functions/v1/stripe-connect-onboard`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      credentials: 'omit',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { url?: string };
    return typeof json.url === 'string' && json.url ? json.url : null;
  } catch {
    return null;
  }
}

/** Format the first N entries from `requirements`, then "+M more". */
function formatRequirements(reqs: string[], max = 3): string {
  if (reqs.length === 0) return '';
  const head = reqs.slice(0, max).join(', ');
  const remaining = Math.max(0, reqs.length - max);
  return `${head} +${remaining} more`;
}

export function StripeConnectOnboardingCard({
  state,
  requirements,
  disabledReason,
}: StripeConnectOnboardingCardProps): ReactNode {
  const reduced = useReducedMotion();
  const [enter, setEnter] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // First-render slide-down (UI-SPEC §Interaction). Skip when reduced motion.
  useEffect(() => {
    if (reduced) {
      setEnter(true);
      return;
    }
    const id = window.requestAnimationFrame(() => setEnter(true));
    return () => window.cancelAnimationFrame(id);
  }, [reduced]);

  // State='active' → hide entirely (UI-SPEC: card not rendered when active).
  if (state === 'active') return null;

  const handleStripeCta = async (): Promise<void> => {
    if (loading) return;
    setLoading(true);
    setError(null);
    const url = await requestOnboardingUrl();
    setLoading(false);
    if (!url) {
      setError("Couldn't open Stripe. Try again.");
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const transitionClass = reduced
    ? ''
    : cn(
        'transition-[transform,opacity] duration-[300ms] ease-out',
        enter ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0',
      );

  // Tonal card for pending/needs_info; needs_info adds a warning border.
  // restricted uses default variant with a danger left-border.
  if (state === 'pending') {
    return (
      <div className={transitionClass}>
        <Card variant="tonal" padding="lg" span={12}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <h2 className="text-[18px] font-semibold text-[var(--color-text)] mb-1">
                {COPY.pending.heading}
              </h2>
              <p className="text-[14px] text-[var(--color-text-secondary)]">
                {COPY.pending.body}
              </p>
              {error && (
                <p
                  role="status"
                  aria-live="polite"
                  className="text-[12px] text-[var(--color-danger)] mt-2"
                >
                  {error}
                </p>
              )}
            </div>
            <Button
              variant="primary"
              onClick={() => {
                void handleStripeCta();
              }}
              loading={loading}
              aria-busy={loading || undefined}
            >
              {COPY.pending.cta}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (state === 'needs_info') {
    return (
      <div className={transitionClass}>
        <Card
          variant="tonal"
          padding="lg"
          span={12}
          className="border-[var(--color-warning)]"
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-[18px] font-semibold text-[var(--color-text)]">
                  {COPY.needs_info.heading}
                </h2>
                <Badge tone="warning">Action needed</Badge>
              </div>
              <p className="text-[14px] text-[var(--color-text-secondary)]">
                {COPY.needs_info.bodyPrefix}
                <span className="font-medium text-[var(--color-text)]">
                  {formatRequirements(requirements)}
                </span>
                {COPY.needs_info.bodySuffix}
              </p>
              {error && (
                <p
                  role="status"
                  aria-live="polite"
                  className="text-[12px] text-[var(--color-danger)] mt-2"
                >
                  {error}
                </p>
              )}
            </div>
            <Button
              variant="primary"
              onClick={() => {
                void handleStripeCta();
              }}
              loading={loading}
              aria-busy={loading || undefined}
            >
              {COPY.needs_info.cta}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // state === 'restricted'
  return (
    <div className={transitionClass}>
      <Card
        variant="default"
        padding="lg"
        span={12}
        className="border-l-4 border-l-[var(--color-danger)]"
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold text-[var(--color-text)] mb-1">
              {COPY.restricted.heading}
            </h2>
            <p className="text-[14px] text-[var(--color-text-secondary)]">
              {COPY.restricted.bodyPrefix}
              <span className="font-medium text-[var(--color-text)]">
                {disabledReason ?? 'requirements.past_due'}
              </span>
              {COPY.restricted.bodySuffix}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              window.location.href = `mailto:${SUPPORT_EMAIL}?subject=Stripe%20Connect%20payout%20hold`;
            }}
          >
            {COPY.restricted.cta}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default StripeConnectOnboardingCard;
