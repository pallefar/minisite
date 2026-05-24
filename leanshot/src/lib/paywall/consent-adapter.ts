/**
 * Phase 39 Plan 39-04 — consent-adapter shim (RESEARCH OQ-2 resolution).
 *
 * Phase 22 vanilla-cookieconsent v3 owns the cookie banner + consent state.
 * Its read-side API is `CookieConsent.acceptedCategory(category: string)`
 * (see src/components/consent/consent-config.ts lines 119-123). Paywall
 * surfaces in Phase 39 must NOT couple to that shape directly — if Phase 22
 * ever swaps libraries the paywall would break.
 *
 * This shim exposes ONE boolean — `getPaywallTrackingConsent()` — that
 * Paywall surfaces (PaywallModal, OnboardingFlowPaywall, PaywallGate) use
 * as the cookie-consent mount-gate per UI-SPEC Hard Constraint #6. The
 * mapping rule: paywall tracking is allowed when (and only when) the
 * `analytics` category is explicitly accepted.
 *
 * Defensive:
 *   - Library may not be loaded yet (Phase 22 idle-deferred import) — wrap
 *     the call in try/catch and return false (privacy-default).
 *   - Library may return non-boolean — coerce strictly: `result === true`.
 *   - Library may throw — swallow and return false.
 */
import { acceptedCategory } from 'vanilla-cookieconsent';

export function getPaywallTrackingConsent(): boolean {
  try {
    const result = acceptedCategory('analytics');
    return result === true;
  } catch {
    return false;
  }
}
