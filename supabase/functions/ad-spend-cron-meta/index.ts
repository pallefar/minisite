/**
 * `ad-spend-cron-meta` Edge Function — Phase 33 plan 33-03.
 *
 * Hourly cron that pulls ad-spend facts from the Meta Marketing API
 * (Graph API v25.0) and upserts them into `ad_spend_facts`.
 *
 * Key design decisions:
 * - D-01: Vendor-gated health-check. Returns 200 OK with
 *   `{ok:true, skipped:'credentials_missing'}` when META_ACCESS_TOKEN or
 *   META_AD_ACCOUNT_ID are absent. Allows deploy before Meta App Review completes.
 * - D-04: Replays last 72h on each tick (idempotent via ON CONFLICT).
 * - T-33-03-01: Never logs token values. Logs only `credentials_present: true/false`.
 * - T-33-03-02: checkServiceRoleBearer validates Bearer on every request.
 * - T-33-03-04: BUC header — log only numeric total_cputime + total_time.
 *
 * RESEARCH notes:
 * - breakdowns=hourly_stats_aggregated_by_advertiser_time_zone (NOT time_increment=1)
 * - reach + frequency are EXCLUDED (incompatible with hourly breakdown)
 * - Meta reports spend in the ad account's configured currency (assumed USD for v1.3)
 */
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
import {
  upsertAdSpendFacts,
  writeHealth,
  lookupFxRate,
  convertToUsd,
} from '../_shared/ad-etl-utils.ts';
import type { AdSpendRow } from '../_shared/ad-etl-utils.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

