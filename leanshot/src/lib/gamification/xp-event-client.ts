/**
 * Fire-and-forget client wrapper for the xp-event Edge Function.
 *
 * Phase 35 Plan 35-03 (D-05) — supplementary PostHog server-side capture.
 *
 * Called from the SPA AFTER a qualifying-action insert commits successfully
 * (inject / weight log / symptom log / workout). The DB trigger (Plan 35-03
 * Task 1) is the SOURCE OF TRUTH for XP grants; this function is supplementary
 * analytics only.
 *
 * Failure is silently logged — PostHog capture is supplementary. If the Edge
 * Fn is unreachable or returns an error, XP ledger is still correct (DB trigger
 * fired synchronously on INSERT). Never await this in a user-facing code path.
 *
 * Property allowlist (enforced server-side by xp-event Edge Fn):
 * Only 8 keys are forwarded to PostHog — see supabase/functions/xp-event/index.ts.
 * This client helper passes only safe properties to keep the call site clean.
 *
 * Plan 35-06 (LevelUpBurst component) will wire this for level_up events.
 * Plan 35-09 (notifications) can use it for streak_milestone events.
 */

import { supabase } from '@/lib/supabase';
import type { Phase35Event } from '@/lib/analytics/events';

/**
 * Fires the xp-event Edge Fn for server-side PostHog capture.
 * Returns void — never awaited by callers (fire-and-forget).
 *
 * @param event - One of the 6 Phase35Event enum values
 * @param properties - PHI-safe properties (Edge Fn enforces 8-key allowlist server-side)
 */
export function fireXpEvent(event: Phase35Event, properties: Record<string, unknown>): void {
  void supabase.functions
    .invoke('xp-event', {
      body: { event, properties },
    })
    .catch((e: unknown) => {
      // Non-blocking: PostHog capture failure does NOT affect user data integrity.
      // DB trigger (Plan 35-03 Task 1) already wrote the ledger row before this fn is called.
      console.warn('[xp-event-client] invoke failed (non-blocking)', e);
    });
}
