// Phase 47-08 — PHI flag derivation helper.
//
// Per CONTEXT D-04 + RESEARCH Pitfall 6: every event-related email send needs a
// `phi: boolean` flag so `_shared/email-router.ts` can branch Resend (non-PHI)
// vs SES (HIPAA BAA boundary). The flag derives from `community_spaces.org_id`:
//
//   org_id IS NOT NULL → clinic-private space → events.title + participant
//     identity are PHI → MUST route through SES (BAA in place).
//   org_id IS NULL     → global tier-gated space → non-PHI → Resend is fine.
//
// `select_event_reminder_targets()` projects `phi` per row directly, so the
// hourly fan-out Fn does NOT call this helper — it forwards the RPC's value.
// This helper exists for downstream event Fns (event-recording, event-share,
// future event-cancel-notify etc.) that operate on a single event_id and need
// the same derivation without round-tripping through the SECDEF RPC.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * Resolve the PHI flag for a single event by JOINing through community_spaces.
 *
 * @param admin     service-role-scoped SupabaseClient (bypasses RLS).
 * @param event_id  events.id to inspect.
 * @returns         true if the parent space is org-scoped (PHI); false otherwise.
 *                  Defaults to false when the event is not found (no PHI to leak;
 *                  caller should treat an unknown event as a no-op upstream).
 */
export async function getEventPhiFlag(
  admin: SupabaseClient,
  event_id: string,
): Promise<boolean> {
  const { data } = await admin
    .from('events')
    .select('community_spaces:community_spaces!inner(org_id)')
    .eq('id', event_id)
    .maybeSingle();
  const orgId = (data as { community_spaces?: { org_id?: string | null } } | null)
    ?.community_spaces?.org_id ?? null;
  return orgId !== null;
}
