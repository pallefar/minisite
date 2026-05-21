/**
 * PHI/non-PHI email router — Phase 25 Plan 25-03 (HIPAA-05, Pattern S4, S5).
 *
 * Single dispatch point for ALL outbound emails from LeanShot Edge Functions.
 *
 * Routing rule (SINGLE switch — caller is authoritative):
 *   phi=false → Resend (existing non-PHI path via sendResendEmail).
 *   phi=true  → AWS SES with:
 *     1. Vendor-gate check (awsSesHealthCheck — Pattern S4).
 *        If not ok: return skipped no-op — DO NOT fall back to Resend.
 *        Silent Resend fallback = PHI sent outside BAA boundary (T-25-03-S4).
 *     2. Suppression-list check (recipient_hash in ses_suppression_list).
 *        If suppressed: return skipped no-op — do not send.
 *     3. Render template + send via SESv2 SDK.
 *
 * Module-load safety (Pattern S4 + S5):
 *   - No module-level throws; env vars read lazily inside functions.
 *   - SESv2Client is a lazy singleton (_ses) — init happens on first PHI send,
 *     not at import time, so test files can set Deno.env vars before first use.
 *
 * PII safety (T-25-03-I2, T-25-03-I1):
 *   - NEVER echo e.message — AWS SDK errors can contain Authorization header.
 *   - NEVER log recipient email — hash it with sha256 before any log.
 *   - Error responses use stable short-codes only.
 *
 * Anti-patterns explicitly avoided:
 *   - NO silent Resend fallback on SES failure (T-25-03-S4).
 *   - NO module-level SDK init (lazy singleton only).
 *   - NO raw email in logs or responses (T-25-03-I1).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { SendEmailCommand, SESv2Client } from 'npm:@aws-sdk/client-sesv2@^3.700.0';
import { awsSesHealthCheck } from './aws-ses-health-check.ts';
import { sendResendEmail } from './lifecycle-send.ts';
// Phase 37 Plan 37-02 Task 3 — helpdesk template modules. Each module exports
// `subject(vars)` + `render(vars)`. PHI routing is the caller's responsibility
// (args.phi); the templates themselves are vendor-agnostic.
import * as csatFollowup     from './email-templates/csat-followup.ts';
import * as agentReply       from './email-templates/helpdesk-agent-reply.ts';
import * as slaAlert         from './email-templates/sla-breach-alert.ts';
import * as unknownSender    from './email-templates/helpdesk-unknown-sender.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * All email template identifiers supported by the router.
 * non-PHI templates → Resend.
 * PHI templates → SES.
 */
export type EmailTemplate =
  // Non-PHI (Resend)
  | 'welcome'
  | 'receipt'
  | 'password_reset'
  | 'marketing_announcement'
  // Phase 42 plan 42-07 (POLISH-12 D-21): quarterly NPS check-in.
  // Non-PHI — no protected health data; just a numeric NPS score + free-text
  // follow-up. Routes through Resend.
  | 'nps_quarterly'
  // PHI (SES)
  | 'clinic_notification'
  | 'dose_alert'
  | 'doctor_share'
  | 'patient_access_log_notification'
  // Phase 37 helpdesk templates ─────────────────────────────────────────────
  // Per [[feedback_planner_missed_status_enum_widening]]: union extension +
  // subjectFor + renderTemplate switch arms MUST land in the SAME commit.
  // Otherwise callers in Plans 37-03/04/05 reference a value the router's
  // default case routes to a generic subject + body → silent misroute.
  | 'csat_followup'              // non-PHI → Resend (CSAT score link only)
  | 'helpdesk_agent_reply'       // phi-aware → caller passes ticket.phi
  | 'sla_breach_alert'           // non-PHI → Resend (internal agent alert)
  | 'helpdesk_unknown_sender';   // non-PHI → Resend (auto-reply signup CTA per D-21)

export type SendEmailArgs = {
  /** Template identifier — determines HTML rendering and subject line. */
  template: EmailTemplate;
  /** Recipient email address. Never logged raw — sha256-hashed in logs. */
  to: string;
  /** Template variable substitutions. */
  vars: Record<string, unknown>;
  /**
   * SINGLE PHI switch — caller is authoritative.
   * true  → route via SES (HIPAA BAA boundary).
   * false → route via Resend (non-PHI path; existing wiring untouched).
   */
  phi: boolean;
};

export type SendEmailResult = {
  provider: 'ses' | 'resend';
  id: string;
  /** true when send was intentionally skipped (BAA pending, suppressed, etc.) */
  skipped?: boolean;
};

// ─── Lazy SES singleton ───────────────────────────────────────────────────────
// Pattern S5: init at first PHI send, not at module load.
// Allows Deno test suite to set env vars before first use.

let _ses: SESv2Client | null = null;

