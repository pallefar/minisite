/**
 * Phase 35 Plan 35-03 — Client-side XP event dispatcher.
 *
 * Fires XP-related analytics events via the xp-event Edge Function (D-05:
 * server-side PostHog capture). The browser-side capture is supplementary;
 * the xp_ledger is the source of truth.
 *
 * NOTE: This stub is scaffolded by Plan 35-06 to unblock sibling-wave compilation.
 * Plan 35-03 owns the Deno test (VALIDATION row 35-03-03).
 */

export type XpEventKind = 'xp_earned' | 'level_up' | 'streak_milestone' | 'freeze_token_granted' | 'challenge_completed' | 'badge_unlocked';

/**
 * Fire an XP analytics event (best-effort; never throws).
 * Uses the xp-event Edge Function for server-side PostHog capture (D-05).
 */
export function fireXpEvent(kind: XpEventKind, properties: Record<string, unknown>): void {
  try {
    // Dynamic import keeps the Edge Function URL + supabase-js off the entry chunk.
    void import('@/lib/supabase').then(({ supabase }) => {
      void supabase.functions
        .invoke('xp-event', { body: { event: kind, properties } })
        .catch((e: unknown) => {
          console.warn('[xp-event-client] dispatch failed', e);
        });
    });
  } catch (e) {
    console.warn('[xp-event-client] fireXpEvent failed', e);
  }
}
