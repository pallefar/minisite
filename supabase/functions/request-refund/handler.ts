/**
 * request-refund — handler.ts
 *
 * Phase 65 Plan 65-06 (PAY-08).
 *
 * JWT-authed self-service refund Edge Fn per FTC ROSCA
 * (Restore Online Shoppers' Confidence Act). User-initiated; NOT operator-callable.
 *
 * === Endpoints ===
 * GET  /healthz → 200 { ok: true, fn: "request-refund" }
 * POST /        → user JWT required → eligibility check → Stripe refund + cancel + audit row + Resend
 *
 * === Auth ===
 * `Authorization: Bearer <USER_JWT>` resolved via supabaseServiceClient.auth.getUser(jwt).
 * NOT service-role — distinct from grandfathered-policy-notice. Pitfall:
 * [[reference_supabase_service_role_key_format_divergence]] — this Fn auths users,
 * NOT the orchestrator.
 *
 * === Eligibility (CONTEXT.md D-08, FTC ROSCA) ===
 * Eligible if EITHER:
 *   - trial_end > now()  (in-trial)
 *   - (now - created_at) < 14 days  (money-back window)
 * Otherwise: 403 { error: 'window_expired', eligibility_reason: 'past_14d_money_back' }.
 *
 * === Idempotency ===
 * SELECT refunds WHERE subscription_id=... AND status IN ('pending','succeeded')
 * → 409 { error: 'refund_already_processed', stripe_refund_id } if exists.
 * Plus stripe_refund_id UNIQUE constraint at DB layer.
 *
 * === CAN-SPAM / WR-02 ===
 * PHYSICAL_ADDRESS env var MUST be set and MUST NOT contain placeholder strings.
 * Returns 503 + Slack P1 if guard fails. Per
 * [[feedback_placeholder_string_runtime_guard_pattern]].
 *
 * === Threat Mitigations ===
 * - T-65-06-01 (Spoofing JWT) — admin.auth.getUser; 401 on null user.
 * - T-65-06-02 (Tamper other user's sub) — SELECT WHERE user_id = auth.user.id.
 * - T-65-06-04 (Stripe error echo) — generic { error: 'refund_failed' } only.
 * - T-65-06-05 (DoS) — Idempotency check returns 409 on existing refund.
 * - T-65-06-06 (refund+cancel atomicity) — cancel failure logs + Slack but does NOT
 *   roll back refund (user already got money; operator retries cancel).
 *
 * === Note: subscriptions.id ===
 * subscriptions.id IS the Stripe sub_xxx (Phase 14 schema; natural PK from webhook).
 * No separate stripe_subscription_id column. We pass sub.id to stripe.subscriptions.cancel.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { mintUnsubscribeToken } from '../_shared/newsletter-token.ts';
import { sendSlackGuardrailAlert } from '../_shared/slack-guardrail-alert.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RequestRefundDeps {
  /** Fetch implementation (allows mocking in tests) */
  fetchImpl: typeof fetch;
  /** Supabase service-role client (for auth.getUser + DB writes) */
  // deno-lint-ignore no-explicit-any
  supabaseServiceClient: any;
  /** Stripe SDK instance (real Stripe or test stub) */
  // deno-lint-ignore no-explicit-any
  stripe: any;
  /** Resend API key — 'test-stub' skips HTTP call */
  resendApiKey: string;
  /** Supabase project URL (for unsubscribe link) */
  supabaseUrl: string;
  /** HMAC signing key for unsubscribe envelope */
  signingKey: string;
  /** CAN-SPAM physical address (PHYSICAL_ADDRESS env var) */
  physicalAddress?: string;
  /** Slack webhook URL for guardrail alerts */
  slackWebhookUrl?: string;
  /** Money-back window in days (defaults to 14 per FTC ROSCA) */
  moneyBackDays?: number;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  status: string;
  trial_end: string | null;
  created_at: string;
}