function getSes(): SESv2Client {
  if (_ses) return _ses;
  _ses = new SESv2Client({
    region: Deno.env.get('AWS_SES_REGION') ?? 'us-east-1',
    credentials: {
      accessKeyId: Deno.env.get('AWS_SES_ACCESS_KEY_ID') ?? '',
      secretAccessKey: Deno.env.get('AWS_SES_SECRET_ACCESS_KEY') ?? '',
    },
  });
  return _ses;
}

// Test injection: reset the singleton so env changes take effect mid-test.
export function __resetSesForTest(): void {
  _ses = null;
}

// ─── SHA-256 helper ───────────────────────────────────────────────────────────

/**
 * SHA-256 hex of the input string via Web Crypto (available in Deno runtime).
 * Used to hash recipient emails before suppression-list lookup and logging.
 * T-25-03-I1: raw email MUST NOT appear in logs or DB.
 */
async function sha256Hex(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Template rendering ───────────────────────────────────────────────────────

/** Subject lines for each PHI template. */
function subjectFor(template: EmailTemplate, vars: Record<string, unknown>): string {
  switch (template) {
    case 'clinic_notification':
      return `LeanShot Clinic Notification${vars.title ? ': ' + String(vars.title) : ''}`;
    case 'dose_alert':
      return 'LeanShot Dose Alert';
    case 'doctor_share':
      return 'LeanShot: Shared patient data';
    case 'patient_access_log_notification':
      return 'LeanShot: Your data was accessed';
    // Phase 42 plan 42-07 (POLISH-12 D-21) — quarterly NPS check-in.
    case 'nps_quarterly':
      return 'Quick check-in: how likely are you to recommend LeanShot?';
    // Phase 37 Plan 37-02 Task 3 — helpdesk templates.
    case 'csat_followup':
      return csatFollowup.subject(vars);
    case 'helpdesk_agent_reply':
      return agentReply.subject(vars);
    case 'sla_breach_alert':
      return slaAlert.subject(vars);
    case 'helpdesk_unknown_sender':
      return unknownSender.subject(vars);
    default:
      return 'LeanShot Notification';
  }
}

/**
 * Minimal HTML render for PHI templates.
 * Non-PHI templates are rendered by the Resend lifecycle-send path.
 * This is intentionally minimal — Phase 25 scope is the routing + gating,
 * not full template design. Each template gets a plain-text equivalent.
 */
function renderTemplate(template: EmailTemplate, vars: Record<string, unknown>): string {
  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  switch (template) {
    case 'clinic_notification': {
      const title = vars.title ? escapeHtml(String(vars.title)) : 'Notification';
      const body = vars.body ? escapeHtml(String(vars.body)) : '';
      return `<html><body><h2>${title}</h2>${body ? `<p>${body}</p>` : ''}</body></html>`;
    }
    case 'dose_alert': {
      const message = vars.message ? escapeHtml(String(vars.message)) : 'Dose alert from LeanShot.';
      return `<html><body><h2>Dose Alert</h2><p>${message}</p></body></html>`;
    }
    case 'doctor_share': {
      const patientRef = vars.patient_ref ? escapeHtml(String(vars.patient_ref)) : 'A patient';
      const shareUrl = vars.share_url ? String(vars.share_url) : '';
      return `<html><body><h2>Shared Patient Data</h2><p>${patientRef} has shared data with you.${
        shareUrl ? ` <a href="${encodeURI(shareUrl)}">View data</a>` : ''
      }</p></body></html>`;
    }
    case 'patient_access_log_notification': {
      const accessor = vars.accessor_name ? escapeHtml(String(vars.accessor_name)) : 'Someone';
      return `<html><body><h2>Data Access Notice</h2><p>${accessor} accessed your LeanShot data. This is a notification required under our HIPAA policies.</p></body></html>`;
    }
    // Phase 42 plan 42-07 (POLISH-12 D-21) — quarterly NPS check-in.
    // The caller supplies `score_links` (array of {score:0..10, url:string}) as
    // a pre-signed HMAC URL list. Non-PHI; routed through Resend.
    case 'nps_quarterly': {
      const quarter = vars.quarter ? escapeHtml(String(vars.quarter)) : 'this quarter';
      const links = Array.isArray(vars.score_links) ? vars.score_links as Array<{ score: number; url: string }> : [];
      const buttonRow = links
        .map((l) => {
          const safeUrl = encodeURI(String(l.url));
          const safeScore = Number.isFinite(l.score) ? String(l.score) : '?';
          return `<a href="${safeUrl}" style="display:inline-block;margin:2px;padding:8px 12px;border:1px solid #ccc;border-radius:4px;text-decoration:none;font-family:sans-serif;color:#0B1413;">${safeScore}</a>`;
        })
        .join('');
      return `<html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
<h2>Quick quarterly check-in</h2>
<p>How likely are you to recommend LeanShot to a friend with similar goals? (${quarter})</p>
<p style="margin:16px 0;"><strong>0 = Not at all likely &nbsp;&nbsp; 10 = Extremely likely</strong></p>
<div>${buttonRow}</div>
<p style="margin-top:24px;font-size:12px;color:#666;">One-click response — your feedback shapes the next quarter of features. If you have any thoughts, you can leave a follow-up note after clicking.</p>
</body></html>`;
    }
    // Phase 37 Plan 37-02 Task 3 — helpdesk templates.
    // Strategy: each helpdesk template module returns a plain-text body; here
    // we HTML-escape it and convert newlines to <br> so the email renders the
    // same in plain-text + HTML clients. No interactive widgets, no <a> tags
    // (URLs render as clickable text via mail-client auto-linking).
    case 'csat_followup': {
      const text = csatFollowup.render(vars);
      return `<html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B1413;">${escapeHtml(text).replace(/\n/g, '<br>')}</body></html>`;
    }
    case 'helpdesk_agent_reply': {
      const text = agentReply.render(vars);
      return `<html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B1413;">${escapeHtml(text).replace(/\n/g, '<br>')}</body></html>`;
    }
    case 'sla_breach_alert': {
      const text = slaAlert.render(vars);
      return `<html><body style="font-family:monospace;max-width:640px;margin:0 auto;padding:24px;color:#0B1413;">${escapeHtml(text).replace(/\n/g, '<br>')}</body></html>`;
    }
    case 'helpdesk_unknown_sender': {
      const text = unknownSender.render(vars);
      return `<html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B1413;">${escapeHtml(text).replace(/\n/g, '<br>')}</body></html>`;
    }
    default:
      return `<html><body><p>LeanShot notification.</p></body></html>`;
  }
}

// ─── Main dispatch function ───────────────────────────────────────────────────

/**
 * Route an email to either SES (PHI) or Resend (non-PHI).
 *
 * @param supabase  Supabase client with at minimum service_role scope for
 *                  suppression-list SELECT. Pass the caller's admin client.
 * @param args      Template + recipient + vars + phi flag.
 * @returns         Result with provider + message ID; `skipped:true` when
 *                  no-op (BAA pending, suppressed recipient, etc.).
 */
export async function sendEmail(
  supabase: SupabaseClient,
  args: SendEmailArgs,
): Promise<SendEmailResult> {
  // ── Non-PHI path: delegate to existing Resend helper. ──────────────────────
  if (!args.phi) {
    const subject = subjectFor(args.template, args.vars);
    const html = renderTemplate(args.template, args.vars);
    const result = await sendResendEmail({
      to: args.to,
      subject,
      html,
      text: `LeanShot: ${subject}`,
    });
    if (!result.ok) {
      throw new Error(result.error ?? 'resend_send_failed');
    }
    return { provider: 'resend', id: result.messageId ?? 'unknown' };
  }

  // ── PHI path: SES with vendor gate + suppression check. ───────────────────

  // 1. Vendor-gate check (Pattern S4).
  const health = await awsSesHealthCheck();
  if (!health.ok) {
    // T-25-03-S4: DO NOT fall back to Resend. PHI outside BAA boundary is a violation.
    console.warn('[email-router] SES no-op:', health.status, 'template:', args.template);
    return { provider: 'ses', id: 'noop-' + health.status, skipped: true };
  }

  // 2. Suppression-list check (lookup by sha256 of lowercased recipient).
  const recipientHash = await sha256Hex(args.to.toLowerCase());
  const { data: suppressed } = await supabase
    .from('ses_suppression_list')
    .select('recipient_hash')
    .eq('recipient_hash', recipientHash)
    .maybeSingle();
  if (suppressed) {
    // T-25-03-I1: log the hash prefix only — never the raw address.
    console.warn('[email-router] recipient suppressed:', recipientHash.slice(0, 8) + '...');
    return { provider: 'ses', id: 'suppressed', skipped: true };
  }

  // 3. Render template + send via SESv2.
  const html = renderTemplate(args.template, args.vars);
  const subject = subjectFor(args.template, args.vars);

  try {
    const out = await getSes().send(
      new SendEmailCommand({
        FromEmailAddress: Deno.env.get('AWS_SES_FROM') ??
          'LeanShot Clinical <noreply@app.leanshot.app>',
        Destination: { ToAddresses: [args.to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Html: { Data: html, Charset: 'UTF-8' } },
          },
        },
      }),
    );
    return { provider: 'ses', id: out.MessageId ?? 'unknown' };
  } catch (e) {
    // T-25-03-I2: NEVER echo e.message — AWS SDK errors can contain credentials.
    console.error(
      '[email-router] SES send threw',
      e instanceof Error ? e.name : 'unknown',
    );
    // Stable short-code per T-25-03-I2 — do not interpolate error details.
    throw new Error('ses_send_failed');
  }
}
