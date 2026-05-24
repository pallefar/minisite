/**
 * Phase 47 Plan 10 (EVENT-02) — typed RPC wrapper for `event_rsvp_create`.
 *
 * The SECDEF RPC is shipped by 47-02; this wrapper applies error mapping for
 * the documented SQLSTATE codes per the plan's threat model (T-47-40):
 *
 *   42501 — auth.uid() is null OR caller lacks tier (RAISE EXCEPTION SQLSTATE)
 *   22023 — caller-supplied `status` outside of {'going','maybe','not_going'}
 *           (TypeScript `Exclude<RsvpStatus, 'waitlist'>` makes this
 *           unreachable from typed callers, but the mapping is here as a
 *           defensive belt — a stale client bundle could still hit it.)
 *   P0002 — no matching event row (event was deleted between page-load and click)
 *
 * The RPC returns `{ status, waitlist_position }` — server may promote a
 * 'going' request to 'waitlist' when capacity is exceeded; the consumer UI
 * (RsvpPills) renders the returned `status` rather than the requested one.
 */
import { supabase } from '@/lib/supabase';
import type { RsvpStatus } from './event-types';

export interface CreateRsvpResult {
  status: RsvpStatus;
  waitlist_position: number | null;
}

export async function createRsvp(
  event_id: string,
  status: Exclude<RsvpStatus, 'waitlist'>,
): Promise<CreateRsvpResult> {
  const { data, error } = await supabase.rpc('event_rsvp_create', {
    p_event_id: event_id,
    p_status: status,
  });
  if (error) {
    if (error.code === '42501') throw new Error('auth_required');
    if (error.code === '22023') throw new Error('invalid_status');
    if (error.code === 'P0002') throw new Error('event_not_found');
    throw error;
  }
  return data as CreateRsvpResult;
}
