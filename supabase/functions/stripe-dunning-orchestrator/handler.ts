/**
 * stripe-dunning-orchestrator — handler.ts
 *
 * Phase 65 Plan 65-05.
 *
 * CRON-INVOKED (every 15 minutes) — service-role POST scans subscriptions
 * in failing dunning states and fires the next-stage Resend email. Cron
 * registration deferred to close-out Plan 65-10 per
 * [[feedback_fn_deploy_before_cron_db_push]].
 *
 * === Endpoints ===
 * GET /healthz → 200 { ok: true, fn: "stripe-dunning-orchestrator" }
 * POST / → service-role bearer required → enumerate dunning subs + send per-recipient Resend email
 *
 * === Auth ===
 * Requires `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
 * Constant-time comparison per T-65-05-01.
 * GET /healthz is exempt.
 *
 * === Idempotency ===
 * INSERT INTO dunning_emails_sent (subscription_id, stage, …) ON CONFLICT
 * (subscription_id, stage) DO NOTHING — composite PK enforced in migration
 * 20290104000003_dunning_emails_sent.sql. Insert happens BEFORE the Resend
 * call so a duplicate cron invocation that wins the PK race silently no-ops.
 *
 * === CAN-SPAM / Phase 60 WR-02 ===
 * PHYSICAL_ADDRESS env var MUST be set and MUST NOT contain placeholder strings.
 * Fn returns 503 + Slack P1 if guard fails (per
 * [[feedback_placeholder_string_runtime_guard_pattern]]).
 *
 * === Send-interval semantics ===
 * For first_failed: gate = hours since dunning_state transition (last_dunning_email_at IS NULL).
 * For second_failed/final_warning: gate = hours since previous-stage send
 *   (last_dunning_email_at < now() - send_interval).
 * The RPC `get_dunning_orchestrator_candidates(intervals jsonb)` encapsulates
 * the SQL — mock client in tests returns shaped rows.
 *
 * === Security ===
 * - Per-recipient (NOT bulk BCC) send — T-65-05-04
 * - ON CONFLICT (subscription_id, stage) DO NOTHING — T-65-05-02
 * - RFC 8058 List-Unsubscribe + List-Unsubscribe-Post headers on every email
 * - PHYSICAL_ADDRESS runtime guard — T-65-05-03
 * - email_marketing_consent + email_lifecycle_exclusion both respected
 * - LIMIT 200 candidates per invocation — T-65-05-05 cost ceiling
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { constantTimeEqual, mintUnsubscribeToken } from '../_shared/newsletter-token.ts';
import { sendSlackGuardrailAlert } from '../_shared/slack-guardrail-alert.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

export type DunningStage = 'first_failed' | 'second_failed' | 'final_warning';

interface CandidateRow {
  subscription_id: string;
  user_id: string;
  email: string;
  email_marketing_consent: boolean | null;
  dunning_state: DunningStage;
  user_first_name: string | null;
}

export interface DunningOrchestratorDeps {
  /** Fetch implementation (allows mocking in tests) */
  fetchImpl: typeof fetch;
  /** Supabase service role client */
  supabaseServiceClient: ReturnType<typeof createClient>;
  /** Resend API key — 'test-stub' returns stubbed response without HTTP */
  resendApiKey: string;
  /** Service-role key for bearer auth check */
  serviceRoleKey: string;
  /** Supabase project URL (used for unsubscribe token URL) */
  supabaseUrl: string;
  /** HMAC signing key for unsubscribe token envelope */
  signingKey: string;
  /** CAN-SPAM physical address (from PHYSICAL_ADDRESS env var) */
  physicalAddress?: string;
  /** Send interval in hours per stage (used in candidate RPC query) */
  sendIntervals?: {
    first_failed_hours: number;
    second_failed_hours: number;
    final_warning_hours: number;
  };
}

const DEFAULT_INTERVALS = {
  first_failed_hours: 24,
  second_failed_hours: 72,
  final_warning_hours: 168,
};

// ─── HTML sanitizer ──────────────────────────────────────────────────────────

