/**
 * ad-revenue-etl Edge Function — Phase 56 Plan 02.
 *
 * Daily revenue pull from AdMob + AdSense reporting APIs.
 * Upserts rows into ad_revenue_facts; always stores full raw_payload jsonb.
 *
 * Design decisions:
 * - D-08: Publisher approval pending until Phase 70. When credentials are missing
 *   OR the reporting API returns 401/403, the Fn logs and skips that network
 *   gracefully — returns 200 with { network: 'skipped: unauthorized' } summary.
 * - T-56-04: Service-role bearer auth (vault pattern, mirrors ad-spend-cron).
 * - T-56-06: 401/403/missing-creds always returns 200 skip — ETL never crashes.
 *
 * EXPORTS (pure helpers at module top level — NOT inside Deno.serve):
 *   normalizeReportRow(network, rawRow) — maps known fields + always sets raw_payload
 *   computeEcpmRpm(impressions, revenue) — (revenue/impressions)*1000; 0 when impressions=0
 *
 * Deno top-level serve trap: Deno.serve() is called inside this module, so running
 * `deno test path/` against this file would bind a port. Tests MUST only import the
 * pure helpers (normalizeReportRow, computeEcpmRpm) and run with --no-check.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

// =============================================================================
// Types
// =============================================================================

export type AdRevenueNetwork = 'admob' | 'adsense';

export interface RevenueFactRow {
  network: AdRevenueNetwork;
  placement_id: string | null;
  report_date: string;           // YYYY-MM-DD
  impressions: number;
  clicks: number;
  fill_rate: number | null;
  estimated_revenue_usd: number;
  ecpm_usd: number | null;
  rpm_usd: number | null;
  raw_payload: Record<string, unknown>;
  etl_run_at: string;            // ISO timestamptz
}

// =============================================================================
// Pure exported helpers (unit-testable without port bind)
// =============================================================================

/**
 * computeEcpmRpm
 * Returns (revenue / impressions) * 1000.
 * Returns 0 when impressions === 0 to avoid divide-by-zero.
 */
export function computeEcpmRpm(impressions: number, revenue: number): number {
  if (impressions === 0) return 0;
  return (revenue / impressions) * 1000;
}

/**
 * normalizeReportRow
 * Maps known reporting API fields into a canonical RevenueFactRow.
 * ALWAYS sets raw_payload to the full rawRow — field names TBD until P70 (Open Q1).
 *
 * Supports both AdMob (estimated_revenue field) and AdSense (estimated_earnings field).
 * Missing fields default to 0/null so the Fn never throws on unknown API shapes.
 */
export function normalizeReportRow(
  network: AdRevenueNetwork,
  // deno-lint-ignore no-explicit-any
  rawRow: Record<string, any>,
): Omit<RevenueFactRow, 'report_date' | 'placement_id' | 'rpm_usd' | 'etl_run_at'> {
  const impressions = Number(rawRow['impressions'] ?? 0) || 0;
  const clicks = Number(rawRow['clicks'] ?? 0) || 0;

  // AdMob uses 'estimated_revenue'; AdSense may use 'estimated_earnings'
  const revenueRaw = rawRow['estimated_revenue'] ?? rawRow['estimated_earnings'] ?? 0;
  const estimated_revenue_usd = Number(revenueRaw) || 0;

  // fill_rate: AdMob uses 'match_rate'; AdSense may use 'fill_rate'
  const fillRaw = rawRow['match_rate'] ?? rawRow['fill_rate'] ?? null;
  const fill_rate = fillRaw !== null ? (Number(fillRaw) || null) : null;

  const ecpm_usd = computeEcpmRpm(impressions, estimated_revenue_usd);

  return {
    network,
    impressions,
    clicks,
    fill_rate,
    estimated_revenue_usd,
    ecpm_usd: ecpm_usd || null,
    raw_payload: rawRow,
  };
}

// =============================================================================
// Internal ETL helpers
// =============================================================================

function getSupabaseAdmin() {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

function checkServiceRoleBearer(req: Request): boolean {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return token === serviceKey;
}

async function fetchNetworkReport(
  network: AdRevenueNetwork,
): Promise<{ rows: Record<string, unknown>[]; skipped?: string }> {
  if (network === 'admob') {
    const creds = Deno.env.get('ADMOB_REPORTING_CREDENTIALS');
    if (!creds) {
      return { rows: [], skipped: 'unauthorized: ADMOB_REPORTING_CREDENTIALS not set' };
    }
    // In Phase 56 publisher approval is pending — attempt call, handle 401/403 gracefully.
    try {
      // Placeholder: real AdMob Reporting API call goes here at Phase 70.
      // For now, return empty rows — credentials absent means skip.
      return { rows: [], skipped: 'unauthorized: publisher approval pending (Phase 70)' };
    } catch {
      return { rows: [], skipped: 'unauthorized: AdMob API error' };
    }
  }

  if (network === 'adsense') {
    const creds = Deno.env.get('ADSENSE_REPORTING_CREDENTIALS');
    if (!creds) {
      return { rows: [], skipped: 'unauthorized: ADSENSE_REPORTING_CREDENTIALS not set' };
    }
    try {
      // Placeholder: real AdSense Reporting API call goes here at Phase 70.
      return { rows: [], skipped: 'unauthorized: publisher approval pending (Phase 70)' };
    } catch {
      return { rows: [], skipped: 'unauthorized: AdSense API error' };
    }
  }

  return { rows: [], skipped: 'unknown network' };
}

async function upsertRevenueRows(
  admin: ReturnType<typeof getSupabaseAdmin>,
  rows: RevenueFactRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await admin
    .from('ad_revenue_facts')
    .upsert(rows, {
      onConflict: 'network,placement_id,report_date',
    });
  if (error) throw new Error(`upsertRevenueRows failed: ${error.message}`);
}

// =============================================================================
// Edge Fn handler
// =============================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  // T-56-04: Reject non-service-role callers.
  if (!checkServiceRoleBearer(req)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = getSupabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);
  const etl_run_at = new Date().toISOString();

  const networks: AdRevenueNetwork[] = ['admob', 'adsense'];
  const summary: Record<string, string> = {};

  for (const network of networks) {
    const { rows, skipped } = await fetchNetworkReport(network);

    if (skipped) {
      // T-56-06: graceful skip — never throw on unauthorized/missing creds.
      console.log(`[ad-revenue-etl] ${network}: ${skipped}`);
      summary[network] = `skipped: ${skipped.replace('unauthorized: ', '')}`;
      continue;
    }

    if (rows.length === 0) {
      summary[network] = 'skipped: no rows returned';
      continue;
    }

    const factRows: RevenueFactRow[] = rows.map((raw) => {
      const normalized = normalizeReportRow(network, raw as Record<string, unknown>);
      return {
        ...normalized,
        placement_id: null,
        report_date: today,
        rpm_usd: null,
        etl_run_at,
      };
    });

    await upsertRevenueRows(admin, factRows);
    summary[network] = `ok: ${factRows.length} rows upserted`;
  }

  return new Response(JSON.stringify({ ok: true, date: today, summary }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
