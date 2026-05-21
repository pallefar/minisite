/**
 * subscription-updated.ts — Handler for `customer.subscription.created` and
 * `customer.subscription.updated` events.
 *
 * Also owns the canonical `mapStripeStatusToUxTier()` function (Pitfall 6).
 * Re-exported for reuse by invoice-paid.ts and invoice-payment-failed.ts.
 *
 * Phase 29 Plan 03 — D-05: HMAC realtime broadcast on org-{hmac8}-subscriptions.
 * When subscription.metadata.clinic_id is present, broadcasts `subscription_updated`
 * on the Phase 28 HMAC channel so clinic admin billing UI reflects within 30s (SC#4).
 * Broadcast failure is caught + Sentry-logged; never re-thrown (Stripe retry safety).
 *
 * Phase 40 Plan 40-02 — D-08/D-09: pause_collection mirror + T-0 auto-resume email.
 * Extends this handler in-place (NO new case arms in index.ts per RESEARCH §Pitfall 1).
 * customer.subscription.paused/.resumed events do NOT fire for pause_collection pauses.
 */
import type Stripe from 'https://esm.sh/stripe@19?target=denonext';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import * as Sentry from '../../_shared/sentry.ts';
import { channelNameFor } from '../../_shared/realtime.ts';
// Phase 40 Plan 40-02 — pause lifecycle email (D-09, T-0 confirmation on auto-resume).
import { sendEmail } from '../../_shared/email-router.ts';

// ─── UX tier type ─────────────────────────────────────────────────────────────
type UxTier = 'free' | 'paid' | 'past_due';

/**
 * mapStripeStatusToUxTier — canonical Stripe status → UX tier collapse.
 *
 * Pitfall 6: Stripe's 8 subscription statuses collapse to 3 UX tiers.
 * The `default` branch uses a `never` exhaustiveness guard so TypeScript will
 * emit a compile error if Stripe adds a new status we haven't handled.
 */
export function mapStripeStatusToUxTier(status: Stripe.Subscription.Status): UxTier {
  switch (status) {
    case 'trialing':
    case 'active':
      return 'paid';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
      return 'free';
    default: {
      // Exhaustiveness guard — TS will error if Stripe adds a new status that is
      // not handled above. The cast to `never` triggers a compile error if the
      // switch is non-exhaustive over the known Stripe.Subscription.Status union.
      // deno-lint-ignore no-explicit-any
      const _exhaust: never = status as never;
      void _exhaust;
      return 'free';
    }
  }
}

/**
 * D-05 test spy interface — allows tests to inject a mock `channelSend` function
 * without mutating the frozen ESM namespace.
 *
 * @internal — only used by subscription-updated.test.ts
 */
export interface D05Spy {
  /** Called with the computed channel name and payload. */
  channelSend: (channelName: string, payload: Record<string, unknown>) => Promise<void>;
}

/**
 * Phase 40 Plan 40-02 test spy interface for the sendEmail call.
 * Allows tests to inject a mock sendEmail without mutating the ESM namespace.
 * @internal — only used by subscription-updated.test.ts
 */
export interface P40PauseSpy {
  /** Called with the same args as sendEmail when an auto-resume is detected. */
  sendEmail: (
    admin: SupabaseClient,
    args: Parameters<typeof sendEmail>[1],
  ) => Promise<ReturnType<typeof sendEmail>>;
}

