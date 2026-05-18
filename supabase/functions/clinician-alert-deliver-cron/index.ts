/**
 * clinician-alert-deliver-cron Edge Function — Phase 30 Plan 30-01 (CLIN-03/04)
 *
 * Invoked every 20 minutes by pg_cron (p30_clinician_alert_deliver).
 * Polls pending clinician_alerts WHERE retry_count < 3, dispatches:
 *   (a) HMAC realtime broadcast on `org-{hmac8}-alerts` channel (D-13)
 *   (b) PHI-stripped Resend email to org admin+staff (D-02)
 * Inserts into clinician_alert_deliveries per attempt (D-14 append-only).
 * On 3rd failure: transitions alert to status='delivery_failed' (D-12).
 *
 * Security:
 *   T-30-01-01/02: Email subject + body contains ONLY org_name + CTA deep-link.
 *                  PHI-stripped: no patient name, clinical details, or treatment values.
 *   T-30-01-03: Edge Fn URL is Bearer-token-gated by pg_cron service_role token.
 *   T-30-01-04: Per-alert try/catch; loop continues on failure; Sentry captures each.
 *   T-30-01-05: channelNameFromSecret derives HMAC from (orgId, 'alerts') + Vault secret.
 *
 * Vendor-gated health check ([[reference_vendor_gated_send_health_check]]):
 *   If RESEND_API_KEY is missing → log warning + skip email path (realtime still fires).
 *
 * ESLint no-raw-service-role-client:
 *   Uses _createServiceRoleClientUnsafe from _shared/supabase-server.ts.
 *   Direct raw-key createClient calls are blocked by ESLint rule.
 *
 * TODO P25 close: swap fetch('https://api.resend.com/emails', ...) for
 *   sendEmail({phi: false, template: 'clinician_alert', ...}) from _shared/email-router.ts
 *   when Phase 25 Plan 25-03 ships — no-op rename.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { channelNameFromSecret } from '../_shared/realtime.ts';
import { _createServiceRoleClientUnsafe } from '../_shared/supabase-server.ts';
import * as Sentry from '../_shared/sentry.ts';

// ── Startup health check ([[reference_vendor_gated_send_health_check]]) ──────────
// Warn at module load time so Sentry / logs capture the misconfiguration
// even before a request arrives.
if (!Deno.env.get('RESEND_API_KEY')) {
  console.warn(
    '[clinician-alert-deliver-cron] RESEND_API_KEY missing — email delivery disabled; realtime broadcast still active',
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────────

export interface PendingAlert {
  id: string;
  org_id: string;
  patient_user_id: string;
  alert_type: string;
  retry_count: number;
}

export interface AlertResult {
  alert_id: string;
  ok: boolean;
  realtime_ok: boolean;
  email_ok: boolean;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────────

/**
 * Build the PHI-free Resend email payload for a single alert.
 *
 * D-02 enforcement:
 *   subject: `New clinical alert — ${org_name}` (em dash, not hyphen)
 *   html:    single CTA link to /clinic/{slug}/alerts?alert={uuid}
 *   PHI-stripped: no patient identifiers, clinical details, or treatment data.
 *
 * Exported for unit-test consumption (body-keys assertion).
 */
export function buildAlertEmailPayload(opts: {
  from: string;
  to: string[];
  orgName: string;
  orgSlug: string;
  alertId: string;
}): {
  from: string;
  to: string[];
  subject: string;
  html: string;
} {
  // D-02: subject uses em dash (—), not hyphen (-).
  const subject = `New clinical alert — ${opts.orgName}`;

  // D-02: body contains ONLY a single CTA deep-link. No patient identifiers.
  const deepLink = `https://app.leanshot.app/clinic/${opts.orgSlug}/alerts?alert=${opts.alertId}`;
  const html = [
    '<p>A new clinical alert has been raised in your clinic.</p>',
    `<p><a href="${deepLink}">View alert</a></p>`,
  ].join('\n');

  return {
    from: opts.from,
    to: opts.to,
    subject,
    html,
    // D-02 enforcement: ONLY {from, to, subject, html} — no metadata, no PHI fields.
  };
}

// ── Core delivery loop ─────────────────────────────────────────────────────────────

/**
 * Exported delivery loop for unit-test consumption.
 * Mirrors `runForOrgs` from org-metered-billing-cron: per-alert try/catch,
 * Sentry on failure, never throws upstream.
 */
