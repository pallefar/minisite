/**
 * `funnel-anomaly-cron` Edge Function — Phase 27 plan 27-04 (TAXO-05 + SC#5).
 *
 * Cron-invoked every 5 minutes (see migration 20260601000035). For each
 * enabled row in public.anomaly_tracked_funnels:
 *
 *   1. Call public.funnel_anomaly_baseline_compute(event_name) SECDEF function
 *      → returns {observed_count, expected_mean, expected_stddev, z_score}.
 *   2. If z_score < -funnel.sigma_threshold → candidate anomaly.
 *   3. 4h suppression check (D-18): SELECT max(fired_at) from
 *      funnel_anomaly_alerts where funnel_id=...; if (now - last < 4h) → skip.
 *   4. .upsert({onConflict:'funnel_id,tick_bucket', ignoreDuplicates:true})
 *      — per-minute idempotency (Pattern S9). Re-fire within same minute = no-op.
 *   5. On NEW insert (returned row id non-null):
 *        - Realtime broadcast: supabase.channel('funnel_anomaly_alerts').send(
 *            {type:'broadcast', event:'anomaly_fired', payload:{...}})
 *          Payload is non-PHI by design (T-27-04-03): no user_id, no event
 *          properties — only metric numbers + IDs + timestamp.
 *        - Vendor-gated email: resendDomainHealthCheck() → if verified,
 *          sendResendEmail to SUPERADMIN_ALERTS_EMAIL; else 200 + skipped.
 *          (sendRoutedEmail from Phase 25 email-router preferred; falls back
 *          to sendResendEmail when Phase 25 module not present.)
 *   6. Returns jsonResponse({checked:N, fired:M, suppressed:K, emails_sent:E}).
 *
 * Auth: service-role bearer (cron + --no-verify-jwt). checkServiceRoleBearer
 * via _shared/lifecycle-utils per Pattern S6.
 *
 * Idempotency belt-and-suspenders:
 *   - INNER: UNIQUE(funnel_id, tick_bucket) on funnel_anomaly_alerts
 *     (migration 20260601000032) — re-fire within same minute = no-op.
 *   - OUTER: 4h same-funnel suppression check (D-18) — alert storm cap.
 *
 * Vendor-gating per Pattern S5: cron tick is a no-op success when Resend
 * domain unverified. Cutover at vendor verify = zero code changes.
 */
import { resendDomainHealthCheck } from '../_shared/resend-domain-health-check.ts';
import { sendResendEmail } from '../_shared/lifecycle-send.ts';
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

const SUPPRESSION_MS = 4 * 60 * 60 * 1000; // 4 hours per D-18

interface TrackedFunnel {
  funnel_id: string;
  event_name: string;
  is_enabled: boolean;
  sigma_threshold: number;
}

interface BaselineRow {
  observed_count: number;
  expected_mean: number;
  expected_stddev: number;
  z_score: number;
}

interface AlertInsertRow {
  id: string;
  funnel_id: string;
  fired_at: string;
  observed_count: number;
  expected_mean: number;
  expected_stddev: number;
  z_score: number;
}

interface RunResult {
  checked: number;
  fired: number;
  suppressed: number;
  emails_sent: number;
  email_skipped_unverified: boolean;
}

function tickBucket(now: Date): string {
  // date_trunc('minute', now) — ISO seconds + ms zeroed.
  const iso = now.toISOString();
  return iso.slice(0, 16) + ':00.000Z';
}

