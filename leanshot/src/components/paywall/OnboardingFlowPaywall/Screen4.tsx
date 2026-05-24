/**
 * Phase 39 Plan 39-04 — OnboardingFlowPaywall Screen 4 (social-proof, D-14).
 */
import { Button } from '@/components/ui/Button';
import type { ScreenProps } from './types';

export function Screen4({ config, onNext, onBack, onDismiss, stepLabel }: ScreenProps) {
  const headline =
    (config?.social_proof_headline as string | undefined) ?? 'Trusted by 12,000+ patients';
  const body =
    (config?.social_proof_body as string | undefined) ??
    '"My doctor finally has a picture of what is happening between visits." — Real patient quote.';
  return (
    <section aria-label={stepLabel} className="flex flex-col gap-6">
      <h2 className="text-xl font-bold text-[var(--color-text)]">{headline}</h2>
      <p className="text-base text-[var(--color-text-secondary)]">{body}</p>
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