function htmlEncode(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHeaderInjection(str: string): string {
  return str.replace(/[\r\n]/g, ' ');
}

// ─── Template rendering ──────────────────────────────────────────────────────

const STAGE_META: Record<DunningStage, {
  short: 'first' | 'second' | 'final';
  subject: string;
}> = {
  first_failed: {
    short: 'first',
    subject: "We couldn't process your last payment",
  },
  second_failed: {
    short: 'second',
    subject: 'Action needed: second payment attempt failed',
  },
  final_warning: {
    short: 'final',
    subject: 'Your subscription will be cancelled in 24 hours',
  },
};

/**
 * Render inline templates (HTML + text) for a given dunning stage.
 *
 * We keep the templates inline so the Fn deploys as a single bundle and the
 * `_shared/email-templates/dunning-*.{html,txt}` artifact files document the
 * canonical content. The strings below MUST stay byte-identical to the
 * template files — Plan 65-10 close-out will add a static-grep gate that
 * matches both copies. Until then, hand-sync.
 */
function renderHtmlForStage(stage: DunningStage, opts: {
  userFirstName: string;
  billingPortalUrl: string;
  unsubscribeUrl: string;
  physicalAddress: string;
}): string {
  const firstName = htmlEncode(opts.userFirstName);
  const billingUrl = htmlEncode(opts.billingPortalUrl);
  const unsubUrl = htmlEncode(opts.unsubscribeUrl);
  const addr = htmlEncode(opts.physicalAddress);

  let headerBg = '#0f766e';
  let ctaBg = '#0f766e';
  let title = 'Payment issue';
  let subhead = "We couldn't process your last payment";
  let preheader =
    "Your most recent LeanShot subscription payment didn't go through. Update your payment method to keep your subscription active.";
  let body = `<p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
                We were unable to process your most recent LeanShot subscription payment.
                This can happen for a number of reasons &#8212; your card may have expired,
                or the bank may have flagged the charge. We'll automatically try again
                over the next few days.
              </p>
              <p style="margin:0 0 24px 0;font-size:15px;color:#374151;line-height:1.6;">
                To avoid any interruption to your subscription, you can update your
                payment method right now from your billing settings.
              </p>`;
  let cta = 'Update payment method &#x2197;';

  if (stage === 'second_failed') {
    headerBg = '#b45309';
    ctaBg = '#b45309';
    title = 'Action needed';
    subhead = 'Second payment attempt failed';
    preheader =
      'A second LeanShot subscription payment attempt has failed. Please update your billing details to avoid cancellation.';
    body = `<p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
                We tried again to process your LeanShot subscription payment and it
                still didn't go through. Your subscription is at risk of being
                cancelled if we can't collect payment within the next few days.
              </p>
              <p style="margin:0 0 24px 0;font-size:15px;color:#374151;line-height:1.6;">
                Please take a moment to update your payment method &#8212; it usually
                takes less than a minute.
              </p>`;
  } else if (stage === 'final_warning') {
    headerBg = '#b91c1c';
    ctaBg = '#b91c1c';
    title = 'Final notice';
    subhead = 'Your subscription will be cancelled in 24 hours';
    preheader =
      'Final notice: your LeanShot subscription will be cancelled in 24 hours unless payment is received.';
    body = `<p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
                This is our final notice: we have not been able to collect payment
                for your LeanShot subscription. Your subscription will be cancelled
                in the next 24 hours unless we receive payment.
              </p>
              <p style="margin:0 0 24px 0;font-size:15px;color:#374151;line-height:1.6;">
                If you'd like to keep your subscription, please update your payment
                method now. Your tracked data, injections, and metrics will remain
                on your account either way &#8212; you just won't have access to the
                premium features while cancelled.
              </p>`;
    cta = 'Keep my subscription &#x2197;';
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${htmlEncode(subhead)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${htmlEncode(preheader)}</div>
  <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f5f5f5">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff"
               style="max-width:600px;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td bgcolor="${headerBg}" style="padding:32px 40px;">
              <h1 style="margin:0;font-size:22px;font-weight:600;color:#ffffff;">${htmlEncode(title)}</h1>
              <p style="margin:6px 0 0 0;font-size:13px;color:rgba(255,255,255,0.9);">${htmlEncode(subhead)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">Hi ${firstName},</p>
              ${body}
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td>
                    <a href="${billingUrl}"
                       style="display:inline-block;height:40px;line-height:40px;padding:0 24px;background:${ctaBg};color:#ffffff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">
                      ${cta}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
                Questions? Reply to this email or reach us at
                <a href="mailto:billing@leanshot.app" style="color:#0d9488;">billing@leanshot.app</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td bgcolor="#f9fafb" style="padding:24px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0 0 8px 0;font-size:11px;color:#6b7280;text-align:center;">
                This is a transactional notification about your LeanShot subscription.
              </p>
              <p style="margin:0 0 8px 0;font-size:11px;color:#6b7280;text-align:center;">
                <a href="${unsubUrl}" style="color:#0d9488;">Unsubscribe</a>
                &nbsp;&#183;&nbsp;
                <a href="https://leanshot.app/account/data-rights" style="color:#0d9488;">Manage preferences</a>
              </p>
              <p style="margin:0;font-size:10px;color:#9ca3af;text-align:center;">LeanShot &mdash; ${addr}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderTextForStage(stage: DunningStage, opts: {
  userFirstName: string;
  billingPortalUrl: string;
  unsubscribeUrl: string;
  physicalAddress: string;
}): string {
  const { userFirstName, billingPortalUrl, unsubscribeUrl, physicalAddress } = opts;

  let header = "LeanShot — Payment issue\n========================\n\nWe couldn't process your last payment";
  let body =
    "We were unable to process your most recent LeanShot subscription payment.\n" +
    "This can happen for a number of reasons — your card may have expired, or\n" +
    "the bank may have flagged the charge. We'll automatically try again over\n" +
    "the next few days.\n\n" +
    "To avoid any interruption to your subscription, you can update your\n" +
    "payment method right now from your billing settings.";
  let ctaLabel = 'UPDATE PAYMENT METHOD';

  if (stage === 'second_failed') {
    header = 'LeanShot — Action needed\n========================\n\nSecond payment attempt failed';
    body =
      'We tried again to process your LeanShot subscription payment and it\n' +
      "still didn't go through. Your subscription is at risk of being\n" +
      "cancelled if we can't collect payment within the next few days.\n\n" +
      'Please take a moment to update your payment method — it usually takes\n' +
      'less than a minute.';
  } else if (stage === 'final_warning') {
    header = 'LeanShot — Final notice\n=======================\n\nYour subscription will be cancelled in 24 hours';
    body =
      'This is our final notice: we have not been able to collect payment for\n' +
      'your LeanShot subscription. Your subscription will be cancelled in the\n' +
      "next 24 hours unless we receive payment.\n\n" +
      "If you'd like to keep your subscription, please update your payment\n" +
      'method now. Your tracked data, injections, and metrics will remain on\n' +
      "your account either way — you just won't have access to the premium\n" +
      'features while cancelled.';
    ctaLabel = 'KEEP MY SUBSCRIPTION';
  }

  return `${header}\n\nHi ${userFirstName},\n\n${body}\n\n${ctaLabel}\n${'-'.repeat(ctaLabel.length)}\n\n${billingPortalUrl}\n\nQuestions? Reply to this email or reach us at billing@leanshot.app.\n\n---\n\nThis is a transactional notification about your LeanShot subscription.\n\nUnsubscribe: ${unsubscribeUrl}\nManage preferences: https://leanshot.app/account/data-rights\n\nLeanShot — ${physicalAddress}\n`;
}

// ─── Main handler ────────────────────────────────────────────────────────────

/**
 * Dunning orchestrator handler. Exported as a named function so tests can
 * call it directly without triggering Deno.serve.
 *
 * Per [[reference_deno_test_top_level_serve_trap]]: Deno.serve is guarded
 * by `if (import.meta.main)` in index.ts to prevent server bind on test import.
 */
export async function handle(
  req: Request,
  deps: DunningOrchestratorDeps,
): Promise<Response> {
  const url = new URL(req.url);

  // ── GET /healthz ───────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    return new Response(
      JSON.stringify({ ok: true, fn: 'stripe-dunning-orchestrator' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Only POST from here ────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Auth: service-role bearer (T-65-05-01, constant-time compare) ─────────
  const bearerHeader = req.headers.get('Authorization') ?? '';
  const bearer = bearerHeader.startsWith('Bearer ') ? bearerHeader.slice(7) : '';

  if (!constantTimeEqual(bearer, deps.serviceRoleKey)) {
    return new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── CAN-SPAM physical address guard (Phase 60 WR-02 pattern, T-65-05-03) ──
  // Refuses to send if PHYSICAL_ADDRESS is unset or contains placeholder strings.
  // Sending without a valid address violates 15 U.S.C. § 7704(a)(5).
  const physicalAddress = deps.physicalAddress;
  if (
    !physicalAddress ||
    /\[|TODO|REPLACE_ME|PLACEHOLDER/i.test(physicalAddress)
  ) {
    console.error(
      '[stripe-dunning-orchestrator] BLOCKED: PHYSICAL_ADDRESS not set or is placeholder',
    );
    void sendSlackGuardrailAlert('regulatory', {
      severity: 'P1',
      title: 'stripe-dunning-orchestrator BLOCKED — PHYSICAL_ADDRESS not configured',
      text: 'Set PHYSICAL_ADDRESS as a Supabase Function Secret before the cron fires.',
    }).catch(() => {});
    return new Response(
      JSON.stringify({ error: 'physical_address_missing_or_placeholder' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Query candidate dunning rows via RPC ──────────────────────────────────
  // The RPC `get_dunning_orchestrator_candidates(intervals jsonb)`:
  //   - Joins subscriptions × auth.users (per [[reference_profiles_email_vs_auth_users_email]])
  //   - Filters dunning_state IN ('first_failed','second_failed','final_warning')
  //   - Filters last_dunning_email_at NULL OR < now() - interval_for(stage)
  //   - COALESCE(email_marketing_consent, true) IS TRUE (null = implicit consent)
  //   - NOT EXISTS in email_lifecycle_exclusion
  //   - LIMIT 200
  // The RPC SQL is registered in 65-10 close-out (matches Phase 64-03 candidate-RPC pattern).
  const intervals = deps.sendIntervals ?? DEFAULT_INTERVALS;
  const supabaseClient = deps.supabaseServiceClient;

  const { data: candidates, error: queryError } = await (supabaseClient.rpc(
    'get_dunning_orchestrator_candidates',
    { intervals },
  ).select() as unknown as Promise<{ data: CandidateRow[] | null; error: unknown }>);

  if (queryError) {
    console.error('[stripe-dunning-orchestrator] candidate query error:', queryError);
    return new Response(
      JSON.stringify({ error: 'db_error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!candidates || candidates.length === 0) {
    return new Response(
      JSON.stringify({ sent: 0, skipped: 0, errors: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let sent = 0;
  let skipped = 0;
  const errors: Array<{ subscription_id: string; error: string }> = [];

  const safeFrom = stripHeaderInjection('LeanShot Billing <billing@leanshot.app>');
  const billingPortalUrl = 'https://app.leanshot.app/settings/billing';

  // ── Per-row send loop (T-65-05-04: NEVER bulk BCC) ────────────────────────
  for (const cand of candidates) {
    // Skip if email_marketing_consent explicitly false (defense-in-depth — RPC
    // already filters but the explicit COALESCE check should catch it too).
    if (cand.email_marketing_consent === false) {
      skipped++;
      continue;
    }

    // Defense-in-depth: only known stages are handled.
    const meta = STAGE_META[cand.dunning_state];
    if (!meta) {
      skipped++;
      continue;
    }

    try {
      // INSERT BEFORE Resend call — T-65-05-02 (idempotency under composite PK).
      // ON CONFLICT (subscription_id, stage) DO NOTHING via upsert with
      // ignoreDuplicates=true. The mock returns rowCount=0 on conflict.
      const insertResult = await (supabaseClient
        .from('dunning_emails_sent')
        .upsert(
          {
            subscription_id: cand.subscription_id,
            stage: cand.dunning_state,
            sent_at: new Date().toISOString(),
            resend_message_id: null,
          },
          { onConflict: 'subscription_id,stage', ignoreDuplicates: true },
        )
        .select() as unknown as Promise<{ data: unknown[] | null; error: unknown }>);

      if (insertResult.error) {
        errors.push({
          subscription_id: cand.subscription_id,
          error: 'insert_error',
        });
        continue;
      }

      // ON CONFLICT DO NOTHING returns empty data — this email was already sent.
      if (!insertResult.data || insertResult.data.length === 0) {
        skipped++;
        continue;
      }

      // Mint unsubscribe token (HMAC envelope per newsletter-token pattern).
      // Use cand.user_id as the stored token base (deterministic placeholder
      // for users without a newsletter row — mirrors grandfathered-policy-notice).
      const storedToken = cand.user_id;
      const hmacEnvelope = await mintUnsubscribeToken({
        userId: cand.user_id,
        storedToken,
        signingKey: deps.signingKey,
      });
      const unsubscribeUrl =
        `${deps.supabaseUrl}/functions/v1/rag-newsletter-unsubscribe-1click` +
        `?u=${encodeURIComponent(cand.user_id)}` +
        `&t=${encodeURIComponent(storedToken)}` +
        `&h=${encodeURIComponent(hmacEnvelope)}`;

      const userFirstName = cand.user_first_name?.trim() || 'there';
      const html = renderHtmlForStage(cand.dunning_state, {
        userFirstName,
        billingPortalUrl,
        unsubscribeUrl,
        physicalAddress,
      });
      const text = renderTextForStage(cand.dunning_state, {
        userFirstName,
        billingPortalUrl,
        unsubscribeUrl,
        physicalAddress,
      });

      // ── CAN-SPAM placeholder runtime guard on the rendered body ──────────
      // Defense-in-depth: if a template literal slipped through with `[placeholder]`
      // / TODO / REPLACE_ME, hard-fail rather than send a non-compliant body
      // (per [[feedback_placeholder_string_runtime_guard_pattern]]).
      if (
        /\[placeholder\]|REPLACE_ME|TODO_TEMPLATE|TBD_TEMPLATE/i.test(html) ||
        /\[placeholder\]|REPLACE_ME|TODO_TEMPLATE|TBD_TEMPLATE/i.test(text)
      ) {
        console.error(
          '[stripe-dunning-orchestrator] BLOCKED: rendered body contains placeholder',
        );
        void sendSlackGuardrailAlert('regulatory', {
          severity: 'P1',
          title: 'stripe-dunning-orchestrator BLOCKED — placeholder in rendered email body',
          text: `Rendered body for subscription ${cand.subscription_id} (stage ${cand.dunning_state}) contains a literal placeholder string. Halting send.`,
        }).catch(() => {});
        // Roll back the just-inserted dunning_emails_sent row so retry on the
        // next cron invocation can re-attempt once templates are fixed.
        await (supabaseClient
          .from('dunning_emails_sent')
          .delete()
          .eq('subscription_id', cand.subscription_id)
          .eq('stage', cand.dunning_state) as unknown as Promise<unknown>);
        return new Response(
          JSON.stringify({ error: 'placeholder_in_rendered_body' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const safeTo = stripHeaderInjection(cand.email);
      const subject = stripHeaderInjection(meta.subject);

      const listUnsubscribeHeaders = {
        'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:unsubscribe@leanshot.app>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };

      let messageId: string | null = null;
      let sendOk = false;

      if (deps.resendApiKey === 'test-stub') {
        sendOk = true;
        messageId = 'stubbed';
      } else {
        const resendPayload = {
          from: safeFrom,
          to: [safeTo],
          subject,
          html,
          text,
          headers: listUnsubscribeHeaders,
        };

        const resendRes = await deps.fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${deps.resendApiKey}`,
          },
          body: JSON.stringify(resendPayload),
        });

        sendOk = resendRes.ok;
        if (resendRes.ok) {
          try {
            const body = (await resendRes.json()) as { id?: string };
            messageId = body?.id ?? null;
          } catch {
            /* best-effort */
          }
        } else {
          console.warn(
            '[stripe-dunning-orchestrator] Resend error for',
            cand.subscription_id,
            resendRes.status,
          );
        }
      }

      if (sendOk) {
        // Update resend_message_id on the row we just inserted + bump
        // subscriptions.last_dunning_email_at to gate the send-interval check
        // on the next cron tick.
        await (supabaseClient
          .from('dunning_emails_sent')
          .update({ resend_message_id: messageId })
          .eq('subscription_id', cand.subscription_id)
          .eq('stage', cand.dunning_state) as unknown as Promise<unknown>);

        await (supabaseClient
          .from('subscriptions')
          .update({ last_dunning_email_at: new Date().toISOString() })
          .eq('id', cand.subscription_id) as unknown as Promise<unknown>);

        sent++;
      } else {
        // Roll back the dunning_emails_sent row so retry on the next cron
        // invocation can re-attempt. Composite PK still prevents double-send
        // if the rollback fails and the next attempt succeeds.
        await (supabaseClient
          .from('dunning_emails_sent')
          .delete()
          .eq('subscription_id', cand.subscription_id)
          .eq('stage', cand.dunning_state) as unknown as Promise<unknown>);
        errors.push({
          subscription_id: cand.subscription_id,
          error: 'resend_failed',
        });
      }
    } catch (err) {
      console.error(
        '[stripe-dunning-orchestrator] error processing subscription',
        cand.subscription_id,
        err,
      );
      errors.push({
        subscription_id: cand.subscription_id,
        error: 'processing_exception',
      });
    }
  }

  return new Response(
    JSON.stringify({ sent, skipped, errors }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
