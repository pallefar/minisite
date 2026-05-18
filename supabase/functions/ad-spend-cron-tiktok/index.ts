/**
 * `ad-spend-cron-tiktok` Edge Function — Phase 33 plan 33-03.
 *
 * Hourly cron that pulls ad-spend facts from the TikTok Business API
 * and upserts them into `ad_spend_facts`.
 *
 * This is the most fragile ETL per V13-5. Implementation details are explicit:
 *
 * - D-01: Vendor-gated health-check. Returns 200 OK with
 *   `{ok:true, skipped:'credentials_missing'}` when TIKTOK_ACCESS_TOKEN or
 *   TIKTOK_ADVERTISER_ID are absent.
 * - D-04: Replays last 168h (7 days) on each tick — TikTok's 7-day attribution
 *   restate window (V13-5 silent-drop mitigation). NOT 72h like Meta/Google.
 * - T-33-03-01: Never logs token values.
 * - T-33-03-02: checkServiceRoleBearer validates Bearer on every request.
 * - T-33-03-03: Max 3 retries with exponential backoff on 429/5xx.
 *
 * RESEARCH notes:
 * - Auth header is 'Access-Token' (NOT 'Authorization: Bearer') — TikTok-specific.
 * - No community SDK used — hand-rolled fetch wrapper per CONTEXT D-03 + V13-5.
 * - stat_time_hour format: 'YYYY-MM-DD HH:00:00' → normalize to ISO timestamptz.
 * - TikTok reports spend in account currency; assume USD for v1.3.
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
  convertToUsd,
} from '../_shared/ad-etl-utils.ts';
import type { AdSpendRow } from '../_shared/ad-etl-utils.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

const NETWORK = 'tiktok' as const;
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';
// D-04: 168h = 7 days replay window (NOT 72h — TikTok 7-day attribution restate).
const REPLAY_HOURS = 168;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 15_000;

// YYYY-MM-DD helper.
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface TikTokListItem {
  dimensions: {
    ad_id: string;
    stat_time_hour: string;  // 'YYYY-MM-DD HH:00:00'
  };
  metrics: {
    spend: string;
    impressions: string;
    clicks: string;
    conversions: string;
  };
}

interface TikTokResponse {
  code: number;
  message: string;
  data?: {
    list: TikTokListItem[];
    page_info: {
      has_more: boolean;
      total_number: number;
      page: number;
      page_size: number;
    };
  };
}

/**
 * Hand-rolled TikTok fetch wrapper with exponential backoff.
 * - Auth: 'Access-Token' header (NOT Authorization: Bearer) per TikTok spec.
 * - Retries on 429 or status >= 500 up to MAX_RETRIES times.
 * - Per-request timeout: AbortSignal.timeout(15_000).
 * - After MAX_RETRIES failures: throws 'tiktok_max_retries_exceeded'.
 */
export async function tiktokFetch(url: URL, accessToken: string): Promise<unknown> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(url.toString(), {
        headers: {
          'Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      // Network error or timeout — treat as 5xx for backoff.
      if (attempt >= MAX_RETRIES - 1) {
        throw new Error(`tiktok_max_retries_exceeded: ${e instanceof Error ? e.message : String(e)}`);
      }
      const backoff = 1000 * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    if (resp.status === 429 || resp.status >= 500) {
      if (attempt >= MAX_RETRIES - 1) {
        throw new Error(`tiktok_max_retries_exceeded: final_status=${resp.status}`);
      }
      const backoff = 1000 * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
      console.warn(`[ad-spend-cron-tiktok] Rate-limited or server error (status=${resp.status}), backoff=${Math.round(backoff)}ms, attempt=${attempt + 1}/${MAX_RETRIES}`);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`tiktok_api_error: status=${resp.status} body=${body.slice(0, 200)}`);
    }

    return await resp.json();
  }

  throw new Error('tiktok_max_retries_exceeded');
}

