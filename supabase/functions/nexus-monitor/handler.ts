/**
 * nexus-monitor — handler.ts
 *
 * Phase 65 Plan 65-08 (PAY-04).
 *
 * Daily cron-driven Edge Fn. Refreshes the tax_nexus_state_revenue matview,
 * joins it against tax_nexus_thresholds, and fires Slack alerts when any state
 * crosses 80% (at_risk) or 100% (nexus_established, "Registration required")
 * of its economic-nexus threshold.
 *
 * === Endpoints ===
 * GET /healthz → 200 { ok: true, fn: "nexus-monitor" }
 * POST /       → service-role bearer required → refresh + classify + alert
 *
 * === Auth ===
 * `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (constant-time compare).
 * GET /healthz is exempt.
 *
 * === Tier classification (proximity = revenue / threshold * 100) ===
 *   < 60                       → safe              (no alert)
 *   ≥ 60 and < 80              → monitoring        (Slack info)
 *   ≥ 80 and < 100             → at_risk           (Slack warning)
 *   ≥ 100                      → nexus_established (Slack CRITICAL, "Registration required")
 *
 * === Idempotency ===
 * `nexus_alert_log` 23h de-dup gate keyed on (state, alert_tier, alerted_at).
 * Alert log row is recorded AFTER firing the Slack webhook, EVEN IF Slack
 * delivery fails (so retries are still gated and we never spam Slack).
 *
 * === Threats mitigated ===
 *   T-65-08-01 Tampering (matview poisoning) — refresh_nexus_revenue RPC is
 *     SECDEF + service_role only.
 *   T-65-08-02 Repudiation (missed deadline)  — nexus_alert_log audit trail.
 *   T-65-08-03 DoS (Slack spam)               — 23h de-dup gate.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

// ─── Constant-time string compare ────────────────────────────────────────────

function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NexusMonitorDeps {
  /** Fetch implementation (mockable in tests) */
  fetchImpl: typeof fetch;
  /** Supabase service-role client */
  supabaseServiceClient: ReturnType<typeof createClient> | SupabaseLike;
  /** Service-role key for bearer auth check */
  serviceRoleKey: string;
  /** Supabase project URL (used for admin dashboard links) */
  supabaseUrl: string;
  /** Slack guardrail webhook URL (SLACK_GUARDRAIL_WEBHOOK_URL secret) */
  slackWebhookUrl: string;
  /** Tier thresholds (defaults: 60 / 80 / 100) */
  alertThresholds?: { monitoring: number; at_risk: number; nexus_established: number };
}

interface ProximityRow {
  state: string;
  state_name: string;
  threshold_amount_cents: number;
  revenue_cents: number;
  proximity_percent: number;
}

type AlertTier = 'safe' | 'monitoring' | 'at_risk' | 'nexus_established';
type SlackTier = Exclude<AlertTier, 'safe'>;

// ─── Tier classification ─────────────────────────────────────────────────────

function classifyTier(
  proximity: number,
  thresholds: { monitoring: number; at_risk: number; nexus_established: number },
): AlertTier {
  if (proximity >= thresholds.nexus_established) return 'nexus_established';
  if (proximity >= thresholds.at_risk) return 'at_risk';
  if (proximity >= thresholds.monitoring) return 'monitoring';
  return 'safe';
}

// ─── Slack payload builder ───────────────────────────────────────────────────

