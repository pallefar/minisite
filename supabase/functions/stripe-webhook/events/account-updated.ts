/**
 * account-updated.ts — Phase 19 Plan 19-04 (AFF-03).
 *
 * Handler for the Stripe Connect `account.updated` webhook event. Mirrors
 * `acct.payouts_enabled` into `public.affiliates.stripe_payouts_enabled` so
 * Plan 19-09's monthly transfer cron can gate `transfers.create` on a single
 * boolean column rather than re-fetching from Stripe on each payout cycle
 * (RESEARCH Pitfall 7 — block transfers.create if payouts_enabled=false).
 *
 * Non-affiliate Connect accounts (e.g. future platform-owned accounts) are
 * silently ignored: the lookup-then-update path no-ops on a missing affiliate
 * row, so webhook deliveries from unrelated accounts add no DB pressure.
 *
 * Failure mode: a Postgres UPDATE error throws → stripe-webhook/index.ts
 * returns 500 → Stripe retries on its 24h curve. This is the desired behavior
 * because payouts_enabled going stale silently blocks legitimate transfers
 * (high-cost failure mode), so we'd rather Stripe replay than silently drop.
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const acct = event.data.object as Stripe.Account;
  if (!acct?.id) {
    // Malformed event — log and bail. We don't throw because Stripe would retry
    // a malformed payload indefinitely with no chance of success.
    console.error('[stripe-webhook/account-updated] missing acct.id, skipping');
    return;
  }

  // Lookup-first pattern: avoid an UPDATE that silently affects 0 rows.
  // The webhook fires for ALL Stripe Connect accounts in the platform, including
  // any future platform-owned accounts — we only care about affiliates here.
  const { data: existing, error: lookupErr } = await admin
    .from('affiliates')
    .select('id')
    .eq('stripe_connect_account_id', acct.id)
    .maybeSingle();

  if (lookupErr) {
    console.error('[stripe-webhook/account-updated] lookup error', lookupErr.message);
    throw new Error('account-updated-lookup-failed');
  }
  if (!existing) {
    // Not an affiliate's account — silent no-op.
    return;
  }

  const { error: updateErr } = await admin
    .from('affiliates')
    .update({
      stripe_payouts_enabled: acct.payouts_enabled === true,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_connect_account_id', acct.id);

  if (updateErr) {
    console.error('[stripe-webhook/account-updated] update error', updateErr.message);
    throw new Error('account-updated-affiliate-sync-failed');
  }
}