const NETWORK = 'meta' as const;
// Meta hourly breakdown: incompatible with reach/frequency fields — omitted intentionally.
const META_FIELDS = 'ad_id,ad_name,campaign_id,adset_id,spend,clicks,impressions,actions';
// Attribution window matches Meta standard 7d-click.
const META_ACTION_ATTRIBUTION_WINDOWS = '["7d_click"]';
const META_API_VERSION = 'v25.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// YYYY-MM-DD helper.
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface MetaInsightRow {
  ad_id: string;
  ad_name?: string;
  campaign_id?: string;
  adset_id?: string;
  spend: string;
  clicks: string;
  impressions: string;
  date_start: string;
  // hourly_stats_aggregated_by_advertiser_time_zone returns the hour slot as
  // 'YYYY-MM-DD HH:00:00+00:00' or similar — stored in hourly_stats_aggregated_by_advertiser_time_zone field.
  hourly_stats_aggregated_by_advertiser_time_zone?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

interface MetaPage {
  data: MetaInsightRow[];
  paging?: {
    next?: string;
    cursors?: { before: string; after: string };
  };
}

/** Parse x-business-use-case-usage header. Log only numeric values per T-33-03-04. */
function parseBucHeader(headerVal: string | null): { total_cputime: number; total_time: number } | null {
  if (!headerVal) return null;
  try {
    const parsed = JSON.parse(headerVal) as Record<string, Array<{ total_cputime: number; total_time: number; call_count: number }>>;
    // BUC header is a map of app_id → array of usage objects. Take the first entry.
    const entries = Object.values(parsed).flat();
    if (!entries.length) return null;
    const total_cputime = entries.reduce((acc, e) => Math.max(acc, e.total_cputime ?? 0), 0);
    const total_time = entries.reduce((acc, e) => Math.max(acc, e.total_time ?? 0), 0);
    return { total_cputime, total_time };
  } catch {
    return null;
  }
}

/** Extract conversion count from actions array (7d_click). */
function extractConversions(actions?: Array<{ action_type: string; value: string }>): number {
  if (!actions?.length) return 0;
  const conv = actions.find((a) => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
  return conv ? Number(conv.value) : 0;
}

export async function runMetaETL(
  adminClient: SupabaseClient,
  token: string,
  accountId: string,
): Promise<{ rows_upserted: number }> {
  const now = new Date();
  const since = toDateStr(new Date(now.getTime() - 72 * 60 * 60 * 1000));
  const until = toDateStr(now);

  const params = new URLSearchParams({
    fields: META_FIELDS,
    level: 'ad',
    breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
    time_range: JSON.stringify({ since, until }),
    action_attribution_windows: META_ACTION_ATTRIBUTION_WINDOWS,
    limit: '100',
    access_token: token,
  });

  let nextUrl: string | null =
    `${META_BASE_URL}/act_${accountId}/insights?${params.toString()}`;
  let totalUpserted = 0;

  while (nextUrl) {
    const resp = await fetch(nextUrl);

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`meta_api_error: status=${resp.status} body=${body.slice(0, 200)}`);
    }

    // T-33-03-04: parse and log only numeric values from BUC header.
    const buc = parseBucHeader(resp.headers.get('x-business-use-case-usage'));
    if (buc && (buc.total_cputime > 80 || buc.total_time > 80)) {
      console.warn(
        `[ad-spend-cron-meta] BUC throttle warning: total_cputime=${buc.total_cputime} total_time=${buc.total_time}. Breaking pagination early.`,
      );
      break;
    }

    const page = (await resp.json()) as MetaPage;
    const insightRows = page.data ?? [];

    const rows: AdSpendRow[] = [];
    for (const row of insightRows) {
      const spendDate = row.date_start ?? since;
      const spendLocal = parseFloat(row.spend ?? '0');
      // Meta reports in account currency. For v1.3, assume USD. Document assumption here.
      const spendCurrency = 'USD';
      const spendUsd = await convertToUsd(adminClient, spendLocal, spendCurrency, spendDate);

      // hour_bucket: hourly_stats_aggregated_by_advertiser_time_zone returns 'YYYY-MM-DD HH:00:00+00:00'
      // Normalize to ISO timestamptz.
      const hourSlot = row.hourly_stats_aggregated_by_advertiser_time_zone ?? `${spendDate} 00:00:00+00:00`;
      // Convert 'YYYY-MM-DD HH:00:00+00:00' → 'YYYY-MM-DDTHH:00:00+00:00'
      const hourBucket = hourSlot.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T');

      rows.push({
        network: NETWORK,
        ad_account_id: accountId,
        ad_id: row.ad_id,
        campaign_id: row.campaign_id,
        adset_id: row.adset_id,
        ad_name: row.ad_name,
        hour_bucket: hourBucket,
        spend_date: spendDate,
        spend_local: spendLocal,
        spend_currency: spendCurrency,
        spend_usd_at_spend_date: spendUsd,
        clicks: parseInt(row.clicks ?? '0', 10),
        impressions: parseInt(row.impressions ?? '0', 10),
        conversions: extractConversions(row.actions),
      });
    }

    if (rows.length > 0) {
      await upsertAdSpendFacts(adminClient, rows);
      totalUpserted += rows.length;
    }

    nextUrl = page.paging?.next ?? null;
  }

  return { rows_upserted: totalUpserted };
}

async function handleRun(_req: Request): Promise<Response> {
  const token = Deno.env.get('META_ACCESS_TOKEN') ?? '';
  const accountId = Deno.env.get('META_AD_ACCOUNT_ID') ?? '';

  // D-01: Vendor-gate. Return 200 OK if credentials absent.
  if (!token || !accountId) {
    await writeHealth(admin, NETWORK, { credentials_present: false });
    return jsonResponse(200, { ok: true, skipped: 'credentials_missing' });
  }

  try {
    const result = await runMetaETL(admin, token, accountId);
    await writeHealth(admin, NETWORK, {
      credentials_present: true,
      last_success_at: new Date().toISOString(),
    });
    return jsonResponse(200, { ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[ad-spend-cron-meta] ETL failed: ${msg}`);
    await writeHealth(admin, NETWORK, {
      credentials_present: true,
      last_error: msg,
    });
    return jsonError(500, 'meta_etl_failed');
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
  return handleRun(req);
});

export const __internal = { handleRun, setAdminForTest, resetAdminForTest, runMetaETL, lookupFxRate };
