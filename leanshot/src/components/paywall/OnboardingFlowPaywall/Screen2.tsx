/**
 * Phase 39 Plan 39-04 — OnboardingFlowPaywall Screen 2 (value-pillar-2, D-14).
 */
import { Button } from '@/components/ui/Button';
import type { ScreenProps } from './types';

export function Screen2({ config, onNext, onBack, onDismiss, stepLabel }: ScreenProps) {
  const headline =
    (config?.value_pillar_2_headline as string | undefined) ?? 'See drug-level projections';
  const body =
    (config?.value_pillar_2_body as string | undefined) ??
    '28 days past + 7 days projected — the pharmacology curve every coach asks about.';
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