export async function runTikTokETL(
  adminClient: SupabaseClient,
  accessToken: string,
  advertiserId: string,
): Promise<{ rows_upserted: number }> {
  const now = new Date();
  // D-04: 168h = 7 days replay window for TikTok attribution restate.
  const startDate = toDateStr(new Date(now.getTime() - REPLAY_HOURS * 60 * 60 * 1000));
  const endDate = toDateStr(now);

  let page = 1;
  const pageSize = 100;
  let hasMore = true;
  let totalUpserted = 0;

  while (hasMore) {
    const url = new URL(`${TIKTOK_API_BASE}/report/integrated/get/`);
    url.searchParams.set('advertiser_id', advertiserId);
    url.searchParams.set('report_type', 'BASIC');
    url.searchParams.set('data_level', 'AUCTION_AD');
    url.searchParams.set('dimensions', JSON.stringify(['ad_id', 'stat_time_hour']));
    url.searchParams.set('metrics', JSON.stringify(['spend', 'impressions', 'clicks', 'conversions']));
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(pageSize));

    const rawData = await tiktokFetch(url, accessToken);
    const data = rawData as TikTokResponse;

    if (data.code !== 0) {
      throw new Error(`tiktok_api_error_code: code=${data.code} message=${data.message}`);
    }

    const list = data.data?.list ?? [];
    const pageInfo = data.data?.page_info;

    const rows: AdSpendRow[] = [];
    for (const item of list) {
      const spendDate = item.dimensions.stat_time_hour.slice(0, 10);
      const spendLocal = Number(item.metrics.spend);
      // TikTok reports in account currency. For v1.3, assume USD.
      const spendCurrency = 'USD';
      const spendUsd = await convertToUsd(adminClient, spendLocal, spendCurrency, spendDate);

      // Convert 'YYYY-MM-DD HH:00:00' → ISO timestamptz 'YYYY-MM-DDTHH:00:00+00:00'
      const hourBucket = item.dimensions.stat_time_hour.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T').replace(/(\d{2}:\d{2}:\d{2})$/, '$1+00:00');

      rows.push({
        network: NETWORK,
        ad_account_id: advertiserId,
        ad_id: item.dimensions.ad_id,
        hour_bucket: hourBucket,
        spend_date: spendDate,
        spend_local: spendLocal,
        spend_currency: spendCurrency,
        spend_usd_at_spend_date: spendUsd,
        clicks: Number(item.metrics.clicks),
        impressions: Number(item.metrics.impressions),
        conversions: Number(item.metrics.conversions),
      });
    }

    if (rows.length > 0) {
      await upsertAdSpendFacts(adminClient, rows);
      totalUpserted += rows.length;
    }

    hasMore = pageInfo?.has_more === true;
    page += 1;
  }

  return { rows_upserted: totalUpserted };
}

async function handleRun(_req: Request): Promise<Response> {
  const accessToken = Deno.env.get('TIKTOK_ACCESS_TOKEN') ?? '';
  const advertiserId = Deno.env.get('TIKTOK_ADVERTISER_ID') ?? '';

  // D-01: Vendor-gate. Return 200 OK if credentials absent.
  if (!accessToken || !advertiserId) {
    await writeHealth(admin, NETWORK, { credentials_present: false });
    return jsonResponse(200, { ok: true, skipped: 'credentials_missing' });
  }

  try {
    const result = await runTikTokETL(admin, accessToken, advertiserId);
    await writeHealth(admin, NETWORK, {
      credentials_present: true,
      last_success_at: new Date().toISOString(),
    });
    return jsonResponse(200, { ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[ad-spend-cron-tiktok] ETL failed: ${msg}`);
    await writeHealth(admin, NETWORK, {
      credentials_present: true,
      last_error: msg,
    });
    return jsonError(500, 'tiktok_etl_failed');
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
  return handleRun(req);
});

export const __internal = { handleRun, setAdminForTest, resetAdminForTest, tiktokFetch, runTikTokETL };
