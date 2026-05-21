/**
 * Phase 40 Plan 40-07 — Cross-cutting typed errors.
 *
 * This module is the future home for cross-cutting typed errors that need to
 * be distinguishable from generic `Error` at call-sites. Pattern mirrors the
 * `RateLimitedError` / `AIUnavailableError` classes in `src/lib/ai.ts:46-58`
 * (extends Error, sets .name, exports the class). Existing ai.ts errors stay
 * where they are — no breaking move.
 *
 * Exports:
 *   - PausedSubscriptionError — thrown by logging-action guards when the
 *     user's subscription is paused (D-07). Carries `paused_until` so
 *     callers can render the resume date in error toasts without re-querying
 *     the store.
 */

/**
 * Thrown by any guarded logging action when the user's subscription is paused.
 *
 * D-07 contract: callers MUST distinguish this from other validation failures
 * (e.g. network errors, validation errors) so the UX can surface the correct
 * recovery affordance ("Resume now?" CTA) rather than a generic error toast.
 *
 * `paused_until` mirrors the `subscriptions.paused_until` ISO timestamp.
 * It is `null` when the subscription is paused but the resume date is unknown
 * (defensive: should not occur in normal flow when `is_paused=true`).
 */
export class PausedSubscriptionError extends Error {
  public readonly paused_until: string | null;

  constructor(paused_until: string | null) {
    super('Subscription is paused; logging disabled until resume.');
    this.name = 'PausedSubscriptionError';
    this.paused_until = paused_until;
    // Maintains proper prototype chain across transpilation targets.
    Object.setPrototypeOf(this, PausedSubscriptionError.prototype);
  }
}
