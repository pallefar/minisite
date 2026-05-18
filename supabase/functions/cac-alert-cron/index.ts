/**
 * cac-alert-cron — Phase 33 D-13/D-14/D-15
 *
 * Daily cron (00:30 UTC) — evaluates 7d rolling CAC against growth targets
 * and fires cac_alerts for breaches.
 *
 * Flow:
 *   1. Fetch enabled rows from growth_targets
 *   2. For each target: call get_cac_summary RPC over the last 7 days
 *   3. Compute 7d CAC: sum(spend_usd) / sum(attributed_conversions)
 *      → skip if conversions = 0 (avoid division by zero)
 *   4. Compare to threshold: target_ltv_usd * cac_multiplier
 *   5. If CAC > threshold:
 *      - Upsert cac_alerts ON CONFLICT idempotency_key DO NOTHING
 *        (idempotency_key = source|YYYY-MM-DD — composite key UNIQUE)
 *      - If NEW alert (upsert returned data): captureServer + writeAdminNotification
 *   6. Return {ok, targets_evaluated, alerts_fired}
 *
 * Auth: service-role bearer (cron, --no-verify-jwt).
 *
 * SYSTEM CRON NOTE: captureServer is called with userId='system'.
 * CAC alerts are system events not tied to a specific user.
 * 'system' is a reserved non-UUID sentinel per PostHog cron convention (D-13
 * normally requires auth.users.id; system crons use 'system' as distinct_id).
 *
 * Idempotency: ON CONFLICT idempotency_key DO NOTHING ensures re-runs on
 * same alert_date produce at-most-one alert row per (source, date).
 */
import { captureServer as _captureServer, shutdownPostHog as _shutdownPostHog } from '../_shared/posthog-server.ts';
import { writeAdminNotification } from '../_shared/ad-etl-utils.ts';
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Admin singleton
// ---------------------------------------------------------------------------
const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

// ---------------------------------------------------------------------------
// Injectable posthog functions for testing
// ---------------------------------------------------------------------------
type CaptureServerFn = (args: { userId: string; event: string; properties?: Record<string, unknown> }) => void;
type ShutdownPostHogFn = () => Promise<void>;

let _captureServerImpl: CaptureServerFn = _captureServer;
let _shutdownPostHogImpl: ShutdownPostHogFn = _shutdownPostHog;

function setCaptureServerForTest(fn: CaptureServerFn): void {
  _captureServerImpl = fn;
}

function resetCaptureServerForTest(): void {
  _captureServerImpl = _captureServer;
}

function setShutdownPostHogForTest(fn: ShutdownPostHogFn): void {
  _shutdownPostHogImpl = fn;
}

