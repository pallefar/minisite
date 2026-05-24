/**
 * Phase 39 Plan 39-04 — OnboardingFlowPaywall Screen 1 (value-pillar-1, D-14).
 *
 * Screen role: first value pillar; copy keyed by variant_config.config.
 * Presentational shell — same ScreenProps contract as Screens 2-6.
 */
import { Button } from '@/components/ui/Button';
import type { ScreenProps } from './types';

export function Screen1({ config, onNext, onDismiss, stepLabel }: ScreenProps) {
  const headline = (config?.value_pillar_1_headline as string | undefined) ?? 'Track every dose';
  const body =
    (config?.value_pillar_1_body as string | undefined) ??
    'Log injections in seconds and see your titration plotted across 35 days.';
  return (
    <section aria-label={stepLabel} className="flex flex-col gap-6">
      <h2 className="text-xl font-bold text-[var(--color-text)]">{headline}</h2>
      <p className="text-base text-[var(--color-text-secondary)]">{body}</p>
      <div className="flex flex-col gap-2">
        <Button variant="primary" block onClick={onNext}>
          Next
        </Button>
        <Button variant="ghost" block onClick={onDismiss}>
          Not now — keep my trial
        </Button>
      </div>
    </section>
  );
}
