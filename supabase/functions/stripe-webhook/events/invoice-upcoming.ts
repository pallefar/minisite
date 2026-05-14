/**
 * invoice-upcoming.ts — STUB handler for `invoice.upcoming` event.
 *
 * STUB — full implementation lands in plan 14-07.
 * Plan 14-07 will populate this with meter-event emission for clinic
 * tier metered overage per RESEARCH §"Billing Meters" + Pitfall 9
 * (35-day timestamp window). Leaving as no-op so the Task 1 dispatcher
 * does not 500 on this event type between Wave 2 and Wave 4.
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function handle(event: Stripe.Event, _admin: SupabaseClient): Promise<void> {
  console.log('[invoice-upcoming] received', event.id, '— stub; 14-07 wires meter events');
}
