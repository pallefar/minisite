/**
 * Phase 39 Plan 39-04 — OnboardingFlowPaywall Screen 3 (value-pillar-3, D-14).
 */
import { Button } from '@/components/ui/Button';
import type { ScreenProps } from './types';

export function Screen3({ config, onNext, onBack, onDismiss, stepLabel }: ScreenProps) {
  const headline =
    (config?.value_pillar_3_headline as string | undefined) ?? 'Rotate sites without thinking';
  const body =
    (config?.value_pillar_3_body as string | undefined) ??
    'Visual site map shows the next injection slot so you avoid repeated trauma.';
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
