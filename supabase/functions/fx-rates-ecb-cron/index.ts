/**
 * `fx-rates-ecb-cron` Edge Function — Phase 33 plan 33-03.
 *
 * Daily cron (around 17:00 UTC, after ECB publishes at ~16:00 CET) that fetches
 * the ECB eurofxref daily XML and upserts FX rates into the `fx_rates` table.
 *
 * Key design decisions:
 * - No vendor-gate (ECB is a public endpoint, no credentials required).
 * - ON CONFLICT (currency, rate_date) DO NOTHING: weekend/holiday days have no
 *   new publication. This is handled gracefully — the last-known-rate fallback
 *   in lookupFxRate covers the gap for ETL fact rows.
 * - D-11: Spend-day FX rate stored at ETL write time. Missing rate → NULL USD column.
 * - Degraded mode: if ECB fetch fails, write admin notification + return 200.
 *   Do NOT throw — cron must succeed even when ECB is temporarily unavailable.
 * - DOES NOT call shutdownPostHog() — this fn does not use captureServer().
 *
 * RESEARCH notes:
 * - ECB XML URL: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
 * - Parse date via regex: time="(\d{4}-\d{2}-\d{2})"
 * - Parse rates via regex: currency="([A-Z]+)"\s+rate="([\d.]+)"
 * - Also add EUR base row: {currency:'EUR', rate_date, rate_eur_to_currency: 1.0}
 * - Use ignoreDuplicates:true for ON CONFLICT DO NOTHING semantics.
 */
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
import { writeAdminNotification } from '../_shared/ad-etl-utils.ts';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const ECB_FETCH_TIMEOUT_MS = 15_000;

interface FxRateRow {
  currency: string;
  rate_date: string;      // YYYY-MM-DD
  rate_eur_to_currency: number;
}

export async function runEcbETL(
  adminClient: ReturnType<typeof makeLazyAdmin>['admin'],
): Promise<{ ok: boolean; rate_date?: string; currencies_upserted?: number; error?: string }> {
  let xml: string;

  try {
    const resp = await fetch(ECB_URL, {
      signal: AbortSignal.timeout(ECB_FETCH_TIMEOUT_MS),
    });

    if (!resp.ok) {
      throw new Error(`ecb_fetch_failed: status=${resp.status}`);
    }

    xml = await resp.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Non-fatal: ECB may be temporarily unavailable. Log + notify admin.
    console.warn(`[fx-rates-ecb-cron] ECB fetch failed: ${msg}`);
    await writeAdminNotification(adminClient, {
      title: 'ECB FX rates fetch failed',
      body: `fx-rates-ecb-cron could not fetch ECB eurofxref XML: ${msg}`,
      type: 'ecb_fx_fetch_failed',
    });
    return { ok: false, error: 'ecb_fx_fetch_failed' };
  }

  // Parse rate_date: time="YYYY-MM-DD"
  const dateMatch = xml.match(/time="(\d{4}-\d{2}-\d{2})"/);
  if (!dateMatch || !dateMatch[1]) {
    throw new Error('ecb_xml_date_parse_failed');
  }
  const rateDate = dateMatch[1];

  // Parse currency rates: currency="USD" rate="1.08"
  const rows: FxRateRow[] = [];

  // Always include EUR base rate (EUR/EUR = 1.0 by definition).
  rows.push({
    currency: 'EUR',
    rate_date: rateDate,
    rate_eur_to_currency: 1.0,
  });

  const rateRegex = /currency="([A-Z]+)"\s+rate="([\d.]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = rateRegex.exec(xml)) !== null) {
    const currency = match[1];
    const rate = parseFloat(match[2]);
    if (currency && !isNaN(rate)) {
      rows.push({
        currency,
        rate_date: rateDate,
        rate_eur_to_currency: rate,
      });
    }
  }

  // Upsert with ON CONFLICT DO NOTHING (ignoreDuplicates:true).
  // Weekend/holiday: ECB doesn't publish new rates → existing rows silently kept.
  const { error } = await adminClient
    .from('fx_rates')
    .upsert(rows, { onConflict: 'currency,rate_date', ignoreDuplicates: true });

  if (error) {
    throw new Error(`ecb_upsert_failed: ${error.message}`);
  }

  return {
    ok: true,
    rate_date: rateDate,
    currencies_upserted: rows.length,
  };
}

async function handleRun(_req: Request): Promise<Response> {
  try {
    const result = await runEcbETL(admin);
    return jsonResponse(result.ok ? 200 : 200, { ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[fx-rates-ecb-cron] unhandled error: ${msg}`);

    // ecb_xml_date_parse_failed is a specific error worth surfacing.
    if (msg === 'ecb_xml_date_parse_failed') {
      return jsonError(500, 'ecb_xml_date_parse_failed');
    }

    return jsonError(500, 'ecb_etl_failed');
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
  return handleRun(req);
});

export const __internal = { handleRun, setAdminForTest, resetAdminForTest, runEcbETL };
