/**
 * Phase 40 Plan 40-04 — Save-offer card for Step 2.
 * Renders a single server-picked offer per D-19. Never chooses between offers client-side.
 * Single-chunk: non-lazy import; lives in the cancellation chunk via CancellationModal.tsx.
 */
import {
  ArrowDownToLine,
  BadgePercent,
  CalendarPlus,
  Headset,
  Info,
  PauseCircle,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/helpers';
import type { DecideOfferResponse, OfferConfig, OfferType } from '@/types/cancellation';
import { PauseControls } from './PauseControls';

interface OfferCardProps {
  offerType: OfferType;
  offerConfig: OfferConfig;
  stacking: DecideOfferResponse['stacking'];
  onAccept: (pauseMonthsOverride?: 1 | 2 | 3) => void;
  onDecline: () => void;
  isPending: boolean;
}

const ICON_MAP: Record<OfferType, React.ComponentType<{ className?: string }>> = {
  pause: PauseCircle,
  discount: BadgePercent,
  extended_trial: CalendarPlus,
  downgrade: ArrowDownToLine,
  contact_csm: Headset,
};

function getHeadline(config: OfferConfig): string {
  switch (config.type) {
    case 'pause':
      return `Pause for ${config.pause_months} month${config.pause_months > 1 ? 's' : ''} — no charges`;
    case 'discount':
      return `Keep ${config.percent_off}% off for ${config.duration_in_months} months`;
    case 'extended_trial':
      return `Get ${config.extension_days} more days to decide`;
    case 'downgrade':
      return 'Switch to month-to-month billing';
    case 'contact_csm':
      return 'Talk to a Customer Success Manager';
  }
}

function getBodyCopy(config: OfferConfig): string {
  switch (config.type) {
    case 'pause':
      return 'Pause your subscription. No charges, no logging — your data waits for you.';
    case 'discount':
      return `Stay on for ${config.duration_in_months} more months at ${config.percent_off}% off. Your dose plan keeps progressing.`;
    case 'extended_trial':
      return `Get ${config.extension_days} more days to decide. Same access, no commitment.`;
    case 'downgrade':
      return 'Switch to month-to-month billing. Same features, smaller commitment.';
    case 'contact_csm':
      return 'A Customer Success Manager will reach out within 24 hours to talk through options.';
  }
}

function getDetailsStrip(config: OfferConfig, pauseMonths: 1 | 2 | 3): string | null {
  switch (config.type) {
    case 'pause': {
      const resumeDate = new Date();
      resumeDate.setMonth(resumeDate.getMonth() + pauseMonths);
      return `Resumes ${resumeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    case 'discount':
      return `Discount applies to your next ${config.duration_in_months} invoices`;
    case 'extended_trial': {
      const newDate = new Date();
      newDate.setDate(newDate.getDate() + config.extension_days);
      return `New billing date: ${newDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    case 'downgrade':
      return 'Save on your monthly rate';
    case 'contact_csm':
      return null;
  }
}

function getAcceptCopy(config: OfferConfig): string {
  switch (config.type) {
    case 'pause':
      return 'Pause my account';
    case 'discount':
      return `Keep ${config.percent_off}% off`;
    case 'extended_trial':
      return 'Extend my trial';
    case 'downgrade':
      return 'Switch to monthly';
    case 'contact_csm':
      return 'Yes — have a CSM contact me';
  }
}

function computeResumesAt(pauseMonths: 1 | 2 | 3): string {
  const d = new Date();
  d.setMonth(d.getMonth() + pauseMonths);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function OfferCard({
  offerType,
  offerConfig,
  stacking,
  onAccept,
  onDecline,
  isPending,
}: OfferCardProps) {
  const { t } = useTranslation('settings');
  const reducedMotion = useReducedMotion();
  const defaultPause = offerConfig.type === 'pause' ? offerConfig.pause_months : 2;
  const [pauseMonths, setPauseMonths] = useState<1 | 2 | 3>(defaultPause as 1 | 2 | 3);

  const OfferIcon = ICON_MAP[offerType];
  const headline = getHeadline(offerConfig);
  const body = getBodyCopy(offerConfig);
  const detailsStrip = getDetailsStrip(offerConfig, pauseMonths);

  const hasStacking =
    stacking !== null && stacking !== undefined && stacking.capped_pct < stacking.existing_pct + (offerConfig.type === 'discount' ? offerConfig.percent_off : 0);

  return (
    <div
      className={cn(
        'bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-6',
        !reducedMotion && 'transition-all',
      )}
    >
      {/* Icon */}
      <div className="flex items-center justify-center size-12 rounded-full bg-[var(--color-primary-soft)] mb-4">
        <OfferIcon className="size-8 text-[var(--color-primary)]" />
      </div>

      {/* Headline */}
      <h3 className="text-[16px] font-semibold text-[var(--color-text)] mb-2">
        {headline}
      </h3>

      {/* Body copy */}
      <p className="text-[13px] text-[var(--color-text-secondary)] mb-4">
        {body}
      </p>

      {/* Pause controls (only for pause offer) */}
      {offerConfig.type === 'pause' && (
        <div className="mb-4">
          <PauseControls
            value={pauseMonths}
            onChange={setPauseMonths}
            resumesAt={computeResumesAt(pauseMonths)}
          />
        </div>
      )}

      {/* Details strip */}
      {detailsStrip && offerConfig.type !== 'pause' && (
        <div className="bg-[var(--color-surface-soft)] rounded-md px-3 py-2 text-[13px] font-mono text-[var(--color-text-secondary)] mb-4">
          {detailsStrip}
        </div>
      )}

      {/* Stacking notice strip (D-15 mitigation) */}
      {hasStacking && stacking && (
        <div className="flex items-start gap-2 bg-[var(--color-warning-soft)] rounded-md px-3 py-3 mb-4">
          <Info className="size-4 shrink-0 text-[var(--color-text-secondary)] mt-0.5" aria-hidden />
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            {t('settings:cancellation.offer.stacking_notice', {
              existing_pct: stacking.existing_pct,
              capped_pct: stacking.capped_pct,
            })}
          </p>
        </div>
      )}

      {/* Footer CTAs */}
      <div className="flex flex-col gap-2 pt-4 border-t border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => onAccept(offerConfig.type === 'pause' ? pauseMonths : undefined)}
          disabled={isPending}
          aria-busy={isPending}
          className={cn(
            'w-full px-4 py-2.5 rounded-xl text-[14px] font-semibold bg-[var(--color-primary)] text-[var(--color-bg)] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
            isPending ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90',
          )}
        >
          {isPending ? t('settings:cancellation.offer.saving') : getAcceptCopy(offerConfig)}
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={isPending}
          className="w-full px-4 py-2 text-[13px] text-[var(--color-text-secondary)] underline-offset-2 hover:underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          {t('settings:cancellation.offer.decline')}
        </button>
      </div>
    </div>
  );
}
