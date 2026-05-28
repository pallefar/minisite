/**
 * Phase 39 Plan 39-04 — OnboardingFlowPaywall container (Surface B,
 * 6-screen mid-trial paywall).
 *
 * Fixed-order 6-screen template per D-14:
 *   value-pillar-1 / value-pillar-2 / value-pillar-3 / social-proof /
 *   pricing / final-CTA.
 *
 * Cascade:
 *   1. open=false → render null.
 *   2. consent=false → render null (UI-SPEC Hard Constraint #6).
 *   3. consent=true → invoke variant-resolver on mount; render 6-screen
 *      flow using the resolved config payload for per-screen copy.
 *
 * Dismiss flow uses inline Card (NOT Modal-on-Modal) per UI-SPEC copy table:
 *   "Skip the rest of your trial preview? You can re-open this from Settings."
 *   Buttons: "Keep watching" (primary) / "Yes, skip" (ghost).
 *
 * Accessibility:
 *   - sr-only `<p>Step N of 6</p>`.
 *   - Visual 6-dot row marked aria-hidden="true".
 *   - Active dot uses --color-primary (reserved-for list item 3).
 *
 * UI-SPEC Hard Constraints honoured:
 *   - text-sm / text-base / text-xl / text-2xl only.
 *   - font-normal / font-bold only.
 *   - Accent only on primary CTA + active progress dot.
 *   - NO useQuery/useMutation; useEffect + setState + cancellation flag.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/helpers';
import { getPaywallTrackingConsent } from '@/lib/paywall/consent-adapter';
import { supabase } from '@/lib/supabase';
import { Screen1 } from './Screen1';
import { Screen2 } from './Screen2';
import { Screen3 } from './Screen3';
import { Screen4 } from './Screen4';
import { Screen5 } from './Screen5';
import { Screen6 } from './Screen6';

// D-14: SCREENS fixed at exactly 6 in this order. Plan verify gates the
// presence of this literal declaration via grep -c "^const SCREENS =
// \['value-pillar-1'" so the literal MUST start at column 0 unchanged.
const SCREENS = [
  'value-pillar-1',
  'value-pillar-2',
  'value-pillar-3',
  'social-proof',
  'pricing',
  'final-CTA',
] as const;
export { SCREENS };
export type ScreenKey = (typeof SCREENS)[number];

export interface OnboardingFlowPaywallProps {
  open: boolean;
  onClose: () => void;
}

interface VariantPayload {
  variant_id: string;
  config: Record<string, unknown>;
}

const SCREEN_COMPONENTS = [Screen1, Screen2, Screen3, Screen4, Screen5, Screen6];

export function OnboardingFlowPaywall({ open, onClose }: OnboardingFlowPaywallProps) {
  const consent = (() => {
    try {
      return getPaywallTrackingConsent();
    } catch {
      return false;
    }
  })();

  const shouldFetch = open && consent;

  const [variant, setVariant] = useState<VariantPayload | null>(null);
  const [step, setStep] = useState(0);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (!shouldFetch) {
      setVariant(null);
      setStep(0);
      setDismissing(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke<VariantPayload>(
          'variant-resolver',
          { body: { surface: 'paywall' } },
        );
        if (cancelled) return;
        if (error || !data) {
          // Render with empty config — defaults in each Screen kick in.
          setVariant({ variant_id: 'control', config: {} });
          return;
        }
        setVariant(data);
      } catch {
        if (!cancelled) setVariant({ variant_id: 'control', config: {} });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shouldFetch]);

  if (!open) return null;
  if (!consent) return null;
  if (!variant) return null;

  const ScreenComponent = SCREEN_COMPONENTS[step] ?? Screen1;
  const stepLabel = `Step ${step + 1} of 6`;

  function handleNext(): void {
    if (step >= SCREENS.length - 1) {
      // Final-CTA pressed — close. Real conversion handled downstream.
      onClose();
      return;
    }
    setStep((s) => s + 1);
  }
  function handleBack(): void {
    setStep((s) => Math.max(0, s - 1));
  }
  function handleDismissRequest(): void {
    setDismissing(true);
  }
  function handleKeepWatching(): void {
    setDismissing(false);
  }
  function handleConfirmDismiss(): void {
    setDismissing(false);
    onClose();
  }

  return (
    <Modal open={true} onClose={onClose} title="Subscription">
      <div className="flex flex-col gap-6">
        {/* Progress: sr-only verbal + visual 6-dot row (aria-hidden). */}
        <p className="sr-only">{stepLabel}</p>
        <div
          aria-hidden="true"
          data-testid="paywall-progress-dots"
          className="flex gap-2 justify-center"
        >
          {SCREENS.map((key, i) => (
            <span
              key={key}
              data-dot={key}
              className={cn(
                'h-2 w-2 rounded-pill',
                i === step
                  ? 'bg-[var(--color-primary)]'
                  : 'bg-[var(--color-text-tertiary)] opacity-30',
              )}
            />
          ))}
        </div>

        {dismissing ? (
          <Card variant="flat" padding="md" data-testid="dismiss-confirm-card">
            <h3 className="text-xl font-bold text-[var(--color-text)]">
              Skip the rest of your trial preview?
            </h3>
            <p className="mt-4 text-base text-[var(--color-text-secondary)]">
              You can re-open this from Settings.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Button variant="primary" block onClick={handleKeepWatching}>
                Keep watching
              </Button>
              <Button variant="ghost" block onClick={handleConfirmDismiss}>
                Yes, skip
              </Button>
            </div>
          </Card>
        ) : (
          <ScreenComponent
            config={variant.config}
            onNext={handleNext}
            onBack={step > 0 ? handleBack : undefined}
            onDismiss={handleDismissRequest}
            stepLabel={stepLabel}
          />
        )}
      </div>
    </Modal>
  );
}
