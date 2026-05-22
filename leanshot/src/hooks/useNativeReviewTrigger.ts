/**
 * Phase 36 Plan 36-02 REVIEW-01 (D-20) — useNativeReviewTrigger hook.
 *
 * v1.3 web no-op. The hook is the integration seam between trigger-event
 * handlers (e.g. on activation_completed, level_up, streak_milestone_*) and
 * the native review prompt. In v1.3 the underlying shim returns
 * `{ shown: false }` on web; in v1.4 the same shim is swapped to call
 * `@capacitor-community/in-app-review` and the hook API does not change.
 *
 * V13-3 invariant (CONTEXT D-03/D-21): `request()` is intended to be wired
 * UNCONDITIONALLY into trigger-event handlers. The ESLint AST rule + grep
 * gate (shipped in Plan 36-01) BLOCK any call site that wraps the call in
 * a predicate referencing rating identifiers (`nps_score`, `rating`,
 * `review_state`, `is_promoter`, `is_detractor`). The web no-op makes the
 * hook inert on web regardless — vendor-policy compliance is enforced by
 * the lint rules, not by runtime predicates.
 *
 * Pure function — no React state, no useEffect; safe to call from any
 * call site (component, lib function, event handler) without violating
 * Rules of Hooks. The `use` prefix is retained because v1.4's Capacitor
 * adapter may legitimately introduce state (e.g. permission gating) and
 * we want to keep the API surface stable across the migration.
 */

import { reviewShim } from '@/lib/native/review-shim';

export function useNativeReviewTrigger(): {
  request: () => Promise<{ shown: boolean }>;
} {
  return {
    request: async (): Promise<{ shown: boolean }> => {
      // Web no-op. v1.4 replaces review-shim.ts with the Capacitor plugin.
      return reviewShim.request();
    },
  };
}
