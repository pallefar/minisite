/**
 * PostHog cookieless analytics wrapper.
 *
 * - persistence: 'localStorage' (no cookies; D-15 distinct_id is a self-managed UUID)
 * - autocapture: false (health content in DOM is too sensitive — never captured implicitly)
 * - capture_pageview: false (we track tab_viewed manually via track())
 * - opt_out_capturing fires BEFORE identify when production-disabled (Pitfall 2)
 * - VITE_ANALYTICS_ENABLED defaults false in production until Phase 7 legal sign-off (D-13)
 */

import posthog from 'posthog-js';

/** Typed event taxonomy starter set (D-14). Other phases extend this union. */
export type EventName =
  | 'onboarding_started'
  | 'onboarding_step_completed'
  | 'onboarding_completed'
  | 'onboarding_abandoned'
  | 'tab_viewed'
  | 'disclaimer_acknowledged' // Phase 2 D-08: fires when user clicks "I understand" on Step 0 OR dashboard fallback
  | 'disclaimer_required'; // Phase 2 D-11: fires once on first dashboard render when ack !== 'v1'

const DISTINCT_ID_KEY = 'leanshot_distinct_id';

/**
 * Returns a stable UUID stored in localStorage, generating one if absent.
 * Falls back to an ephemeral UUID when localStorage throws (private-mode browsers).
 * Pattern matches src/lib/storage.ts apiKeyStorage try/catch wrapping.
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

export function initAnalytics(): void {
  const enabled = isEnabled();
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  const host =
    (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com';

  // Without a real key, posthog.init still fires /array/<key>/config and /flags
  // before loaded() runs opt_out_capturing — producing 404/401 noise. Skip entirely.
  if (!key) return;

  posthog.init(key, {
    api_host: host,
    // D-15: localStorage UUID, no PostHog-managed cookies
    persistence: 'localStorage',
    // Health content in DOM — never autocapture
    autocapture: false,
    capture_pageview: false,
    disable_surveys: true,
    loaded: (ph) => {
      // Pitfall 2: opt_out BEFORE identify so $identify network calls don't fire in production
      if (!enabled) {
        ph.opt_out_capturing();
        return;
      }
      const distinctId = getOrCreateDistinctId();
      ph.identify(distinctId);
    },
  });
}

/** Type-safe wrapper. Silently no-ops when VITE_ANALYTICS_ENABLED !== 'true'. */
export function track(
  event: EventName,
  properties?: Record<string, string | number | boolean>,
): void {
  if (!isEnabled()) return;
  posthog.capture(event, properties);
}
