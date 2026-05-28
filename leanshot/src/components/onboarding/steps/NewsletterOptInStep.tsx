/**
 * NewsletterOptInStep.tsx — Optional newsletter opt-in step for onboarding.
 *
 * Phase 60 Plan 60-12 Task 4.
 *
 * CAN-SPAM affirmative opt-in: checkbox is UNCHECKED by default.
 * Per UI-SPEC §Critical UI Invariant #9 + CONTEXT.md D-26 + CAN-SPAM:
 * "default OFF" overrides any legacy "default ON for paid users" rule.
 * The step is OPTIONAL — user may skip without checking.
 */

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';

export interface NewsletterOptInStepProps {
  // Whether the checkbox is currently checked
  checked: boolean;
  onChange: (checked: boolean) => void;
  onNext: () => void;
  onBack: () => void;
}

export function NewsletterOptInStep({
  checked,
  onChange,
  onNext,
  onBack,
}: NewsletterOptInStepProps) {
  const { t } = useTranslation(['rag', 'common', 'onboarding']);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-heading font-semibold tracking-tight">{t('rag:newsletter.header')}</h1>
        <p
          id="newsletter-opt-in-desc"
          className="text-[11px] text-[var(--color-text-tertiary)] mt-1"
        >
          {t('rag:newsletter.toggle_sublabel')}
        </p>
      </div>

      <label
        htmlFor="newsletter-opt-in"
        className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)]"
      >
        {/* CAN-SPAM affirmative opt-in: MUST default unchecked. */}
        <input
          id="newsletter-opt-in"
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby="newsletter-opt-in-desc"
          className="mt-0.5 w-4 h-4 accent-[var(--color-primary)] cursor-pointer"
        />
        <span className="text-sm leading-relaxed">{t('rag:newsletter.onboarding_label')}</span>
      </label>

      <div className="flex gap-2 mt-7">
        <Button
          variant="ghost"
          onClick={onBack}
          leadingIcon={<ArrowLeft className="size-4" />}
          className="flex-1"
        >
          {t('onboarding:nav.back')}
        </Button>
        <Button
          onClick={onNext}
          trailingIcon={<ArrowRight className="size-4" />}
          className="flex-1"
        >
          {t('common:action.continue')}
        </Button>
      </div>
    </div>
  );
}
