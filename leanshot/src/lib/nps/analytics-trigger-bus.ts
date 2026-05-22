/**
 * Phase 36 Plan 36-03 Task 3 (W4) — single source of truth for in-app
 * analytics event broadcast.
 *
 * Subscribed by `useNPSPromptListener` to decide when to fire the NPS prompt.
 * Future event-driven UI surfaces (achievement toasts, milestone nudges, etc.)
 * may also subscribe — keeping ONE channel makes the contract testable end-
 * to-end (see useNPSPromptListener.test.ts).
 *
 * W4 lock-in: this is the LOCKED bus mechanism for analytics-driven in-app
 * triggers — there is no Zustand subscription fork, no event-emitter library
 * import, no TBD path resolution at execute time. The file lives in
 * `src/lib/nps/` alongside `quarterly-modal.ts` for cohesion with the other
 * NPS-family trigger bus (which uses the same window CustomEvent pattern).
 *
 * The dispatcher is invoked from `src/lib/analytics.ts track()` AFTER PostHog
 * capture. It fires regardless of analytics-upload enablement — the in-app
 * bus is a separate concern from the PostHog upload gate.
 */

/** Window CustomEvent name carrying analytics broadcasts. */
export const ANALYTICS_TRIGGER_EVENT = 'leanshot:analytics-event';

/** Detail shape attached to ANALYTICS_TRIGGER_EVENT CustomEvents. */
export interface AnalyticsTriggerDetail {
  /** Matches an entry key in the EVENTS registry (src/lib/analytics/events.ts). */
  name: string;
  /** Per-event payload. The bus does not validate against the registry's zod schema. */
  properties?: Record<string, string | number | boolean>;
}

/**
 * Type guard for the CustomEvent detail — exported so subscribers can
 * validate without duplicating the predicate.
 */
export function isAnalyticsTriggerDetail(
  detail: unknown,
): detail is AnalyticsTriggerDetail {
  if (!detail || typeof detail !== 'object') return false;
  const d = detail as { name?: unknown };
  return typeof d.name === 'string' && d.name.length > 0;
}

/**
 * Broadcast an analytics event on the in-app bus. Fail-soft: SSR contexts
 * (none in this SPA) and locked-down iframes can throw — never re-throw to
 * the caller (`track()` would lose the PostHog capture path otherwise).
 */
export function dispatchAnalyticsTrigger(detail: AnalyticsTriggerDetail): void {
  try {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent<AnalyticsTriggerDetail>(ANALYTICS_TRIGGER_EVENT, {
        detail,
      }),
    );
  } catch {
    /* fail-soft */
  }
}
