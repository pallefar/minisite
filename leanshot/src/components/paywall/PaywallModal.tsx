/**
 * Phase 39 Plan 39-04 — PaywallModal (Surface A — single-screen mid-trial
 * paywall).
 *
 * Cascade:
 *   1. open=false → render null.
 *   2. consent=false → render null (UI-SPEC Hard Constraint #6 — silent skip).
 *   3. open=true + consent=true → invoke variant-resolver (Plan 39-03) on
 *      mount; render Modal with variant.config.headline + Start subscription
 *      primary CTA + Maybe later secondary action.
 *   4. variant-resolver returns vendor_unconfigured → soft banner per
 *      Pattern A (OnboardingABPanel mirror).
 *
 * UI-SPEC hard constraints honoured:
 *   - text-xl font-bold heading (4-size ramp, 2 weights).
 *   - --color-primary accent ONLY on primary CTA (reserved-for list item 1).
 *   - Modal primitive supplies role="dialog" + aria-modal="true".
 *   - NO useQuery/useMutation; useEffect + setState + cancellation flag.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { getPaywallTrackingConsent } from '@/lib/paywall/consent-adapter';
import { supabase } from '@/lib/supabase';

export interface PaywallModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional cohort label for analytics; not used in mount logic (resolver fetches cohort server-side). */
  cohortHint?: string;
}

interface VariantPayload {
  variant_id: string;
  config: { headline?: string; [k: string]: unknown };
}

interface VendorUnconfigured {
  error: 'vendor_unconfigured';
  service?: string;
}

type ResolverResponse = VariantPayload | VendorUnconfigured;

function isVendorUnconfigured(d: unknown): d is VendorUnconfigured {
  return (
    typeof d === 'object' &&
    d !== null &&
    (d as VendorUnconfigured).error === 'vendor_unconfigured'
  );
}

export function PaywallModal({ open, onClose }: PaywallModalProps) {
  const consent = (() => {
    try {
      return getPaywallTrackingConsent();
    } catch {
      return false;
    }
  })();

  const shouldFetch = open && consent;

  const [variant, setVariant] = useState<VariantPayload | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);

  useEffect(() => {
    if (!shouldFetch) {
      setVariant(null);
      setUnconfigured(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke<ResolverResponse>(
          'variant-resolver',
          { body: { surface: 'paywall' } },
        );
        if (cancelled) return;
        if (error) {
          setVariant(null);
          return;
        }
        if (isVendorUnconfigured(data)) {
          setUnconfigured(true);
          return;
        }
        if (data && (data as VariantPayload).variant_id) {
          setVariant(data as VariantPayload);
        }
      } catch {
        if (!cancelled) setVariant(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shouldFetch]);

  if (!open) return null;
  if (!consent) return null;

  // vendor_unconfigured soft banner (Pattern A).
  if (unconfigured) {
    return (
      <Modal open={true} onClose={onClose} title="Subscription">
        <div
          role="status"
          aria-live="polite"
          className="rounded-card border border-[var(--color-warning)] bg-[var(--color-surface-elevated)] p-4 text-base text-[var(--color-text)]"
        >
          Subscription vendor not yet configured. Please try again shortly.
        </div>
      </Modal>
    );
  }

  // Still resolving — UI-SPEC says NO loading state (silent skip).
  if (!variant) return null;

  const headline = variant.config?.headline ?? 'Start your subscription';

  return (
    <Modal open={true} onClose={onClose} title="Subscription">
      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-bold text-[var(--color-text)]">{String(headline)}</h2>
        <p className="text-base text-[var(--color-text-secondary)]">
          Keep your trial momentum going with full access to LeanShot.
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="primary" block onClick={onClose}>
            Start subscription
          </Button>
          <Button variant="ghost" block onClick={onClose}>
            Maybe later
          </Button>
        </div>
      </div>
    </Modal>
  );
}
