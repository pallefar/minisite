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
  /** Phase 51 / Plan 51-04 — per (channel_group × audience × stage_pair) scan counters. */
  channel_stage_checked: number;
  channel_stage_fired: number;
  channel_stage_suppressed: number;
}

// =============================================================================
// Phase 51 / Plan 51-04 — Per-channel-stage anomaly scan extension.
// Decision refs: D-06 / D-08. Requirements: TRAFFIC-11.
//
// Reads channel_groups taxonomy, fans out (channel_group × audience × stage_pair),
// calls compute_channel_stage_rate RPC, writes admin_notifications rows with a
// multi-dimensional dedup_key. Pure-additive: existing per-funnel loop is
// untouched and runs first; this new loop runs serially AFTER it.
// =============================================================================

type TrafficAudience = 'consumer' | 'clinic-org' | 'affiliate';

const TRAFFIC_AUDIENCES: readonly TrafficAudience[] = [
  'consumer',
  'clinic-org',
  'affiliate',
] as const;

// Mirror of migration 20271102000009 stage_pairs VALUES list — must stay in sync
// with the traffic_funnel_rollup matview definition.
const TRAFFIC_STAGE_PAIRS: Record<TrafficAudience, ReadonlyArray<readonly [string, string]>> = {
  'consumer': [
    ['visit', 'signup'],
    ['signup', 'activation'],
    ['activation', 'paid'],
  ],
  'clinic-org': [
    ['visit', 'clinic_signup'],
    ['clinic_signup', 'first_patient_added'],
    ['first_patient_added', 'first_paid_seat'],
  ],
  'affiliate': [
    ['visit', 'affiliate_signup'],
    ['affiliate_signup', 'first_referral_conversion'],
  ],
};

const TRAFFIC_FUNNEL_DROP_KIND = 'traffic_funnel_drop';
const TRAFFIC_FUNNEL_SIGMA_THRESHOLD = 2; // 2σ — mirrors per-funnel default
const TRAFFIC_FUNNEL_SUPPRESSION_MS = 4 * 60 * 60 * 1000; // 4h — mirrors per-funnel

interface ChannelStageRateRow {
  observed_rate: number | string | null;
  expected_rate: number | string | null;
  expected_stddev: number | string | null;
}

interface ChannelGroupRow {
  label: string;
}

function numOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function runTrafficFunnelAnomalyScan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  result: RunResult,
  now: Date,
): Promise<void> {
  // 1. Enumerate channel_groups (operator-editable taxonomy).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: channelGroupsData, error: cgErr } = (await (adminClient
    .from('channel_groups')
    .select('label')
    .order('priority', { ascending: true }) as any)) as {
      data: ChannelGroupRow[] | null;
      error: { message?: string } | null;
    };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (cgErr) {
    console.warn('[funnel-anomaly-cron] channel_groups read failed', cgErr.message ?? 'unknown');
    return;
  }
  const channelGroups = channelGroupsData ?? [];
  if (channelGroups.length === 0) return;

  const today = now.toISOString().slice(0, 10);
  const fourHrAgo = new Date(now.getTime() - TRAFFIC_FUNNEL_SUPPRESSION_MS).toISOString();

  for (const cg of channelGroups) {
    for (const audience of TRAFFIC_AUDIENCES) {
      const pairs = TRAFFIC_STAGE_PAIRS[audience];
      for (const [stageIn, stageOut] of pairs) {
        result.channel_stage_checked += 1;

        // 2. Compute per (channel × audience × stage_pair) baseline + today.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const { data: rateData, error: rateErr } = (await (adminClient.rpc(
          'compute_channel_stage_rate',
          {
            p_channel_group: cg.label,
            p_audience: audience,
            p_stage_in: stageIn,
            p_stage_out: stageOut,
            p_window_days: 7,
          },
        ) as any)) as {
          data: ChannelStageRateRow[] | ChannelStageRateRow | null;
          error: { message?: string } | null;
        };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        if (rateErr) {
          console.warn(
            `[funnel-anomaly-cron] compute_channel_stage_rate failed channel=${cg.label} audience=${audience} stages=${stageIn}->${stageOut}`,
            rateErr.message ?? 'unknown',
          );
          continue;
        }
        const row: ChannelStageRateRow | null = Array.isArray(rateData)
          ? (rateData[0] ?? null)
          : (rateData ?? null);
        if (!row) continue;
        const observed = numOrNull(row.observed_rate);
        const expected = numOrNull(row.expected_rate);
        const stddev = numOrNull(row.expected_stddev);
        if (observed === null || expected === null || stddev === null) continue;
        if (stddev === 0 || expected === 0) continue; // not enough baseline

        const sigmas = (expected - observed) / stddev;
        if (!Number.isFinite(sigmas)) continue;
        if (sigmas < TRAFFIC_FUNNEL_SIGMA_THRESHOLD) continue; // not anomalous

        // 3. Multi-dimensional dedup key per plan must_haves.
        const dedupKey =
          `${TRAFFIC_FUNNEL_DROP_KIND}:${cg.label}:${audience}:${stageIn}_${stageOut}:${today}`;

        // 4. 4h suppression — mirror existing per-funnel pattern.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const { data: recentRows } = (await (adminClient
          .from('admin_notifications')
          .select('id')
          .eq('dedup_key', dedupKey)
          .gte('created_at', fourHrAgo)
          .limit(1) as any)) as {
            data: Array<{ id: string }> | null;
            error: { message?: string } | null;
          };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        if (recentRows && recentRows.length > 0) {
          result.channel_stage_suppressed += 1;
          continue;
        }

        // 5. Idempotent upsert (onConflict:dedup_key, ignoreDuplicates) — if
        //    the admin_notifications.kind widening migration has not been
        //    pushed yet, this raises a CHECK violation; we log + continue so
        //    the per-funnel loop's results still propagate.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const { error: insErr } = (await (adminClient
          .from('admin_notifications')
          .upsert(
            {
              kind: TRAFFIC_FUNNEL_DROP_KIND,
              dedup_key: dedupKey,
              // Map to legacy columns too so existing P27 admin UI surfaces
              // these rows without code changes.
              type: TRAFFIC_FUNNEL_DROP_KIND,
              title: `Traffic funnel drop: ${cg.label} / ${audience}`,
              body:
                `${stageIn} → ${stageOut} dropped ${sigmas.toFixed(2)}σ ` +
                `(observed ${(observed * 100).toFixed(2)}% vs expected ${(expected * 100).toFixed(2)}%).`,
              payload: {
                channel_group: cg.label,
                audience,
                funnel: audience,
                stage_in: stageIn,
                stage_out: stageOut,
                observed_rate: observed,
                expected_rate: expected,
                expected_stddev: stddev,
                sigmas,
                date: today,
              },
            },
            { onConflict: 'dedup_key', ignoreDuplicates: true },
          ) as any)) as { error: { message?: string } | null };
        /* eslint-enable @typescript-eslint/no-explicit-any */
        if (insErr) {
          console.warn(
            `[funnel-anomaly-cron] admin_notifications upsert failed channel=${cg.label} audience=${audience} stages=${stageIn}->${stageOut}`,
            insErr.message ?? 'unknown',
          );
          continue;
        }
        result.channel_stage_fired += 1;
      }
    }
  }
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
    channel_stage_checked: 0,
    channel_stage_fired: 0,
    channel_stage_suppressed: 0,
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

  // Phase 51 / Plan 51-04 — Per (channel_group × audience × stage_pair) scan.
  // Runs SERIALLY after the existing per-funnel loop. Errors are logged + the
  // cron tick still returns 200 with whatever counters succeeded — same
  // tolerance posture as the per-funnel loop above.
  try {
    await runTrafficFunnelAnomalyScan(admin, result, now);
  } catch (e) {
    console.warn(
      '[funnel-anomaly-cron] traffic-funnel-anomaly scan threw',
      e instanceof Error ? e.message : 'unknown',
    );
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
