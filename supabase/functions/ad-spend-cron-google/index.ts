/**
 * `ad-spend-cron-google` Edge Function — Phase 33 plan 33-03.
 *
 * Hourly cron that pulls ad-spend facts from the Google Ads REST API
 * (searchStream endpoint, v24) and upserts them into `ad_spend_facts`.
 *
 * Key design decisions:
 * - D-01: Vendor-gated health-check. Returns 200 OK with
 *   `{ok:true, skipped:'credentials_missing'}` when ANY of the 5 required Google
 *   secrets are absent (GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID,
 *   GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN).
 * - D-03: 6 secrets total including GOOGLE_ADS_LOGIN_CUSTOMER_ID (optional; falls
 *   back to CUSTOMER_ID if absent for direct non-MCC accounts).
 * - D-04: Replays last 72h on each tick (idempotent via ON CONFLICT).
 * - T-33-03-01: Never logs credential values. Logs only `credentials_present: true/false`.
 * - T-33-03-02: checkServiceRoleBearer validates Bearer on every request.
 *
 * RESEARCH notes:
 * - searchStream returns NDJSON (newline-delimited JSON). Parse each line separately.
 * - cost_micros is denominated in the account currency (micro-units). Divide by 1_000_000.
 * - segments.hour is 0-23 integer → pad to 2 digits for hour_bucket ISO string.
 * - Google Ads typically bills in account currency; assume USD for v1.3.
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

const NETWORK = 'google' as const;
const GOOGLE_ADS_API_VERSION = 'v24';
const GOOGLE_OAUTH2_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// YYYY-MM-DD helper.
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Exchange OAuth2 refresh token for a short-lived access token. */
async function exchangeRefreshToken(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<string> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
    grant_type: 'refresh_token',
  });

  const resp = await fetch(GOOGLE_OAUTH2_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`google_oauth2_token_exchange_failed: status=${resp.status} body=${text.slice(0, 200)}`);
  }

  const json = await resp.json() as { access_token?: string; error?: string };
  if (!json.access_token) {
    throw new Error(`google_oauth2_no_access_token: ${JSON.stringify(json).slice(0, 200)}`);
  }

  return json.access_token;
}

interface GoogleSearchStreamResult {
  adGroupAd?: {
    ad?: {
      id?: string;
    };
  };
  campaign?: { id?: string };
  adGroup?: { id?: string };
  metrics?: {
    costMicros?: string;
    clicks?: string;
    impressions?: string;
    conversions?: string;
  };
  segments?: {
    date?: string;
    hour?: number;
  };
}

export async function runGoogleETL(
  adminClient: SupabaseClient,
  accessToken: string,
  customerId: string,
  developerToken: string,
  loginCustomerId: string,
): Promise<{ rows_upserted: number }> {
  const now = new Date();
  const since = toDateStr(new Date(now.getTime() - 72 * 60 * 60 * 1000));
  const until = toDateStr(now);

  const gaql = `SELECT ad_group_ad.ad.id, campaign.id, ad_group.id, metrics.clicks, metrics.cost_micros, metrics.impressions, metrics.conversions, segments.date, segments.hour FROM ad_group_ad WHERE segments.date BETWEEN '${since}' AND '${until}'`;

  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'login-customer-id': loginCustomerId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: gaql }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`google_ads_searchstream_failed: status=${resp.status} body=${text.slice(0, 200)}`);
  }

  // searchStream response is NDJSON — split on newlines and parse each non-empty line.
  const text = await resp.text();
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  const rows: AdSpendRow[] = [];

  for (const line of lines) {
    let parsed: { results?: GoogleSearchStreamResult[] };
    try {
      parsed = JSON.parse(line) as { results?: GoogleSearchStreamResult[] };
    } catch {
      // Non-JSON line (could be array bracket or separator) — skip.
      continue;
    }

    for (const result of parsed.results ?? []) {
      const adId = result.adGroupAd?.ad?.id ?? '';
      if (!adId) continue;

      const campaignId = result.campaign?.id ?? undefined;
      const adGroupId = result.adGroup?.id ?? undefined;
      const costMicros = Number(result.metrics?.costMicros ?? '0');
      const spendLocal = costMicros / 1_000_000;
      const clicks = Number(result.metrics?.clicks ?? '0');
      const impressions = Number(result.metrics?.impressions ?? '0');
      const conversions = Number(result.metrics?.conversions ?? '0');
      const spendDate = result.segments?.date ?? since;
      const hour = result.segments?.hour ?? 0;

      // Construct ISO timestamptz hour_bucket.
      const hourBucket = `${spendDate}T${String(hour).padStart(2, '0')}:00:00+00:00`;

      // Google Ads bills in account currency. For v1.3, assume USD for US accounts.
      const spendCurrency = 'USD';
      const spendUsd = await convertToUsd(adminClient, spendLocal, spendCurrency, spendDate);

      rows.push({
        network: NETWORK,
        ad_account_id: customerId,
        ad_id: adId,
        campaign_id: campaignId,
        adset_id: adGroupId,
        hour_bucket: hourBucket,
        spend_date: spendDate,
        spend_local: spendLocal,
        spend_currency: spendCurrency,
        spend_usd_at_spend_date: spendUsd,
        clicks,
        impressions,
        conversions,
      });
    }
  }

  if (rows.length > 0) {
    await upsertAdSpendFacts(adminClient, rows);
  }

  return { rows_upserted: rows.length };
}

async function handleRun(_req: Request): Promise<Response> {
  const developerToken = Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN') ?? '';
  const customerId = Deno.env.get('GOOGLE_ADS_CUSTOMER_ID') ?? '';
  const loginCustomerId = Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID') ?? customerId;
  const clientId = Deno.env.get('GOOGLE_ADS_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('GOOGLE_ADS_CLIENT_SECRET') ?? '';
  const refreshToken = Deno.env.get('GOOGLE_ADS_REFRESH_TOKEN') ?? '';

  // D-01: Vendor-gate. Check all 5 required secrets (login_customer_id is optional, falls back to customer_id).
  if (!developerToken || !customerId || !clientId || !clientSecret || !refreshToken) {
    await writeHealth(admin, NETWORK, { credentials_present: false });
    return jsonResponse(200, { ok: true, skipped: 'credentials_missing' });
  }

  try {
    // Exchange refresh token for short-lived access token.
    const accessToken = await exchangeRefreshToken({ clientId, clientSecret, refreshToken });

    const result = await runGoogleETL(admin, accessToken, customerId, developerToken, loginCustomerId);

    await writeHealth(admin, NETWORK, {
      credentials_present: true,
      last_success_at: new Date().toISOString(),
    });
    return jsonResponse(200, { ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[ad-spend-cron-google] ETL failed: ${msg}`);
    await writeHealth(admin, NETWORK, {
      credentials_present: true,
      last_error: msg,
    });
    return jsonError(500, 'google_etl_failed');
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
  return handleRun(req);
});

export const __internal = { handleRun, setAdminForTest, resetAdminForTest, runGoogleETL, exchangeRefreshToken };