export async function runDeliverCron(opts: {
  // deno-lint-ignore no-explicit-any
  admin: any;
  alerts: PendingAlert[];
  resendApiKey: string | null;
  resendFrom: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}): Promise<AlertResult[]> {
  const results: AlertResult[] = [];

  for (const alert of opts.alerts) {
    try {
      const alertResult = await deliverAlert({ ...opts, alert });
      results.push(alertResult);
    } catch (err) {
      // Per-alert catch — one failure must NOT abort the batch (mirrors org-metered-billing-cron)
      Sentry.captureException(err, {
        tags: { cron: 'clinician-alert-deliver', alert_id: alert.id, org_id: alert.org_id },
      });
      results.push({
        alert_id: alert.id,
        ok: false,
        realtime_ok: false,
        email_ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * Deliver a single alert via realtime broadcast + Resend email.
 * Updates retry state on completion (success or failure).
 */
async function deliverAlert(opts: {
  // deno-lint-ignore no-explicit-any
  admin: any;
  alert: PendingAlert;
  resendApiKey: string | null;
  resendFrom: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}): Promise<AlertResult> {
  const { admin, alert, resendApiKey, resendFrom, supabaseUrl, supabaseAnonKey } = opts;

  // ── (a) Fetch HMAC secret for realtime channel ─────────────────────────────
  let secretHex: string | null = null;
  try {
    const { data: secretData, error: secretErr } = await admin.rpc('get_realtime_secret');
    if (secretErr) {
      console.warn('[clinician-alert-deliver-cron] get_realtime_secret RPC error:', secretErr.message);
    } else {
      // get_realtime_secret() returns text directly (decrypted_secret column)
      secretHex = typeof secretData === 'string' ? secretData : null;
    }
  } catch (e) {
    console.warn('[clinician-alert-deliver-cron] get_realtime_secret threw:', e instanceof Error ? e.message : e);
  }

  // ── (b) Realtime broadcast ─────────────────────────────────────────────────
  let realtimeOk = false;
  let realtimeError: string | null = null;

  if (secretHex) {
    try {
      const channelName = await channelNameFromSecret(alert.org_id, 'alerts', secretHex);
      // Use anon-key client for broadcast — HMAC validation happens on subscriber side.
      // Edge Fns cannot call pg_notify directly (RESEARCH §Pitfall 4).
      const broadcastClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const broadcastResult = await broadcastClient.channel(channelName).send({
        type: 'broadcast',
        event: 'new_alert',
        // D-13: payload contains ONLY UUIDs + alert_type (no patient name, vitals, dose)
        payload: {
          alert_id: alert.id,
          alert_type: alert.alert_type,
          status: 'pending',
          created_at: new Date().toISOString(),
        },
      });
      // channel.send returns 'ok' | 'error' | 'timed out'
      realtimeOk = broadcastResult === 'ok';
      if (!realtimeOk) {
        realtimeError = `broadcast returned: ${broadcastResult}`;
      }
    } catch (e) {
      realtimeError = e instanceof Error ? e.message : String(e);
    }
  } else {
    // No secret — skip realtime, log warning, deliver email only
    console.warn(
      `[clinician-alert-deliver-cron] No realtime secret for alert ${alert.id} — skipping broadcast`,
    );
    realtimeError = 'no_realtime_secret';
  }

  // ── (c) INSERT realtime delivery log (D-14 append-only) ────────────────────
  await admin.from('clinician_alert_deliveries').insert({
    alert_id: alert.id,
    channel: 'realtime',
    success: realtimeOk,
    error: realtimeOk ? null : (realtimeError?.slice(0, 500) ?? null),
  });

  // ── (d) Resend email dispatch ───────────────────────────────────────────────
  let emailOk = false;
  let emailError: string | null = null;

  // Health-check gate: skip email if RESEND_API_KEY absent.
  if (!resendApiKey) {
    emailError = 'resend_api_key_missing';
    console.warn('[clinician-alert-deliver-cron] Email skipped: RESEND_API_KEY not configured');
  } else if (resendApiKey === 'test-stub') {
    // CI stub: skip HTTPS dispatch (mirrors clinic-patient-invite pattern)
    emailOk = true;
  } else {
    try {
      // Fetch org name + slug for email template
      const { data: org, error: orgErr } = await admin
        .from('organizations')
        .select('name, slug')
        .eq('id', alert.org_id)
        .single();

      if (orgErr || !org) {
        emailError = `org_fetch_failed: ${orgErr?.message ?? 'no row'}`;
      } else {
        // Fetch clinician emails (admin + staff roles only)
        const { data: members, error: membersErr } = await admin
          .from('org_members')
          .select('user_id')
          .eq('org_id', alert.org_id)
          .in('role', ['admin', 'staff']);

        if (membersErr || !members || members.length === 0) {
          emailError = `members_fetch_failed: ${membersErr?.message ?? 'no members'}`;
        } else {
          // Resolve user emails via admin auth API
          const memberIds: string[] = members.map((m: { user_id: string }) => m.user_id);
          // deno-lint-ignore no-explicit-any
          const { data: usersPage, error: usersErr } = await (admin.auth.admin as any).listUsers({
            perPage: 1000,
          });

          let emails: string[] = [];
          if (usersErr || !usersPage) {
            emailError = `users_fetch_failed: ${usersErr?.message ?? 'no data'}`;
          } else {
            const allUsers: Array<{ id: string; email?: string }> = usersPage.users ?? usersPage;
            emails = allUsers
              .filter((u) => memberIds.includes(u.id) && u.email)
              .map((u) => u.email as string);
          }

          if (emails.length > 0) {
            const payload = buildAlertEmailPayload({
              from: resendFrom,
              to: emails,
              orgName: org.name,
              orgSlug: org.slug,
              alertId: alert.id,
            });

            const res = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payload),
            });

            emailOk = res.ok;
            if (!res.ok) {
              try {
                emailError = (await res.text()).slice(0, 500);
              } catch {
                emailError = `resend_http_${res.status}`;
              }
            } else {
              try { await res.text(); } catch { /* drain */ }
            }
          } else {
            emailError = 'no_clinician_emails_resolved';
          }
        }
      }
    } catch (e) {
      emailError = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
    }
  }

  // ── (e) INSERT email delivery log (D-14 append-only) ───────────────────────
  await admin.from('clinician_alert_deliveries').insert({
    alert_id: alert.id,
    channel: 'email',
    success: emailOk,
    error: emailOk ? null : (emailError?.slice(0, 500) ?? null),
  });

  // ── (f) Bump retry_count + last_attempt_at (D-12) ──────────────────────────
  const newRetryCount = alert.retry_count + 1;
  const bothFailed = !realtimeOk && !emailOk;

  if (bothFailed && newRetryCount >= 3) {
    // D-12: 3rd consecutive failure → transition to delivery_failed
    await admin
      .from('clinician_alerts')
      .update({
        status: 'delivery_failed',
        retry_count: newRetryCount,
        last_attempt_at: new Date().toISOString(),
      })
      .eq('id', alert.id);

    Sentry.captureMessage('clinician_alert delivery_failed after 3 retries', {
      level: 'warning',
      tags: { alert_id: alert.id, org_id: alert.org_id },
    });
  } else {
    // D-12: bump retry_count + last_attempt_at; leave status=pending (clinician acts)
    await admin
      .from('clinician_alerts')
      .update({
        retry_count: newRetryCount,
        last_attempt_at: new Date().toISOString(),
      })
      .eq('id', alert.id);
  }

  const ok = realtimeOk || emailOk;
  return {
    alert_id: alert.id,
    ok,
    realtime_ok: realtimeOk,
    email_ok: emailOk,
    ...(ok ? {} : { error: `realtime: ${realtimeError ?? 'ok'}; email: ${emailError ?? 'ok'}` }),
  };
}

// ── Entry point ────────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? null;
  const resendFrom =
    Deno.env.get('RESEND_FROM') ?? 'LeanShot <noreply@app.leanshot.app>';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  // admin client via required helper (ESLint no-raw-service-role-client enforces this)
  // deno-lint-ignore no-explicit-any
  const admin = _createServiceRoleClientUnsafe() as any;

  // D-12: SELECT pending alerts WHERE retry_count < 3 AND
  //       (last_attempt_at IS NULL OR last_attempt_at < now() - 20 minutes)
  const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
  const { data: alerts, error: alertsErr } = await admin
    .from('clinician_alerts')
    .select('id, org_id, patient_user_id, alert_type, retry_count')
    .eq('status', 'pending')
    .lt('retry_count', 3)
    .or(`last_attempt_at.is.null,last_attempt_at.lt.${twentyMinAgo.toISOString()}`);

  if (alertsErr) {
    Sentry.captureException(alertsErr, {
      tags: { cron: 'clinician-alert-deliver', stage: 'alerts_query' },
    });
    return new Response(
      JSON.stringify({ ok: false, error: 'alerts_query_failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const pendingAlerts: PendingAlert[] = alerts ?? [];

  const results = await runDeliverCron({
    admin,
    alerts: pendingAlerts,
    resendApiKey,
    resendFrom,
    supabaseUrl,
    supabaseAnonKey,
  });

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  return new Response(
    JSON.stringify({
      ok: true,
      processed: results.length,
      succeeded,
      failed,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