function dollarsFromCents(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

const TIER_COLOR: Record<SlackTier, string> = {
  monitoring: '#3B82F6', // blue info
  at_risk: '#F59E0B', // yellow warning
  nexus_established: '#EF4444', // red critical
};

function buildSlackPayload(row: ProximityRow, tier: SlackTier): Record<string, unknown> {
  const proximityRounded = Math.round(row.proximity_percent * 100) / 100;
  const thresholdDollars = dollarsFromCents(row.threshold_amount_cents);
  const revenueDollars = dollarsFromCents(row.revenue_cents);

  let title: string;
  let text: string;
  if (tier === 'monitoring') {
    title = `Nexus monitoring: ${row.state_name} (${row.state}) at ${proximityRounded}%`;
    text = `${row.state_name} (${row.state}) is at ${proximityRounded}% of the ${thresholdDollars} economic-nexus threshold. Review at /admin/tax.`;
  } else if (tier === 'at_risk') {
    title = `Nexus AT RISK: ${row.state_name} (${row.state}) at ${proximityRounded}%`;
    text = `${row.state_name} (${row.state}) is at ${proximityRounded}% of threshold (${revenueDollars} / ${thresholdDollars}). Review at /admin/tax.`;
  } else {
    title = `🚨 NEXUS ESTABLISHED: ${row.state_name} (${row.state}) at ${proximityRounded}%`;
    text = `🚨 NEXUS ESTABLISHED: ${row.state_name} (${row.state}) at ${proximityRounded}% — REGISTRATION REQUIRED. Stripe Tax registration in ${row.state_name} must be completed within 30 days. Review at /admin/tax.`;
  }

  return {
    attachments: [
      {
        color: TIER_COLOR[tier],
        title,
        text,
        fields: [
          { title: 'State', value: `${row.state_name} (${row.state})`, short: true },
          { title: 'Proximity', value: `${proximityRounded}%`, short: true },
          { title: 'Revenue (trailing 365d)', value: revenueDollars, short: true },
          { title: 'Threshold', value: thresholdDollars, short: true },
          { title: 'Tier', value: tier, short: true },
        ],
      },
    ],
  };
}

// ─── 23h de-dup gate ─────────────────────────────────────────────────────────

async function hasRecentAlert(
  supabaseClient: SupabaseLike,
  state: string,
  alertTier: SlackTier,
): Promise<boolean> {
  const cutoffIso = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
  try {
    const builder = supabaseClient
      .from('nexus_alert_log')
      .select('id')
      .eq('state', state)
      .eq('alert_tier', alertTier)
      .gt('alerted_at', cutoffIso)
      .limit(1);
    const { data, error } = await builder.maybeSingle();
    if (error) {
      console.warn('[nexus-monitor] de-dup query error:', error);
      // Fail-open on the gate: if we cannot query, do NOT fire (avoid spam during outages).
      // Returning `true` skips the alert.
      return true;
    }
    return !!data;
  } catch (err) {
    console.warn('[nexus-monitor] de-dup query threw:', err);
    return true;
  }
}

async function recordAlertLog(
  supabaseClient: SupabaseLike,
  row: ProximityRow,
  alertTier: SlackTier,
  slackMessageTs: string | null,
): Promise<void> {
  try {
    const insertBuilder = supabaseClient.from('nexus_alert_log').insert({
      state: row.state,
      alert_tier: alertTier,
      revenue_cents: row.revenue_cents,
      threshold_amount_cents: row.threshold_amount_cents,
      proximity_percent: Math.round(row.proximity_percent * 100) / 100,
      slack_message_ts: slackMessageTs,
    });
    if (insertBuilder && typeof insertBuilder.select === 'function') {
      await insertBuilder.select();
    } else {
      await insertBuilder;
    }
  } catch (err) {
    console.error('[nexus-monitor] alert_log insert failed:', err);
  }
}

// ─── Slack send ──────────────────────────────────────────────────────────────

async function fireSlackAlert(
  fetchImpl: typeof fetch,
  slackWebhookUrl: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; ts: string | null }> {
  try {
    const res = await fetchImpl(slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch { /* ignore */ }
      console.warn(`[nexus-monitor] Slack POST failed status=${res.status} body=${body.slice(0, 200)}`);
      return { ok: false, ts: null };
    }
    // Slack-incoming-webhooks returns "ok" body (not JSON with ts), but a future
    // chat.postMessage migration would surface ts. Best-effort read:
    let ts: string | null = null;
    try {
      const json = await res.json();
      if (json && typeof json === 'object' && 'ts' in json) ts = String((json as Record<string, unknown>).ts);
    } catch {
      /* webhooks return plain "ok" — not an error */
    }
    return { ok: true, ts };
  } catch (err) {
    console.warn('[nexus-monitor] Slack POST threw:', err);
    return { ok: false, ts: null };
  }
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function handle(req: Request, deps: NexusMonitorDeps): Promise<Response> {
  const url = new URL(req.url);

  // ── GET /healthz ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    return new Response(
      JSON.stringify({ ok: true, fn: 'nexus-monitor' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Only POST from here ──────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Auth: service-role bearer (constant-time compare) ────────────────────
  const bearerHeader = req.headers.get('Authorization') ?? '';
  const bearer = bearerHeader.startsWith('Bearer ') ? bearerHeader.slice(7) : '';
  if (!constantTimeEqual(bearer, deps.serviceRoleKey)) {
    return new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Slack webhook guard: no point running without alert channel ──────────
  if (!deps.slackWebhookUrl) {
    console.error('[nexus-monitor] BLOCKED: SLACK_GUARDRAIL_WEBHOOK_URL not configured');
    return new Response(
      JSON.stringify({ error: 'slack_webhook_unset' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const thresholds = deps.alertThresholds ?? { monitoring: 60, at_risk: 80, nexus_established: 100 };

  // ── Refresh matview (SECDEF RPC: REFRESH MATERIALIZED VIEW CONCURRENTLY) ─
  const refreshRes = await deps.supabaseServiceClient.rpc('refresh_nexus_revenue');
  if (refreshRes && refreshRes.error) {
    console.error('[nexus-monitor] refresh_nexus_revenue RPC error:', refreshRes.error);
    return new Response(
      JSON.stringify({ error: 'refresh_failed', detail: refreshRes.error.message ?? 'unknown' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Query proximity (SECDEF RPC: joins thresholds + matview) ────────────
  const proxBuilder = deps.supabaseServiceClient.rpc('get_nexus_proximity');
  const { data: proximityRows, error: proxError } = await (typeof proxBuilder.select === 'function'
    ? proxBuilder.select()
    : proxBuilder);

  if (proxError) {
    console.error('[nexus-monitor] get_nexus_proximity RPC error:', proxError);
    return new Response(
      JSON.stringify({ error: 'proximity_query_failed', detail: proxError.message ?? 'unknown' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const rows: ProximityRow[] = (proximityRows ?? []) as ProximityRow[];

  let alerts_fired = 0;
  let alerts_skipped = 0;
  const errors: string[] = [];

  // ── Per-state classification + dispatch ─────────────────────────────────
  for (const row of rows) {
    const tier = classifyTier(row.proximity_percent, thresholds);
    if (tier === 'safe') continue;

    // 23h de-dup gate
    const recent = await hasRecentAlert(deps.supabaseServiceClient, row.state, tier);
    if (recent) {
      alerts_skipped++;
      continue;
    }

    // Fire Slack alert
    const payload = buildSlackPayload(row, tier);
    const { ok, ts } = await fireSlackAlert(deps.fetchImpl, deps.slackWebhookUrl, payload);
    if (!ok) {
      errors.push(`slack_send_failed:${row.state}:${tier}`);
    }

    // Record alert_log row regardless of Slack outcome — so retries are still gated.
    await recordAlertLog(deps.supabaseServiceClient, row, tier, ts);

    if (ok) {
      alerts_fired++;
    } else {
      // We count Slack-failed sends as fired-for-accounting (they consumed the 23h gate).
      // The errors[] array surfaces them to the operator response.
      alerts_fired++;
    }
  }

  return new Response(
    JSON.stringify({
      refreshed: true,
      states_checked: rows.length,
      alerts_fired,
      alerts_skipped,
      errors,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