function resetShutdownPostHogForTest(): void {
  _shutdownPostHogImpl = _shutdownPostHog;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface GrowthTarget {
  source: string;
  target_ltv_usd: number;
  cac_multiplier: number;
  enabled: boolean;
}

interface CacSummaryRow {
  network: string;
  ad_account_id: string;
  ad_id: string;
  campaign_id: string;
  spend_date: string;
  spend_usd_at_spend_date: number;
  clicks: number;
  impressions: number;
  attributed_conversions: number;
  cac_usd: number;
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------
export async function handleRun(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const adminClient = admin as unknown as SupabaseClient;

  // Date range: today and 7 days ago (UTC)
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Fetch enabled growth targets
  // deno-lint-ignore no-explicit-any
  const { data: targetsData, error: targetsError } = (await (adminClient
    .from('growth_targets')
    .select('*')
    .eq('enabled', true) as unknown)) as {
      data: GrowthTarget[] | null;
      error: { message?: string } | null;
    };

  if (targetsError) {
    console.warn(`[cac-alert-cron] growth_targets query failed: ${targetsError.message ?? 'unknown'}`);
    return jsonResponse(200, { ok: false, error: 'growth_targets_query_failed', targets_evaluated: 0, alerts_fired: 0 });
  }

  const targets = targetsData ?? [];
  let alertsFired = 0;

  for (const target of targets) {
    // Determine source filter
    const capiSource = target.source === 'all' ? null : target.source;

    // Get 7d CAC summary
    // deno-lint-ignore no-explicit-any
    const { data: cacData, error: cacError } = (await (adminClient.rpc('get_cac_summary', {
      p_source: capiSource,
      p_start_date: sevenDaysAgo,
      p_end_date: today,
    }) as unknown)) as {
      data: CacSummaryRow[] | null;
      error: { message?: string } | null;
    };

    if (cacError) {
      console.warn(`[cac-alert-cron] get_cac_summary failed for source=${target.source}: ${cacError.message ?? 'unknown'}`);
      continue;
    }

    const rows = cacData ?? [];

    // Compute 7d rolling CAC
    const totalSpend = rows.reduce((sum, r) => sum + (r.spend_usd_at_spend_date ?? 0), 0);
    const totalConversions = rows.reduce((sum, r) => sum + (r.attributed_conversions ?? 0), 0);

    if (totalConversions === 0) {
      // Cannot compute meaningful CAC — skip to avoid division by zero
      continue;
    }

    const cac7dUsd = totalSpend / totalConversions;
    const threshold = target.target_ltv_usd * target.cac_multiplier;

    if (cac7dUsd <= threshold) {
      // No breach — within acceptable range
      continue;
    }

    const breachRatio = cac7dUsd / threshold;
    const idempotencyKey = `${target.source}|${today}`;

    // Upsert alert — ON CONFLICT idempotency_key DO NOTHING
    // deno-lint-ignore no-explicit-any
    const { data: insertedData, error: upsertError } = (await (adminClient
      .from('cac_alerts')
      .upsert(
        {
          source: target.source,
          alert_date: today,
          cac_7d_usd: cac7dUsd,
          target_ltv_usd: target.target_ltv_usd,
          breach_ratio: breachRatio,
          idempotency_key: idempotencyKey,
        },
        { onConflict: 'idempotency_key', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle() as unknown)) as {
        data: { id: string } | null;
        error: { message?: string } | null;
      };

    if (upsertError) {
      console.warn(`[cac-alert-cron] cac_alerts upsert failed source=${target.source}: ${upsertError.message ?? 'unknown'}`);
      continue;
    }

    if (!insertedData) {
      // ON CONFLICT fired — duplicate alert for this (source, date), skip notifications
      continue;
    }

    // New alert: emit PostHog event + admin notification
    alertsFired += 1;

    // captureServer with system sentinel userId (D-13 CAC crons use 'system' as distinct_id)
    _captureServerImpl({
      userId: 'system',
      event: 'cac_target_breached',
      properties: {
        source: target.source,
        cac_7d_usd: cac7dUsd,
        target_ltv_usd: target.target_ltv_usd,
        breach_ratio: breachRatio,
        date: today,
      },
    });

    await writeAdminNotification(adminClient, {
      title: 'CAC Alert',
      body: `${target.source} CAC $${cac7dUsd.toFixed(2)} exceeds threshold $${threshold.toFixed(2)} (breach ratio ${breachRatio.toFixed(2)}x)`,
      type: 'cac_alert',
    });
  }

  return jsonResponse(200, {
    ok: true,
    targets_evaluated: targets.length,
    alerts_fired: alertsFired,
  });
}

/**
 * Wraps handleRun with shutdownPostHog in finally block.
 * Used by Deno.serve and exposed for testing the finally-path.
 */
export async function handleRunWithFinally(req: Request): Promise<Response> {
  try {
    return await handleRun(req);
  } catch (e) {
    console.warn('[cac-alert-cron] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  } finally {
    await _shutdownPostHogImpl();
  }
}

// ---------------------------------------------------------------------------
// Deno.serve entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
  return await handleRunWithFinally(req);
});

export const __internal = {
  handleRun,
  handleRunWithFinally,
  setAdminForTest,
  resetAdminForTest,
  setCaptureServerForTest,
  resetCaptureServerForTest,
  setShutdownPostHogForTest,
  resetShutdownPostHogForTest,
};
