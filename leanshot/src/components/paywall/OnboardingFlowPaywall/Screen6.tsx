/**
 * Phase 39 Plan 39-04 — OnboardingFlowPaywall Screen 6 (final-CTA, D-14).
 *
 * UI-SPEC §Typography: Screen 6 heading is the SINGLE Fraunces accent
 * moment in the phase — uses .font-display class (text-2xl font-bold).
 * All other paywall screens use Geist (default --font-sans).
 *
 * Primary CTA reads "Start subscription" per UI-SPEC copywriting contract.
 */
import { Button } from '@/components/ui/Button';
import type { ScreenProps } from './types';

export function Screen6({ config, onNext, onBack, onDismiss, stepLabel }: ScreenProps) {
  const headline =
    (config?.final_cta_headline as string | undefined) ?? 'Ready to keep going?';
  const body =
    (config?.final_cta_body as string | undefined) ??
    'Start your subscription and pick up where your trial left off — no data lost.';
  return (
    <section aria-label={stepLabel} className="flex flex-col gap-6">
      <h2
        data-testid="final-cta-heading"
        className="text-2xl font-bold font-display text-[var(--color-text)]"
      >
        {headline}
      </h2>
      <p className="text-base text-[var(--color-text-secondary)]">{body}</p>
      <div className="flex flex-col gap-2">
        <Button variant="primary" block onClick={onNext}>
          Start subscription
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
