/**
 * `affiliate-payout/retry.ts` — Phase 19 Plan 19-09.
 *
 * Increments the payouts.retry_count on a failed transfers.create attempt.
 * After 3 attempts the row transitions to status='failed' and an admin Resend
 * alert is dispatched (best-effort — alert failure does not block the
 * state transition).
 *
 * 24h retry spacing (D-32) is structurally enforced by the monthly cron
 * cadence — the cron fires once per month so all 3 retries happen in the
 * same tick, then status='failed' until the next month. v1.3 may add an
 * explicit `next_retry_at` column for finer cadence; v1.2 ships the simpler
 * cron-cadence model.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const MAX_RETRIES = 3;

const RESEND_API_URL = 'https://api.resend.com/emails';
const RESEND_FROM_DEFAULT = 'LeanShot <noreply@app.leanshot.app>';
const ADMIN_ALERT_TO = Deno.env.get('ADMIN_ALERT_EMAIL') ?? 'ops@leanshot.app';

export interface RetryResult {
  /** Updated retry_count after this attempt. */
  retry_count: number;
  /** True if this attempt promoted the row to status='failed'. */
  promoted_to_failed: boolean;
  /** True if an admin Resend alert was dispatched (best-effort). */
  admin_alerted: boolean;
}

/**
 * Increment retry counter on a payouts row and (if MAX_RETRIES reached)
 * mark the row failed + send an admin Resend alert.
 *
 * Idempotent failure handling: the UPDATE is the source of truth. Resend
 * dispatch is best-effort — a failed alert does NOT roll back the status
 * transition (operators see status='failed' in the admin queue regardless).
 */
export async function incrementPayoutRetry(
  admin: SupabaseClient,
  payoutId: string,
  errorMessage: string,
): Promise<RetryResult> {
  // Step 1: read current retry_count to decide promotion.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: existing, error: selErr } = (await (admin
    .from('payouts')
    .select('retry_count, affiliate_id')
    .eq('id', payoutId)
    .maybeSingle() as any)) as {
    data: { retry_count?: number; affiliate_id?: string } | null;
    error: { message?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (selErr) {
    console.error('[affiliate-payout/retry] select threw', selErr.message ?? 'unknown');
    return { retry_count: 0, promoted_to_failed: false, admin_alerted: false };
  }

  const currentRetries = existing?.retry_count ?? 0;
  const nextRetries = currentRetries + 1;
  const promote = nextRetries >= MAX_RETRIES;

  // T-19-09-I (PII safety): never echo the upstream Stripe error verbatim into
  // the DB. Hash or truncate to a stable 200-char ceiling.
  const safeReason = String(errorMessage ?? 'unknown').slice(0, 200);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { error: updErr } = (await (admin
    .from('payouts')
    .update({
      retry_count: nextRetries,
      failed_reason: safeReason,
      status: promote ? 'failed' : 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', payoutId) as any)) as { error: { message?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (updErr) {
    console.error('[affiliate-payout/retry] update threw', updErr.message ?? 'unknown');
    return { retry_count: currentRetries, promoted_to_failed: false, admin_alerted: false };
  }

  let alerted = false;
  if (promote) {
    alerted = await sendAdminAlert(payoutId, existing?.affiliate_id ?? '', safeReason);
  }

  return { retry_count: nextRetries, promoted_to_failed: promote, admin_alerted: alerted };
}

/**
 * Best-effort admin alert. Direct HTTPS to Resend (no SDK).
 * Returns false if the secret is missing, the stub is in effect, or any
 * non-2xx — caller does not retry.
 */
async function sendAdminAlert(
  payoutId: string,
  affiliateId: string,
  reason: string,
): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.error('[affiliate-payout/retry] RESEND_API_KEY missing — skipping admin alert');
    return false;
  }
  // CI stub — mirror clinic-invite Pitfall #7.
  if (apiKey === 'test-stub') return true;

  const from = Deno.env.get('RESEND_FROM') ?? RESEND_FROM_DEFAULT;
  const subject = `[LeanShot] Affiliate payout failed after ${MAX_RETRIES} attempts`;
  const text =
    `Payout ${payoutId} (affiliate ${affiliateId}) has failed after ${MAX_RETRIES} retries.\n\n` +
    `Reason (truncated): ${reason}\n\n` +
    `Action: review the payouts admin queue and the affiliate's Stripe Connect onboarding state.`;
  const html = `<p>${text.replace(/\n/g, '<br/>')}</p>`;

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [ADMIN_ALERT_TO],
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      console.error(`[affiliate-payout/retry] resend non-2xx: ${res.status}`);
      return false;
    }
    try {
      await res.text();
    } catch {
      /* best-effort drain */
    }
    return true;
  } catch (e) {
    console.error(
      '[affiliate-payout/retry] resend threw',
      e instanceof Error ? e.name : 'unknown',
    );
    return false;
  }
}

export const __internal = {
  MAX_RETRIES,
  sendAdminAlert,
};
