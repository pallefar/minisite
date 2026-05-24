/**
 * Phase 39 Plan 39-04 — PaywallGate wrapper (consumer-side base for
 * Plan 39-05 PharmaContentBlock + any other gated content surface).
 *
 * Cascade (in order):
 *   1. phaCheck(content) inside try/catch (D-06 layer 2). Never crash render
 *      even if a synthetic phaCheck failure escapes — fall through to free.
 *   2. content.safety_category non-null → render children directly (D-05
 *      safety carveout — never paywall safety info).
 *   3. consent-adapter returns false → render children directly (UI-SPEC
 *      Hard Constraint #6 cookie-consent gate).
 *   4. consent=true + non-safety → invoke variant-resolver Edge Fn (Plan 39-03)
 *      and render a paywall slot marked with data-testid="paywall-content"
 *      that downstream surfaces (PaywallModal, OnboardingFlowPaywall) wrap.
 *      On any resolver error / null variant → silently fall through to children.
 *
 * Per UI-SPEC Hard Constraint #5: NO useQuery / useMutation. All async via
 * useEffect + setState + cancellation flag (mirrors OnboardingABPanel.tsx).
 *
 * Per UI-SPEC Interaction States: NO loading state visible — paywall
 * either renders or doesn't; the render decision is the loading state.
 */
import { useEffect, useState, type ReactNode } from 'react';

import { phaCheck } from '@/lib/pharma/phaCheck';
import { getPaywallTrackingConsent } from '@/lib/paywall/consent-adapter';
import { supabase } from '@/lib/supabase';

export interface PaywallGateProps {
  content: { safety_category?: string | null; [k: string]: unknown };
  children: ReactNode;
  /** 'pharma' uses the same gate cascade but flags downstream which surface invoked. Default 'paywall'. */
  surface?: 'pharma' | 'paywall';
}

interface ResolvedVariant {
  variant_id: string;
  config: Record<string, unknown>;
}

export function PaywallGate({ content, children, surface = 'paywall' }: PaywallGateProps) {
  // Layer 1: defense-in-depth phaCheck. Wrap in try/catch — the assertion
  // is loud-in-test (throws) but the render path must never crash.
  let safetyCarveOut = false;
  try {
    phaCheck(content);
    safetyCarveOut = Boolean(content?.safety_category);
  } catch {
    // phaCheck throwing means safety_category WAS present and dev/test
    // signalled the violation. Honour the carveout regardless.
    safetyCarveOut = true;
  }

  const consentGranted = (() => {
    try {
      return getPaywallTrackingConsent();
    } catch {
      return false;
    }
  })();

  const skipPaywall = safetyCarveOut || !consentGranted;

  const [variant, setVariant] = useState<ResolvedVariant | null>(null);
  const [resolved, setResolved] = useState(skipPaywall);

  useEffect(() => {
    // Skip the resolver entirely when the gate already decided to render
    // children — avoids a wasted network round-trip and a render flicker.
    if (skipPaywall) {
      setResolved(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke<ResolvedVariant>(
          'variant-resolver',
          { body: { surface: 'paywall' } },
        );
        if (cancelled) return;
        if (error || !data || !data.variant_id) {
          setVariant(null);
        } else {
          setVariant(data);
        }
      } catch {
        if (!cancelled) setVariant(null);
      } finally {
        if (!cancelled) setResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // surface is intentionally not in deps: the gate is one-shot per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipPaywall]);

  if (skipPaywall) {
    return <>{children}</>;
  }
  if (!resolved) {
    // No loading state per UI-SPEC — render nothing until resolver answers.
    return null;
  }
  if (!variant) {
    // Resolver error or no variant → free fallback.
    return <>{children}</>;
  }
  // Paywall slot — concrete paywall UI is PaywallModal/OnboardingFlowPaywall.
  // We render a minimal marker the tests assert on; real consumers wrap
  // this gate with their own surface.
  return (
    <div data-testid="paywall-content" data-surface={surface} data-variant-id={variant.variant_id}>
      {children}
    </div>
  );
}
