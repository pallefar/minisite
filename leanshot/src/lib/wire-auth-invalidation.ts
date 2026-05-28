/**
 * Phase 28 Plan 28-05 Task 3 — USER_UPDATED auth event invalidation helper.
 *
 * Extracted from main.tsx into its own module for testability.
 * Called once in main.tsx between hydrate() and createRoot.render().
 *
 * Behaviour per CONTEXT D-02:
 *   - On USER_UPDATED: set currentOrgLoading=true so Plan 06 RouteOrgGuard
 *     re-resolves the org from path + member fallback on next render cycle.
 *   - Other events are ignored — SIGNED_IN/OUT are handled by App.tsx's
 *     onAuthStateChange subscriber (Phase 5 pattern; adding a second listener
 *     here would duplicate sync work per Phase 24 Plan 24-04 guidance).
 *
 * T-28-05-02 (stale role after membership change) mitigation:
 *   USER_UPDATED fires when Supabase refreshes the JWT, including after
 *   `auth.admin.updateUserById` is called by the Custom Access Token Hook
 *   (A3 — JWT claim propagation). Setting currentOrgLoading=true gates
 *   the D-10 spinner until RouteOrgGuard re-resolves the freshly-minted JWT.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { useStore } from './store';

/**
 * Register the USER_UPDATED invalidation listener on the given Supabase client.
 *
 * @param supabaseClient - The supabase-js client singleton (or a mock in tests).
 * @returns The unsubscribe function from onAuthStateChange (for cleanup if needed).
 */
export function wireAuthInvalidation(supabaseClient: Pick<SupabaseClient, 'auth'>): () => void {
  const { data } = supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'USER_UPDATED') {
      // Invalidate the org slice — Plan 06 RouteOrgGuard will re-resolve.
      // This covers T-28-05-02: stale role after admin removed from org mid-session.
      useStore.getState().setCurrentOrgLoading(true);
    }
    // Other events (SIGNED_IN, SIGNED_OUT, INITIAL_SESSION, TOKEN_REFRESHED)
    // are handled by App.tsx's onAuthStateChange subscriber.
  });

  return () => data.subscription.unsubscribe();
}