interface StripeRefundResult {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

interface StripeInvoiceRow {
  payment_intent: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, code: string, extras: Record<string, unknown> = {}): Response {
  return jsonResponse(status, { error: code, ...extras });
}

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

function sanitizeReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Strip HTML tags + control chars; cap at 2000 chars.
  const stripped = raw.replace(/<[^>]*>/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  const trimmed = stripped.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed;
}

function htmlEncode(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHeaderInjection(s: string): string {
  return s.replace(/[\r\n]/g, ' ');
}

function formatDollars(amountCents: number): string {
  const dollars = (amountCents / 100).toFixed(2);
  return dollars;
}

// ─── Email templates (inline-rendered) ──────────────────────────────────────

function renderHtmlEmail(opts: {
  amountDollars: string;
  currencyUpper: string;
  eligibilityCopy: string;
  unsubscribeUrl: string;
  physicalAddress: string;
}): string {
  const { amountDollars, currencyUpper, eligibilityCopy, unsubscribeUrl, physicalAddress } = opts;
  const amt = htmlEncode(amountDollars);
  const cur = htmlEncode(currencyUpper);
  const elig = htmlEncode(eligibilityCopy);
  const unsub = htmlEncode(unsubscribeUrl);
  const addr = htmlEncode(physicalAddress);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your refund has been processed</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f5f5f5">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff"
               style="max-width:600px;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td bgcolor="#0f766e" style="padding:32px 40px;">
              <h1 style="margin:0;font-size:22px;font-weight:600;color:#ffffff;">Your refund has been processed</h1>
              <p style="margin:6px 0 0 0;font-size:13px;color:rgba(255,255,255,0.85);">
                LeanShot &middot; Billing
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
                Hi,
              </p>
              <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
                We&#8217;ve processed your refund of <strong>$${amt} ${cur}</strong> ${elig}.
              </p>
              <p style="margin:0 0 20px 0;font-size:14px;color:#374151;line-height:1.6;">
                Please <strong>allow 5-10 business days</strong> for the funds to appear on your original
                payment method. Refund timing depends on your bank or card issuer.
              </p>
              <p style="margin:0 0 20px 0;font-size:14px;color:#374151;line-height:1.6;">
                Your LeanShot subscription has been cancelled. You can re-subscribe anytime at
                <a href="https://leanshot.app/settings" style="color:#0d9488;">leanshot.app/settings</a>.
              </p>
              <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
                Questions? Reply to this email or contact
                <a href="mailto:billing-support@leanshot.app" style="color:#0d9488;">billing-support@leanshot.app</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td bgcolor="#f9fafb" style="padding:24px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0 0 8px 0;font-size:11px;color:#6b7280;text-align:center;">
                This is a transactional confirmation. It is not a marketing email.
              </p>
              <p style="margin:0 0 8px 0;font-size:11px;color:#6b7280;text-align:center;">
                <a href="${unsub}" style="color:#0d9488;">Unsubscribe</a>
                &nbsp;&#183;&nbsp;
                <a href="https://leanshot.app/account/data-rights" style="color:#0d9488;">Manage preferences</a>
              </p>
              <p style="margin:0;font-size:10px;color:#9ca3af;text-align:center;">
                LeanShot &mdash; ${addr}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderTextEmail(opts: {
  amountDollars: string;
  currencyUpper: string;
  eligibilityCopy: string;
  unsubscribeUrl: string;
  physicalAddress: string;
}): string {
  const { amountDollars, currencyUpper, eligibilityCopy, unsubscribeUrl, physicalAddress } = opts;
  return `LeanShot Refund Confirmation
============================

Your refund has been processed

Hi,

We've processed your refund of $${amountDollars} ${currencyUpper} ${eligibilityCopy}.

Please allow 5-10 business days for the funds to appear on your original payment
method. Refund timing depends on your bank or card issuer.

Your LeanShot subscription has been cancelled. You can re-subscribe anytime at
https://leanshot.app/settings.

Questions? Reply to this email or contact billing-support@leanshot.app.

---

This is a transactional confirmation. It is not a marketing email.

Unsubscribe: ${unsubscribeUrl}

LeanShot — ${physicalAddress}
`;
}

// ─── Main handler ───────────────────────────────────────────────────────────

export async function handle(
  req: Request,
  deps: RequestRefundDeps,
): Promise<Response> {
  const url = new URL(req.url);

  // ── GET /healthz ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    return jsonResponse(200, { ok: true, fn: 'request-refund' });
  }

  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed');
  }

  // ── CAN-SPAM physical address guard (WR-02) ───────────────────────────────
  const physicalAddress = deps.physicalAddress;
  if (
    !physicalAddress ||
    /\[|TODO|REPLACE_ME/i.test(physicalAddress)
  ) {
    console.error('[request-refund] BLOCKED: PHYSICAL_ADDRESS not set or is placeholder');
    void sendSlackGuardrailAlert('regulatory', {
      severity: 'P1',
      title: 'request-refund BLOCKED — PHYSICAL_ADDRESS not configured',
      text: 'Set PHYSICAL_ADDRESS as a Supabase Function Secret before invoking.',
    }).catch(() => {});
    return jsonError(503, 'can_spam_address_not_configured');
  }

  // ── JWT auth (T-65-06-01) ─────────────────────────────────────────────────
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  const { data: userData, error: userErr } = await deps.supabaseServiceClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonError(401, 'unauthenticated');
  const user = userData.user as { id: string; email?: string };

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { reason?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is acceptable; reason is optional.
    body = {};
  }
  const reason = sanitizeReason(body?.reason);

  // ── Lookup active subscription (T-65-06-02) ───────────────────────────────
  const { data: subRaw } = await deps.supabaseServiceClient
    .from('subscriptions')
    .select('id, user_id, status, trial_end, created_at')
    .eq('user_id', user.id)
    .in('status', ['trialing', 'active', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const sub = subRaw as SubscriptionRow | null;
  if (!sub) {
    return jsonError(404, 'no_subscription');
  }

  // ── Idempotency check (T-65-06-05) ────────────────────────────────────────
  const { data: existingRefundRaw } = await deps.supabaseServiceClient
    .from('refunds')
    .select('id, stripe_refund_id, status')
    .eq('subscription_id', sub.id)
    .in('status', ['pending', 'succeeded'])
    .limit(1)
    .maybeSingle();

  const existingRefund = existingRefundRaw as
    | { id: string; stripe_refund_id: string; status: string }
    | null;
  if (existingRefund) {
    return jsonError(409, 'refund_already_processed', {
      stripe_refund_id: existingRefund.stripe_refund_id,
    });
  }

  // ── Eligibility check (CONTEXT.md D-08, FTC ROSCA) ────────────────────────
  const moneyBackDays = deps.moneyBackDays ?? 14;
  const nowMs = Date.now();
  const inTrial = sub.trial_end && new Date(sub.trial_end).getTime() > nowMs;
  const ageMs = nowMs - new Date(sub.created_at).getTime();
  const inMoneyBack = ageMs < moneyBackDays * 86400_000;

  if (!inTrial && !inMoneyBack) {
    return jsonError(403, 'window_expired', {
      eligibility_reason: 'past_14d_money_back',
      support_email: 'billing-support@leanshot.app',
    });
  }

  // Compute eligibility_window (audit column for refunds row)
  const eligibilityWindow: 'trial' | 'money_back_14d' = inTrial ? 'trial' : 'money_back_14d';

  // ── Resolve payment_intent from most recent paid invoice ──────────────────
  let paymentIntent: string | null = null;
  try {
    const invoiceList = await deps.stripe.invoices.list({
      subscription: sub.id,
      status: 'paid',
      limit: 1,
    });
    const invoices = (invoiceList?.data ?? []) as StripeInvoiceRow[];
    paymentIntent = invoices.length > 0 ? (invoices[0].payment_intent ?? null) : null;
  } catch (err) {
    console.error('[request-refund] invoices.list failed', err instanceof Error ? err.message : 'unknown');
    return jsonError(500, 'refund_failed');
  }

  // Trial users may have no paid invoice — cancel directly without refund.
  if (!paymentIntent) {
    if (inTrial) {
      try {
        await deps.stripe.subscriptions.cancel(sub.id);
      } catch (err) {
        console.error('[request-refund] subscriptions.cancel (trial-no-charge) failed',
          err instanceof Error ? err.message : 'unknown');
        void sendSlackGuardrailAlert('regulatory', {
          severity: 'P2',
          title: 'request-refund: trial-no-charge cancel failed',
          text: `subscription_id=${sub.id} user_id=${user.id}`,
        }).catch(() => {});
      }
      return jsonResponse(200, { ok: true, status: 'trial_no_charge_to_refund' });
    }
    // money-back but no paid invoice → unexpected; surface clean error.
    return jsonError(500, 'no_paid_invoice');
  }

  // ── Execute Stripe refund (T-65-06-04 — no Stripe error echo) ─────────────
  let refund: StripeRefundResult;
  try {
    refund = await deps.stripe.refunds.create({
      payment_intent: paymentIntent,
      reason: 'requested_by_customer',
    });
  } catch (err) {
    console.error('[request-refund] stripe.refunds.create failed',
      err instanceof Error ? err.message : 'unknown');
    return jsonError(500, 'refund_failed');
  }

  // ── INSERT refunds audit row ──────────────────────────────────────────────
  const nowIso = new Date().toISOString();
  const insertRow = {
    subscription_id: sub.id,
    stripe_refund_id: refund.id,
    stripe_payment_intent_id: paymentIntent,
    amount_cents: refund.amount,
    currency: refund.currency,
    status: refund.status,
    reason,
    eligibility_window: eligibilityWindow,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const { error: insertErr } = await deps.supabaseServiceClient
    .from('refunds')
    .insert(insertRow)
    .select();

  if (insertErr) {
    // Refund already issued by Stripe; surface as Slack alert but still attempt cancel
    // and respond OK so user isn't double-debited if they retry.
    console.error('[request-refund] refunds insert failed (refund already issued)',
      insertErr.message);
    void sendSlackGuardrailAlert('regulatory', {
      severity: 'P1',
      title: 'request-refund: refund row insert FAILED after Stripe refund succeeded',
      text: `subscription_id=${sub.id} stripe_refund_id=${refund.id} user_id=${user.id}`,
    }).catch(() => {});
  }

  // ── Cancel subscription (T-65-06-06: best-effort; don't fail response) ────
  try {
    await deps.stripe.subscriptions.cancel(sub.id);
  } catch (err) {
    console.error('[request-refund] stripe.subscriptions.cancel failed (refund already issued)',
      err instanceof Error ? err.message : 'unknown');
    void sendSlackGuardrailAlert('regulatory', {
      severity: 'P1',
      title: 'request-refund: subscription cancel FAILED after refund succeeded',
      text: `subscription_id=${sub.id} stripe_refund_id=${refund.id} user_id=${user.id}`,
    }).catch(() => {});
  }

  // ── Fire Resend confirmation ──────────────────────────────────────────────
  if (user.email) {
    try {
      const storedToken = user.id;
      const hmacEnvelope = await mintUnsubscribeToken({
        userId: user.id,
        storedToken,
        signingKey: deps.signingKey,
      });
      const unsubscribeUrl =
        `${deps.supabaseUrl}/functions/v1/rag-newsletter-unsubscribe-1click` +
        `?u=${encodeURIComponent(user.id)}` +
        `&t=${encodeURIComponent(storedToken)}` +
        `&h=${encodeURIComponent(hmacEnvelope)}`;

      const eligibilityCopy =
        eligibilityWindow === 'trial'
          ? 'within your trial period'
          : 'within the 14-day money-back window';

      const amountDollars = formatDollars(refund.amount);
      const currencyUpper = (refund.currency ?? 'usd').toUpperCase();
      const html = renderHtmlEmail({
        amountDollars,
        currencyUpper,
        eligibilityCopy,
        unsubscribeUrl,
        physicalAddress,
      });
      const text = renderTextEmail({
        amountDollars,
        currencyUpper,
        eligibilityCopy,
        unsubscribeUrl,
        physicalAddress,
      });

      const safeTo = stripHeaderInjection(user.email);
      const subject = stripHeaderInjection('Your refund has been processed');
      const safeFrom = stripHeaderInjection('LeanShot <noreply@app.leanshot.app>');

      const listUnsubscribeHeaders = {
        'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:unsubscribe@leanshot.app>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };

      if (deps.resendApiKey !== 'test-stub') {
        const resendRes = await deps.fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${deps.resendApiKey}`,
          },
          body: JSON.stringify({
            from: safeFrom,
            to: [safeTo],
            subject,
            html,
            text,
            headers: listUnsubscribeHeaders,
          }),
        });
        if (!resendRes.ok) {
          console.warn('[request-refund] Resend non-ok', resendRes.status);
        }
      }
    } catch (err) {
      // Email failure must NOT fail the refund response — refund + cancel already done.
      console.error('[request-refund] confirmation email failed',
        err instanceof Error ? err.message : 'unknown');
    }
  }

  return jsonResponse(200, {
    ok: true,
    refund_id: refund.id,
    amount_cents: refund.amount,
    status: refund.status,
  });
}
