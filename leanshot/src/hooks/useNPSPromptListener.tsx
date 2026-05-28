/**
 * Phase 36 Plan 36-03 Task 3 (W4) — analytics-trigger-bus subscriber +
 * decideNpsTrigger caller + NPSPromptListenerHost.
 *
 * Subscribes to the W4 in-app analytics bus (`leanshot:analytics-event`) and,
 * on admissible event fire, calls BOTH `decideNpsTrigger(eventName)` AND
 * `useNativeReviewTrigger().request()` IN PARALLEL — unconditionally per
 * CONTEXT D-17 + D-20. This is the SINGLE point of architecture lock-in for
 * V13-3: v1.4 will swap the native-review backing shim to Capacitor without
 * changing THIS file.
 *
 * D-20 invariant (asserted by ESLint AST rule no-conditional-native-review
 * + the project-level grep gate scripts/check-no-conditional-native-review.sh):
 *   - .request() must NOT be wrapped in any predicate that references rating
 *     / nps_score / review_state / is_promoter / is_detractor identifiers.
 *   - The eligibility gate is server-side (the Edge Fn enforces cap +
 *     cooldown + lifetime); the hook simply fires the trigger on each
 *     admissible event without any client-side cohort branching.
 *
 * NPSPromptListenerHost is co-located in this file so App.tsx can lazy-load
 * a single module with the entire listener + modal-switch graph hanging off
 * it.
 *
 * Modal swap rules:
 *   - decision === null OR decision.fire === false → render nothing.
 *   - decision.fire === true && rating === null → NPSPromptModal (Surface A).
 *   - rating >= 4 → PromoterCtaModal (Surface B) with embedded cta_set (W9).
 *   - rating in [1..3] → DetractorFeedbackModal (Surface C).
 *
 * The host renders all three modal components inline; they are NOT lazy
 * inside the host (the host itself is the lazy boundary mounted from App.tsx).
 * Splitting further inside the host would add Suspense complexity without
 * meaningful bundle benefit — once the user has triggered any modal, the
 * other two are already needed for the rating-driven swap.
 */

import { useCallback, useEffect, useState } from 'react';
import { DetractorFeedbackModal } from '@/components/nps/DetractorFeedbackModal';
import { NPSPromptModal } from '@/components/nps/NPSPromptModal';
import { PromoterCtaModal } from '@/components/nps/PromoterCtaModal';
import { useNativeReviewTrigger } from '@/hooks/useNativeReviewTrigger';
import { EVENTS } from '@/lib/analytics/events';
import { ANALYTICS_TRIGGER_EVENT, isAnalyticsTriggerDetail } from '@/lib/nps/analytics-trigger-bus';
import { decideNpsTrigger, type DecideResponse } from '@/lib/nps/decide-client';

type EventsRegistry = Record<string, { nps_trigger_eligible?: true } | undefined>;

export interface UseNPSPromptListenerResult {
  decision: DecideResponse | null;
  rating: number | null;
  setRating: (n: number) => void;
  reset: () => void;
}

export function useNPSPromptListener(): UseNPSPromptListenerResult {
  const [decision, setDecision] = useState<DecideResponse | null>(null);
  const [rating, setRatingState] = useState<number | null>(null);
  // Stable reference for the unconditional native-review trigger surface.
  // The hook returns the same `{ request }` shape regardless of platform —
  // v1.3 web no-op, v1.4 Capacitor InAppReview.
  const native = useNativeReviewTrigger();

  useEffect(() => {
    const onTrigger = (e: Event): void => {
      const ev = e as CustomEvent<unknown>;
      if (!isAnalyticsTriggerDetail(ev.detail)) return;
      const eventName = ev.detail.name;
      const def = (EVENTS as EventsRegistry)[eventName];
      if (def?.nps_trigger_eligible !== true) return;

      // D-17 + D-20 UNCONDITIONAL: fire BOTH paths in parallel on EVERY
      // admissible event. No rating predicate, no cohort branch — server
      // owns cap + cooldown + lifetime gating. The native trigger is a
      // web no-op in v1.3; v1.4 swaps to Capacitor InAppReview.
      void native.request();
      void decideNpsTrigger(eventName)
        .then((d) => {
          setDecision(d);
        })
        .catch(() => {
          /* fail-soft — server outage should not crash the SPA */
        });
    };
    window.addEventListener(ANALYTICS_TRIGGER_EVENT, onTrigger);
    return () => window.removeEventListener(ANALYTICS_TRIGGER_EVENT, onTrigger);
  }, [native]);

  const setRating = useCallback((n: number): void => {
    setRatingState(n);
  }, []);

  const reset = useCallback((): void => {
    setDecision(null);
    setRatingState(null);
  }, []);

  return { decision, rating, setRating, reset };
}

/**
 * App-level host: subscribes via useNPSPromptListener and renders the
 * appropriate modal based on decision + rating state. Mounted by App.tsx
 * inside the authenticated dashboard branch (NOT in marketing / onboarding).
 *
 * Rendered modals always receive `open={true}` once mounted — the parent
 * controls the mounted lifecycle via the listener state (no flicker on close).
 */
export function NPSPromptListenerHost(): React.ReactElement | null {
  const { decision, rating, setRating, reset } = useNPSPromptListener();

  if (!decision || decision.fire !== true) return null;

  // Step 1 — show the 5-star prompt while no rating chosen.
  if (rating === null) {
    return (
      <NPSPromptModal
        open
        copyVariant={decision.copy_variant}
        onRate={(value) => setRating(value)}
        onDismiss={reset}
      />
    );
  }

  // Step 2 — promoter branch (4-5★) → external CTA opt-in (W9 cta_set).
  if (rating >= 4) {
    return <PromoterCtaModal open ctaSet={decision.cta_set} onDismiss={reset} />;
  }

  // Step 3 — non-promoter branch (1-3★) → open-text feedback → ticket.
  return <DetractorFeedbackModal open onDismiss={reset} />;
}

export default NPSPromptListenerHost;
