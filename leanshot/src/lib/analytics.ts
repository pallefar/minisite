/**
 * PostHog cookieless analytics wrapper.
 *
 * - persistence: 'localStorage' (no cookies; D-15 distinct_id is a self-managed UUID)
 * - autocapture: false (health content in DOM is too sensitive — never captured implicitly)
 * - capture_pageview: false (we track tab_viewed manually via track())
 * - opt_out_capturing fires BEFORE identify when production-disabled (Pitfall 2)
 * - VITE_ANALYTICS_ENABLED defaults false in production until Phase 7 legal sign-off (D-13)
 *
 * Phase 2.1 perf fix: posthog-js is imported DYNAMICALLY inside `initAnalytics()`
 * and `track()` (was a top-level static import — Phase 2). The static import
 * dragged posthog-js (61 kB gz) into the entry static graph, contributing to
 * `vendor-telemetry` becoming auto-preloaded on cold load. With dynamic
 * imports the chunk only fetches when init/track is actually called, which
 * `main.tsx` schedules via `deferAnalyticsInit` after first paint.
 *
 * `track()` calls fired BEFORE init complete are queued in `pendingTrackQueue`
 * and drained inside the loaded() callback (Pitfall 4 mitigation: don't lose
 * `disclaimer_acknowledged` events that fire during onboarding's first paint).
 */

// Phase 50 D-34 / HIPAA-17: re-export the session-recording deny-list regex from
// its single source of truth so global PostHog init (this module) and any
// downstream consumer read the same pattern.
export { DISABLE_RECORDING_URL_REGEX } from './posthog/disable-recording-regex';

/** Typed event taxonomy starter set (D-14). Other phases extend this union. */
export type EventName =
  | 'onboarding_started'
  | 'onboarding_step_completed'
  | 'onboarding_completed'
  | 'onboarding_abandoned'
  | 'tab_viewed'
  | 'disclaimer_acknowledged' // Phase 2 D-08: fires when user clicks "I understand" on Step 0 OR dashboard fallback
  | 'disclaimer_required' // Phase 2 D-11: fires once on first dashboard render when ack !== 'v1'
  // Phase 37 Plan 06 — helpdesk widget (HELP-02/07/09/10/11). Length-only payloads;
  // raw subject/body/query strings MUST NOT be sent to PostHog (T-37-06-03 mitigation).
  | 'helpdesk.widget.opened'
  | 'helpdesk.kb_article.viewed'
  | 'helpdesk.kb_search.performed'
  | 'helpdesk.ticket.created'
  | 'helpdesk.ticket.replied'
  // Phase 40 Plan 40-04 (POLISH-01) — Cancellation save-offers flow.
  // reason_other_text MUST NOT be sent to PostHog (T-40-04-01 PII mitigation).
  | 'cancellation_started'
  | 'cancellation_reason_picked'
  | 'save_offer_shown'
  | 'save_offer_accepted'
  | 'save_offer_declined'
  | 'cancellation_dismissed'
  | 'cancellation_aborted'
  | 'cancellation_completed'
  | 'subscription_paused'
  | 'subscription_resumed';

const DISTINCT_ID_KEY = 'leanshot_distinct_id';

/**
 * Returns a stable UUID stored in localStorage, generating one if absent.
 * Falls back to an ephemeral UUID when localStorage throws (private-mode browsers).
 * Pattern matches the historical storage.ts try/catch helper wrapping (S-3).
 *
 * Exported for testability — production callers should not depend on this directly.
 */
export function getOrCreateDistinctId(): string {
  try {
    const existing = localStorage.getItem(DISTINCT_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(DISTINCT_ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** Read the analytics-enabled flag from build-time env. Defaults false. */
function isEnabled(): boolean {
  return import.meta.env.VITE_ANALYTICS_ENABLED === 'true';
}

// Pre-init queue for `track()` calls that fire before posthog-js finishes loading.
// Drained inside the dynamic-import loaded() callback so events fired during
// onboarding's first paint (e.g. disclaimer_acknowledged) aren't lost.
type QueuedEvent = { event: EventName; properties?: Record<string, string | number | boolean> };
const pendingTrackQueue: QueuedEvent[] = [];
// Captured from inside loaded() — typed as the same shape PostHog passes there.
// We only call .capture() on it, so any minimal subset that includes that method is fine.
type PostHogCaptureLike = {
  capture: (event: string, properties?: Record<string, string | number | boolean>) => void;
};
let posthogInstance: PostHogCaptureLike | null = null;
let initStarted = false;

export function initAnalytics(): void {
  if (initStarted) return;
  initStarted = true;

  const enabled = isEnabled();
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  const host =
    (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com';

  // Without a real key, posthog.init still fires /array/<key>/config and /flags
  // before loaded() runs opt_out_capturing — producing 404/401 noise. Skip entirely.
  if (!key) {
    pendingTrackQueue.length = 0; // drop any queued events; nowhere to send them
    return;
  }

  // Phase 25 D-04 + HIPAA-17: session_recording disabled by default;
  // useSessionReplayPhiGuard() in src/lib/posthog-route-disable.ts
  // re-enables only on non-PHI routes via posthog.startSessionRecording().
  void import('posthog-js').then(({ default: posthog }) => {
    posthog.init(key, {
      api_host: host,
      // D-15: localStorage UUID, no PostHog-managed cookies
      persistence: 'localStorage',
      // Health content in DOM — never autocapture
      autocapture: false,
      capture_pageview: false,
      disable_surveys: true,
      // HIPAA-17: global default disables session recording; the route-change
      // hook (src/lib/posthog-route-disable.ts) calls startSessionRecording()
      // only when the current synthetic route is NOT in the PHI deny-list.
      // NOTE: `disable_session_recording_on_url` does NOT exist in posthog-js
      // (RESEARCH correction #1) — programmatic start/stop is the correct API.
      disable_session_recording: true,
      loaded: (ph) => {
        // Pitfall 2: opt_out BEFORE identify so $identify network calls don't fire in production
        if (!enabled) {
          ph.opt_out_capturing();
          pendingTrackQueue.length = 0;
          return;
        }
        const distinctId = getOrCreateDistinctId();
        ph.identify(distinctId);
        posthogInstance = ph;
        // Drain any track() calls that fired between deferAnalyticsInit() and loaded()
        for (const queued of pendingTrackQueue) {
          ph.capture(queued.event, queued.properties);
        }
        pendingTrackQueue.length = 0;
      },
    });
  });
}

/** Type-safe wrapper. Silently no-ops when VITE_ANALYTICS_ENABLED !== 'true'. */
export function track(
  event: EventName,
  properties?: Record<string, string | number | boolean>,
): void {
  if (!isEnabled()) return;
  if (posthogInstance) {
    posthogInstance.capture(event, properties);
    return;
  }
  // Pre-init: queue. Drained inside loaded() callback above.
  pendingTrackQueue.push({ event, properties });
}