export async function handle(
  event: Stripe.Event,
  admin: SupabaseClient,
  _d05Spy?: D05Spy,
  _p40PauseSpy?: P40PauseSpy,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const subId = subscription.id;
  const uxTier = mapStripeStatusToUxTier(subscription.status);

  // Recover user_id / clinic_id from subscription.metadata (propagated from Checkout).
  const meta = (subscription.metadata ?? {}) as Record<string, string>;

  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;
  const trialEnd = subscription.trial_end
    ? new Date(subscription.trial_end * 1000).toISOString()
    : null;
  const planId = subscription.items?.data?.[0]?.price?.id ?? null;

  // Determine user_id / clinic_id from metadata (behavior 2.13: upsert on race).
  const userId = meta.user_id ?? null;
  const clinicId = meta.clinic_id ?? null;

  // Upsert: covers both created (INSERT) and updated (UPDATE) paths.
  const { error } = await admin.from('subscriptions').upsert(
    {
      id: subId,
      provider: 'stripe',
      user_id: userId,
      clinic_id: clinicId,
      status: subscription.status,
      ux_tier: uxTier,
      plan_id: planId,
      current_period_end: currentPeriodEnd,
      trial_end: trialEnd,
      cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      metadata: { provider: 'stripe', tier_kind: meta.tier_kind ?? null },
    },
    { onConflict: 'id' },
  );

  if (error) {
    console.error('[stripe-webhook/subscription-updated] upsert error', error.message);
    throw new Error('subscription-upsert-failed');
  }

  // ─── Phase 40 Plan 40-02: pause_collection mirror + T-0 auto-resume email ─
  //
  // customer.subscription.paused / .resumed events do NOT fire for pause_collection
  // based pauses (RESEARCH §Critical Findings / §Pitfall 1). We extend here only.
  // NO new case arms added to index.ts.
  //
  // Logic:
  //  1. Extract current pause_collection from Stripe subscription object.
  //  2. Read-back previous is_paused state to detect auto-resume transition.
  //  3. UPDATE subscriptions with new mirror values.
  //  4. If auto-resume detected (wasPaused && !newIsPaused) → fire T-0 email.
  //
  // T-40-02-05: log err.message + err.code ONLY — NEVER full event payload.
  // T-40-02-07: at-most-2 T-0 emails on race (webhook + reconcile cron) — acceptable per UX.

  try {
    // Step 1: Extract pause_collection from Stripe subscription.
    const pauseCollection = (subscription as unknown as Record<string, unknown>).pause_collection as
      | { behavior: 'void' | 'mark_uncollectible' | 'keep_as_draft'; resumes_at: number | null }
      | null
      | undefined;

    const newPausedUntil = pauseCollection?.resumes_at
      ? new Date(pauseCollection.resumes_at * 1000).toISOString()
      : null;
    const newIsPaused = pauseCollection != null;

    // Step 2: Read-back previous state to detect auto-resume + get clinic_id for PHI flag.
    const { data: prev } = await admin
      .from('subscriptions')
      .select('is_paused, clinic_id, user_id')
      .eq('id', subId)
      .maybeSingle();

    const wasPaused = (prev as { is_paused?: boolean } | null)?.is_paused === true;
    // PHI flag: clinic_id IS NOT NULL → SES; else Resend. D-09.
    const subClinicId = (prev as { clinic_id?: string | null } | null)?.clinic_id ?? clinicId;
    const isPhi = subClinicId != null;

    // Step 3: UPDATE pause mirror columns.
    // reset reminded_t7=false on auto-resume so future pauses re-arm the reminder.
    const updatePayload: Record<string, unknown> = {
      paused_until: newPausedUntil,
      is_paused: newIsPaused,
    };
    if (!newIsPaused) {
      // Auto-resume path: reset dedup flag so next pause re-arms T-7d reminder.
      updatePayload.reminded_t7 = false;
    }

    const { error: updateErr } = await admin
      .from('subscriptions')
      .update(updatePayload)
      .eq('id', subId);

    if (updateErr) {
      console.error(
        '[stripe-webhook/subscription-updated] pause mirror update error',
        updateErr.message,
        updateErr.code,
      );
      // Non-fatal — do not re-throw (Stripe retries must not be triggered for mirror errors).
    }

    // Step 4: Auto-resume detection → T-0 confirmation email.
    if (wasPaused && !newIsPaused) {
      // Fetch customer email from the Stripe customer field.
      // event.data.object.customer may be a string (id) or an expanded Customer object.
      const rawCustomer = (subscription as unknown as Record<string, unknown>).customer;
      const customerEmail: string | null =
        rawCustomer && typeof rawCustomer === 'object'
          ? ((rawCustomer as Record<string, unknown>).email as string | null) ?? null
          : null;

      if (customerEmail) {
        const sendEmailFn = _p40PauseSpy?.sendEmail ?? sendEmail;
        await sendEmailFn(admin, {
          template: 'pause_resumed_t0',
          to: customerEmail,
          vars: {
            user_first_name: '',  // template falls back to 'there' when empty
            resumed_at: new Date().toISOString(),
          },
          phi: isPhi,
        });
      } else {
        // customer object is unexpanded (string ID only) — T-0 email not sent.
        // This is best-effort; the A3 reconcile cron will catch it on next sweep.
        console.warn(
          '[stripe-webhook/subscription-updated] auto-resume T-0 skipped: customer unexpanded; sub_id:',
          subId,
        );
      }
    }
  } catch (pauseErr) {
    // T-40-02-05: log err.message + err.code ONLY — NEVER full event payload.
    Sentry.captureException(pauseErr, {
      tags: { phase40_pause_mirror: 'failed', sub_id: subId },
    });
    console.error(
      '[stripe-webhook/subscription-updated] pause mirror failed',
      pauseErr instanceof Error ? pauseErr.message : 'unknown',
      (pauseErr as Record<string, unknown>)?.code ?? '',
    );
    // Do NOT re-throw — Stripe retries must not be triggered for local-mirror errors.
  }

  // ─── Phase 29 D-05: HMAC realtime broadcast ──────────────────────────────
  //
  // When this is a clinic subscription (clinic_id present in metadata), broadcast
  // `subscription_updated` on the Phase 28 HMAC channel so clinic admin billing
  // surfaces reflect within 30s (SC#4 SLA). Failure is caught and Sentry-logged;
  // NEVER re-thrown (a 500 would trigger Stripe retries amplifying the failure).

  if (!clinicId) {
    // Consumer subscription — no realtime broadcast needed.
    return;
  }

  try {
    const broadcastPayload: Record<string, unknown> = {
      subscription_id: subId,
      status: subscription.status,
      current_period_end: subscription.current_period_end ?? null,
    };

    if (_d05Spy) {
      // Test path: delegate to spy instead of live admin.channel call.
      // The channel name is computed deterministically even in tests.
      const channelName = await channelNameFor(clinicId, 'subscriptions');
      await _d05Spy.channelSend(channelName, broadcastPayload);
    } else {
      // Production path: fetch Vault secret, compute HMAC channel name, broadcast.
      const { data: secretHex, error: rpcErr } = await admin.rpc(
        'get_realtime_channel_keying',
      );
      if (rpcErr || !secretHex) {
        // Vault secret unavailable — log and skip broadcast (non-fatal).
        console.warn(
          '[stripe-webhook/subscription-updated] get_realtime_channel_keying unavailable — skipping D-05 broadcast',
          rpcErr?.message,
        );
        return;
      }
      const channelName = await channelNameFor(clinicId, 'subscriptions', secretHex as string);
      await admin.channel(channelName).send({
        type: 'broadcast',
        event: 'subscription_updated',
        payload: broadcastPayload,
      });
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { d05_broadcast: 'failed' },
    });
    // Do NOT re-throw — Stripe retries with exponential backoff would amplify a 500.
  }
}
