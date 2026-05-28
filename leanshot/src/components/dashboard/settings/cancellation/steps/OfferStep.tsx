/**
 * Phase 40 Plan 40-04 — Step 2: Server-picked save-offer display (D-19).
 * Calls decide-offer on mount; shows skeleton for ≤800ms then renders the offer card.
 * Single-chunk: non-lazy import; lives in the cancellation chunk via CancellationModal.tsx.
 */
import { ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/useToast';
import { track } from '@/lib/analytics';
import { callAcceptOffer } from '@/lib/cancellation/accept-offer-client';
import { callDecideOffer } from '@/lib/cancellation/decide-offer-client';
import type { CancellationReason, DecideOfferResponse } from '@/types/cancellation';
import { OfferCard } from '../OfferCard';

interface OfferStepProps {
  reason: CancellationReason;
  reason_other_text?: string;
  onAdvance: () => void;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'ineligible'; code: string }
  | { status: 'ready'; data: DecideOfferResponse }
  | { status: 'error' };

function getTenureCopy(_offer: DecideOfferResponse): string {
  // The Edge Fn does not currently expose tenure_bucket in its response,
  // so we use generic copy as the safe default.
  return 'Personalized for your time so far. Take it or continue cancelling.';
}

function getStepTitle(offer: DecideOfferResponse): string {
  if (!offer.offer_type) return 'Before you go';
  switch (offer.offer_type) {
    case 'pause':
      return 'Before you go — have a pause on us';
    case 'discount':
      return `Before you go — keep ${(offer.offer_config as { percent_off?: number })?.percent_off ?? ''}% off`;
    case 'extended_trial':
      return 'Before you go — extend your trial';
    case 'downgrade':
      return 'Before you go — switch to monthly';
    case 'contact_csm':
      return "Before you go — let's talk first";
  }
}

export function OfferStep({ reason, reason_other_text, onAdvance }: OfferStepProps) {
  const { t } = useTranslation('settings');
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'loading' });
  const [isPending, setIsPending] = useState(false);
  const mounted = useRef(true);
  const toast = useToast();

  useEffect(() => {
    mounted.current = true;
    const minDelay = new Promise<void>((resolve) => setTimeout(resolve, 400));

    callDecideOffer({ reason, reason_other_text })
      .then(async (data) => {
        await minDelay;
        if (!mounted.current) return;
        if (data.ineligible_code) {
          setFetchState({ status: 'ineligible', code: data.ineligible_code });
        } else {
          track('save_offer_shown', { offer_type: data.offer_type ?? 'none' });
          setFetchState({ status: 'ready', data });
        }
      })
      .catch(() => {
        if (!mounted.current) return;
        setFetchState({ status: 'error' });
      });

    return () => {
      mounted.current = false;
    };
  }, [reason, reason_other_text]);

  const handleAccept = async (pauseMonthsOverride?: 1 | 2 | 3): Promise<void> => {
    if (fetchState.status !== 'ready' || !fetchState.data.offer_id) return;
    setIsPending(true);
    try {
      await callAcceptOffer({
        offer_id: fetchState.data.offer_id,
        pause_months_override: pauseMonthsOverride,
      });
      track('save_offer_accepted', { offer_type: fetchState.data.offer_type ?? 'unknown' });
      // Show accepted toast then advance to Step 3
      const offerType = fetchState.data.offer_type;
      if (offerType === 'pause') {
        toast(t('settings:cancellation.offer.toast.paused'), 'success');
      } else if (offerType === 'discount') {
        const pct = (fetchState.data.offer_config as { percent_off?: number })?.percent_off ?? 0;
        toast(t('settings:cancellation.offer.toast.discount', { pct }), 'success');
      } else if (offerType === 'extended_trial') {
        toast(t('settings:cancellation.offer.toast.extended_trial'), 'success');
      } else if (offerType === 'downgrade') {
        toast(t('settings:cancellation.offer.toast.downgrade'), 'success');
      } else if (offerType === 'contact_csm') {
        toast(t('settings:cancellation.offer.toast.contact_csm'), 'success');
      }
      onAdvance();
    } catch {
      toast(t('settings:cancellation.offer.error_generic'), 'error');
    } finally {
      if (mounted.current) setIsPending(false);
    }
  };

  const handleDecline = (): void => {
    if (fetchState.status === 'ready') {
      track('save_offer_declined', { offer_type: fetchState.data.offer_type ?? 'unknown' });
    }
    onAdvance();
  };

  if (fetchState.status === 'loading') {
    return (
      <div
        aria-busy="true"
        aria-label={t('settings:cancellation.offer.loading_label')}
        className="space-y-4"
      >
        <div className="h-6 w-3/4 bg-[var(--color-surface-elevated)] rounded-md animate-pulse" />
        <div className="h-4 w-full bg-[var(--color-surface-elevated)] rounded-md animate-pulse" />
        <div className="h-48 w-full bg-[var(--color-surface-elevated)] rounded-xl animate-pulse" />
      </div>
    );
  }

  if (fetchState.status === 'error') {
    return (
      <div className="space-y-4">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          {t('settings:cancellation.offer.error_generic')}
        </p>
        <button
          type="button"
          onClick={handleDecline}
          className="px-5 py-2.5 rounded-xl text-[14px] font-semibold bg-[var(--color-primary)] text-[var(--color-bg)] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          {t('common:action.continue')}
        </button>
      </div>
    );
  }

  if (fetchState.status === 'ineligible') {
    return (
      <div className="space-y-4">
        <div>
          <h2
            id="cancel-step-title"
            className="text-[18px] font-semibold text-[var(--color-text)]"
            tabIndex={-1}
          >
            {t('settings:cancellation.offer.ineligible_title')}
          </h2>
        </div>
        <div className="flex flex-col items-center gap-4 py-8">
          <ShieldCheck className="size-12 text-[var(--color-text-tertiary)]" aria-hidden />
          <p className="text-[13px] text-[var(--color-text-secondary)] text-center">
            {t('settings:cancellation.offer.ineligible_body')}
          </p>
        </div>
        <div className="pt-4 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={handleDecline}
            className="w-full px-5 py-2.5 rounded-xl text-[14px] font-semibold bg-[var(--color-primary)] text-[var(--color-bg)] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            {t('common:action.continue')}
          </button>
        </div>
      </div>
    );
  }

  // ready state
  const { data } = fetchState;
  if (!data.offer_type || !data.offer_config) {
    // Server returned no eligible offer
    return (
      <div className="space-y-4">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          {t('settings:cancellation.offer.no_offer')}
        </p>
        <button
          type="button"
          onClick={handleDecline}
          className="px-5 py-2.5 rounded-xl text-[14px] font-semibold bg-[var(--color-primary)] text-[var(--color-bg)] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          {t('common:action.continue')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2
          id="cancel-step-title"
          className="text-[18px] font-semibold text-[var(--color-text)]"
          tabIndex={-1}
        >
          {getStepTitle(data)}
        </h2>
        <p id="cancel-step-body" className="text-[13px] text-[var(--color-text-secondary)] mt-1">
          {getTenureCopy(data)}
        </p>
      </div>

      <OfferCard
        offerType={data.offer_type}
        offerConfig={data.offer_config}
        stacking={data.stacking}
        onAccept={handleAccept}
        onDecline={handleDecline}
        isPending={isPending}
      />
    </div>
  );
}