/**
 * Attempt to resolve Phase 25's sendRoutedEmail dynamically. Returns null if
 * the module is not yet present on main (Phase 25 may ship after this plan).
 * Per [[reference_vendor_gated_send_health_check]] — fall back to direct
 * sendResendEmail with non-PHI payload.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadRoutedEmail(): Promise<((args: any) => Promise<{ ok: boolean }>) | null> {
  try {
    const mod = (await import('../_shared/email-router.ts')) as {
      sendRoutedEmail?: (args: unknown) => Promise<{ ok: boolean }>;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (mod.sendRoutedEmail ?? null) as any;
  } catch {
    return null;
  }
}

function formatAlertEmail(payload: {
  funnel_name: string;
  observed_count: number;
  expected_mean: number;
  expected_stddev: number;
  z_score: number;
  fired_at: string;
  alert_id: string;
  ack_url: string;
}): { subject: string; html: string; text: string } {
  const subject = `[LeanShot anomaly] ${payload.funnel_name} z=${payload.z_score.toFixed(2)}`;
  const text =
    `Funnel anomaly detected:\n\n` +
    `  Funnel:          ${payload.funnel_name}\n` +
    `  Observed (24h):  ${payload.observed_count}\n` +
    `  Expected mean:   ${payload.expected_mean.toFixed(2)}\n` +
    `  Expected stddev: ${payload.expected_stddev.toFixed(2)}\n` +
    `  z-score:         ${payload.z_score.toFixed(2)}\n` +
    `  Fired at:        ${payload.fired_at}\n` +
    `  Alert ID:        ${payload.alert_id}\n\n` +
    `Acknowledge: ${payload.ack_url}\n`;
  const html =
    `<p><strong>Funnel anomaly detected.</strong></p>` +
    `<ul>` +
    `<li>Funnel: <code>${payload.funnel_name}</code></li>` +
    `<li>Observed (24h): <strong>${payload.observed_count}</strong></li>` +
    `<li>Expected mean: ${payload.expected_mean.toFixed(2)}</li>` +
    `<li>Expected stddev: ${payload.expected_stddev.toFixed(2)}</li>` +
    `<li>z-score: <strong>${payload.z_score.toFixed(2)}</strong></li>` +
    `<li>Fired at: ${payload.fired_at}</li>` +
    `<li>Alert ID: <code>${payload.alert_id}</code></li>` +
    `</ul>` +
    `<p><a href="${payload.ack_url}">Acknowledge in admin queue</a></p>`;
  return { subject, html, text };
}

async function handleRun(_req: Request): Promise<Response> {
  const result: RunResult = {
    checked: 0,
    fired: 0,
    suppressed: 0,
    emails_sent: 0,
    email_skipped_unverified: false,
  };

  // 1. Enumerate enabled funnels.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: funnelsData, error: funnelsErr } = (await (admin
    .from('anomaly_tracked_funnels')
    .select('funnel_id, event_name, is_enabled, sigma_threshold')
    .eq('is_enabled', true) as any)) as {
      data: TrackedFunnel[] | null;
      error: { message?: string } | null;
    };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (funnelsErr) {
    console.warn('[funnel-anomaly-cron] tracked-funnels query failed', funnelsErr.message);
    return jsonResponse(200, { ok: false, error: 'tracked_funnels_query_failed', ...result });
  }
  const funnels = funnelsData ?? [];

  // 2. Resend health check (Pattern S5 — vendor-gated email).
  const health = await resendDomainHealthCheck(admin);
  const resendVerified = health.ok;
  if (!resendVerified) {
    result.email_skipped_unverified = true;
  }

  // 3. Resolve Phase 25 sendRoutedEmail if present; else fall back to
  //    sendResendEmail directly (with non-PHI payload).
  const sendRouted = await loadRoutedEmail();
  const superadminEmail = Deno.env.get('SUPERADMIN_ALERTS_EMAIL') ?? '';
  const siteUrl = Deno.env.get('SITE_URL') ?? 'https://app.leanshot.app';

  const now = new Date();
  const bucket = tickBucket(now);

  for (const funnel of funnels) {
    result.checked += 1;

    // 4. Compute baseline.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: baselineData, error: baselineErr } = (await (admin.rpc(
      'funnel_anomaly_baseline_compute',
      { p_event_name: funnel.event_name },
    ) as any)) as {
      data: BaselineRow[] | BaselineRow | null;
      error: { message?: string } | null;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (baselineErr) {
      console.warn(
        `[funnel-anomaly-cron] baseline_compute failed funnel=${funnel.event_name} err=${baselineErr.message ?? 'unknown'}`,
      );
      continue;
    }
    const baseline: BaselineRow | null = Array.isArray(baselineData)
      ? (baselineData[0] ?? null)
      : (baselineData ?? null);
    if (!baseline) {
      continue;
    }

    // 5. Threshold check.
    if (baseline.z_score >= -funnel.sigma_threshold) {
      // Within baseline — no alert.
      continue;
    }

    // 6. 4h suppression check (D-18).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: lastAlertData } = (await (admin
      .from('funnel_anomaly_alerts')
      .select('fired_at')
      .eq('funnel_id', funnel.funnel_id)
      .order('fired_at', { ascending: false })
      .limit(1)
      .maybeSingle() as any)) as { data: { fired_at: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (lastAlertData) {
      const last = new Date(lastAlertData.fired_at).getTime();
      if (now.getTime() - last < SUPPRESSION_MS) {
        result.suppressed += 1;
        continue;
      }
    }

    // 7. Idempotent insert (Pattern S9 inner safety net).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: insertedData, error: insertErr } = (await (admin
      .from('funnel_anomaly_alerts')
      .upsert(
        {
          funnel_id: funnel.funnel_id,
          tick_bucket: bucket,
          observed_count: baseline.observed_count,
          expected_mean: baseline.expected_mean,
          expected_stddev: baseline.expected_stddev,
          z_score: baseline.z_score,
        },
        { onConflict: 'funnel_id,tick_bucket', ignoreDuplicates: true },
      )
      .select('id, funnel_id, fired_at, observed_count, expected_mean, expected_stddev, z_score')
      .maybeSingle() as any)) as {
        data: AlertInsertRow | null;
        error: { message?: string } | null;
      };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (insertErr) {
      console.warn(
        `[funnel-anomaly-cron] alert insert failed funnel=${funnel.event_name} err=${insertErr.message ?? 'unknown'}`,
      );
      continue;
    }
    if (!insertedData) {
      // Idempotency win — row already existed for this minute.
      continue;
    }

    result.fired += 1;

    // 8. Realtime broadcast (non-PHI payload per T-27-04-03).
    try {
      const channel = admin.channel('funnel_anomaly_alerts');
      await channel.subscribe();
      await channel.send({
        type: 'broadcast',
        event: 'anomaly_fired',
        payload: {
          funnel_id: insertedData.funnel_id,
          alert_id: insertedData.id,
          fired_at: insertedData.fired_at,
          observed_count: insertedData.observed_count,
          expected_mean: insertedData.expected_mean,
          expected_stddev: insertedData.expected_stddev,
          z_score: insertedData.z_score,
          funnel_name: funnel.event_name,
        },
      });
      // Best-effort cleanup; do not block on it.
      await admin.removeChannel(channel);
    } catch (e) {
      console.warn(
        `[funnel-anomaly-cron] broadcast failed funnel=${funnel.event_name} err=${e instanceof Error ? e.message : 'unknown'}`,
      );
    }

    // 9. Vendor-gated email send.
    if (!resendVerified || !superadminEmail) {
      continue;
    }
    const ackUrl = `${siteUrl}/admin/anomaly?ack=${encodeURIComponent(insertedData.id)}`;
    const emailPayload = {
      funnel_name: funnel.event_name,
      observed_count: insertedData.observed_count,
      expected_mean: insertedData.expected_mean,
      expected_stddev: insertedData.expected_stddev,
      z_score: insertedData.z_score,
      fired_at: insertedData.fired_at,
      alert_id: insertedData.id,
      ack_url: ackUrl,
    };
    try {
      if (sendRouted) {
        const dispatch = await sendRouted({
          to: superadminEmail,
          template: 'anomaly_alert',
          phi: false,
          payload: emailPayload,
        });
        if (dispatch?.ok) result.emails_sent += 1;
      } else {
        const rendered = formatAlertEmail(emailPayload);
        const dispatch = await sendResendEmail({
          to: superadminEmail,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        if (dispatch.ok) result.emails_sent += 1;
      }
    } catch (e) {
      console.warn(
        `[funnel-anomaly-cron] email send failed funnel=${funnel.event_name} err=${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  return jsonResponse(200, { ok: true, ...result });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
  try {
    return await handleRun(req);
  } catch (e) {
    console.warn('[funnel-anomaly-cron] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

export const __internal = { handleRun, setAdminForTest, resetAdminForTest };
