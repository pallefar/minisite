/**
 * Phase 41 plan 41-01 — canonical consent-change event contract.
 *
 * Purpose: Single source of truth for the `leanshot:consent-change` CustomEvent
 * emitted by the Phase 22 vanilla-cookieconsent banner (see
 * `src/components/consent/consent-config.ts`). Downstream subscribers:
 *   - Plan 41-05 `ConsentGatedEmbed` HOC (React useEffect subscription)
 *   - Plan 41-03 Deno renderer emits the SAME literal in inline JS for
 *     server-rendered marketing pages — DO NOT change the literal value of
 *     `CONSENT_CHANGE_EVENT` without coordinating both sites.
 *
 * Framework-agnostic: no React imports — this module is also consumed by the
 * inline JS string template in Plan 41-03 Deno Edge Fn. Browser globals only
 * (`window`, `CustomEvent`, `addEventListener`).
 *
 * SSR safety: `typeof window === 'undefined'` guard returns a no-op cleanup,
 * mirroring the Phase 22 `consent-defer.ts` pattern even though the v1 SPA is
 * client-only per CLAUDE.md.
 */

export const CONSENT_CHANGE_EVENT = 'leanshot:consent-change';

export interface ConsentChangeDetail {
  categories: {
    /** Always `true` — read for symmetry with the other four. */
    necessary: boolean;
    analytics: boolean;
    marketing: boolean;
    personalization: boolean;
    /**
     * Mapped from `CookieConsent.acceptedCategory('necessary')` per RESEARCH
     * §Code Examples — functional category is implicit (no separate consent
     * toggle) so we expose its always-`true` value for subscriber symmetry.
     */
    functional: boolean;
  };
}

/**
 * Subscribe to the canonical `leanshot:consent-change` CustomEvent.
 *
 * Returns an unsubscribe closure suitable for React `useEffect` cleanup. The
 * closure is idempotent — calling it multiple times is safe (subsequent calls
 * are no-ops because `removeEventListener` silently ignores already-removed
 * listeners).
 *
 * SSR/non-browser environments receive a no-op cleanup; the handler will
 * never fire because no banner is mounted.
 */
export function subscribeToConsentChange(
  handler: (detail: ConsentChangeDetail) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {
      /* no-op cleanup for SSR / non-browser environments */
    };
  }
  const listener = (event: Event): void => {
    // CustomEvent generic narrows `detail`; the cast is the typed contract
    // emitters MUST honor (consent-config.ts emits the same payload shape).
    const detail = (event as CustomEvent<ConsentChangeDetail>).detail;
    handler(detail);
  };
  window.addEventListener(CONSENT_CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener(CONSENT_CHANGE_EVENT, listener);
  };
}
