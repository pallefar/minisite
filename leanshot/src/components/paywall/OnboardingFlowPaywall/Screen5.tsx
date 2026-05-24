/**
 * Phase 39 Plan 39-04 — OnboardingFlowPaywall Screen 5 (pricing, D-14).
 *
 * UI-SPEC §Typography: pricing $-amount uses text-2xl font-bold (display
 * size, opt-in only for hero metric per ramp).
 */
import { Button } from '@/components/ui/Button';
import type { ScreenProps } from './types';

export function Screen5({ config, onNext, onBack, onDismiss, stepLabel }: ScreenProps) {
  const headline = (config?.pricing_headline as string | undefined) ?? 'Plan';
  const price = (config?.pricing_price as string | undefined) ?? '$9.99';
  const cadence = (config?.pricing_cadence as string | undefined) ?? '/month';
  return (
    <section aria-label={stepLabel} className="flex flex-col gap-6">
      <h2 className="text-xl font-bold text-[var(--color-text)]">{headline}</h2>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold numerals-tabular text-[var(--color-text)]">
          {price}
        </span>
        <span className="text-base text-[var(--color-text-secondary)]">{cadence}</span>
      </div>
      <div className="flex flex-col gap-2">
        <Button variant="primary" block onClick={onNext}>
          Next
        </Button>
        {onBack && (
          <Button variant="ghost" block onClick={onBack}>
            Back
          </Button>
        )}
        <Button variant="ghost" block onClick={onDismiss}>
          Not now — keep my trial
        </Button>
      </div>
    </section>
  );
}
