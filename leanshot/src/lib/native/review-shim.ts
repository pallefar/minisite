/**
 * Phase 36 Plan 36-02 REVIEW-01 (D-20) — v1.4 mobile-shell handoff contract.
 *
 * v1.3 ships a web no-op. The `request()` method returns `{ shown: false }`
 * synchronously on web (no Capacitor plugin is installed). v1.4 will replace
 * this file with the `@capacitor-community/in-app-review` integration:
 *
 *   import { InAppReview } from '@capacitor-community/in-app-review';
 *   export const reviewShim = {
 *     async request(): Promise<{ shown: boolean }> {
 *       const result = await InAppReview.requestReview();
 *       // OS may silently no-op per quota; we still report shown: true.
 *       return { shown: true };
 *     },
 *   };
 *
 * The hook (src/hooks/useNativeReviewTrigger.ts) does not change between
 * v1.3 and v1.4 — only this shim swaps. This is the load-bearing
 * architecture lock-in for the deferred mobile-shell phase (Phase 16
 * carry-over per CONTEXT D-20).
 *
 * V13-3 invariant: callers MUST NOT condition the `request()` invocation
 * on the user's NPS rating value. The ESLint AST rule + grep gate
 * (added in Plan 36-01) enforce this across the codebase.
 *
 * DO NOT install @capacitor-community/in-app-review in v1.3 — that
 * dependency belongs to v1.4 alongside the rest of the Capacitor stack.
 */

export const reviewShim = {
  /**
   * Request a native in-app review prompt.
   *
   * v1.3 web behaviour: returns `{ shown: false }` synchronously — no native
   * surface is available. The call site (typically `useNativeReviewTrigger`)
   * is expected to wire this UNCONDITIONALLY into trigger-event handlers;
   * the no-op makes it inert on web.
   *
   * v1.4 swap target: `@capacitor-community/in-app-review` (Capacitor plugin
   * that adapts to SKStoreReviewController on iOS and Google In-App Review
   * on Android).
   */
  async request(): Promise<{ shown: boolean }> {
    return { shown: false };
  },
};
