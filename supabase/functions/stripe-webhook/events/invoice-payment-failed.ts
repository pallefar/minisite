/**
 * invoice-payment-failed.ts — Handler for `invoice.payment_failed` event.
 *
 * Two concerns, in strict order:
 *
 *  1. Phase 14 / D-08 banner trigger (CR-04 fix): write ux_tier='past_due' +
 *     status='past_due' unconditionally. An `invoice.payment_failed` event by
 *     definition means a charge failed and Stripe dunning has started.
 *
 *  2. Phase 65-04 / PAY-07: advance the dunning state machine in TypeScript
 *     (NOT via a Postgres RPC/trigger — keeps the transition logic testable +
 *     observable in handler logs). Per [[reference_rpc_auth_uid_vs_service_role_mismatch]]:
 *     this handler uses service_role admin client; do NOT use SECDEF RPCs that
 *     reference `auth.uid()` — service_role auth.uid() returns null.
 *
 *     Transition table (CONTEXT.md D-07):
 *       null / 'none'           → 'first_failed'
 *       'first_failed'          → 'second_failed'
 *       'second_failed'         → 'final_warning'
 *       'final_warning'         → 'final_warning'         (terminal-warning; no skip)
 *       'cancelled_for_payment' → 'cancelled_for_payment' (terminal; no further advance)
 *
 *     When the next state DIFFERS from the current state, we also write
 *     last_dunning_email_at=null so the orchestrator cron (Plan 65-05) knows
 *     the next-stage email is owed.
 *
 * `customer.subscription.updated` (subscription-updated.ts) remains the
 * authority for the retry-exhausted and recovery transitions via the real
 * `subscription.status`. The 'cancelled_for_payment' transition lives there.
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

type DunningState =
  | 'none'
  | 'first_failed'
  | 'second_failed'
  | 'final_warning'
  | 'cancelled_for_payment';

/**
 * Compute the next dunning_state from the current one.
 * Returns `null` if no transition is needed (terminal states stay put).
 */
function nextDunningState(current: string | null | undefined): DunningState | null {
  switch (current) {
    case null:
    case undefined:
    case 'none':
      return 'first_failed';
    case 'first_failed':
      return 'second_failed';
    case 'second_failed':
      return 'final_warning';
    case 'final_warning':
      return null; // terminal-warning; stay put (subscription-updated handles → cancelled_for_payment)
    case 'cancelled_for_payment':
      return null; // terminal; no further advance
    default:
      return null; // unknown state — do not advance (fail-safe)
  }
}

export async function handle(event: Stripe.Event, admin: SupabaseClient): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subId = invoice.subscription as string | null;

  if (!subId) {
    console.log('[stripe-webhook/invoice-payment-failed] no subscription_id, skipping');
    return;
  }

  // Read current dunning_state (used for state-machine transition compute).
  let currentDunningState: string | null = null;
  try {
    const { data: prev } = await admin
      .from('subscriptions')
      .select('dunning_state')
      .eq('id', subId)
      .maybeSingle();
    currentDunningState = (prev as { dunning_state?: string | null } | null)?.dunning_state ?? null;
  } catch (selectErr) {
    // Non-fatal: log + proceed with currentDunningState=null. The UPDATE below
    // is still safe; first-failed advance still applies.
    console.error(
      '[stripe-webhook/invoice-payment-failed] dunning select error',
      selectErr instanceof Error ? selectErr.message : 'unknown',
    );
  }

  const next = nextDunningState(currentDunningState);

  // Build update patch.
  const patch: Record<string, unknown> = {
    ux_tier: 'past_due',
    status: 'past_due',
  };

  if (next !== null && next !== currentDunningState) {
    patch.dunning_state = next;
    patch.last_dunning_email_at = null; // signals orchestrator: next email is owed
    console.log(
      '[stripe-webhook/invoice-payment-failed] dunning transition',
      JSON.stringify({ subId, from: currentDunningState, to: next }),
    );
  }

  const { error } = await admin.from('subscriptions').update(patch).eq('id', subId);

  if (error) {
    console.error('[stripe-webhook/invoice-payment-failed] update error', error.message);
    throw new Error('invoice-payment-failed-update-failed');
  }
}
