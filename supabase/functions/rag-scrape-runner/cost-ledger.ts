/**
 * Cost-ledger helpers for Phase 50 Plan 50-04 rag-scrape-runner.
 *
 * Implements D-30: every paid vendor call writes a `rag_cost_ledger` row;
 * the runner gates further calls when MTD spend hits 100% of the configured
 * `rag_budget_caps.monthly_cap_usd`; the runner sends an 80% threshold email
 * (idempotent per vendor + month).
 *
 * MTD is computed via the SECURITY DEFINER RPC `public.rag_mtd_spend_by_vendor()`
 * shipped in Plan 50-01 (migration 20260519000007).
 *
 * Estimated costs per vendor (used when the vendor response doesn't carry the
 * actual charge):
 *   - Firecrawl single scrape: $0.001
 *   - Firecrawl crawl-discovered page: $0.002
 *   - OpenAI text-embedding-3-small per chunk (~1500 tok): $0.00003
 *   - Anthropic claude-sonnet-4 summary per chunk: ~$0.105
 *   - Resend transactional email: $0.0001
 *
 * @internal Edge Function / Deno runtime only.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type RagVendor = 'firecrawl' | 'openai_embed' | 'anthropic_summary' | 'resend' | 'anthropic_tip_of_day' | 'anthropic_newsletter';

export type CostStatus = 'ok' | 'warn' | 'capped';

/**
 * Thrown by gateOrThrow when MTD ≥ 100% of cap. Caller (rag-scrape-runner)
 * catches this and:
 *   1. Sets `rag_sources.paused_at` for the in-progress source.
 *   2. Returns the topic-run with status='partial' and error_message.
 *   3. Does NOT advance `next_scrape_at` (resume on next cron tick after
 *      admin acknowledges).
 */
export class CostCapExceededError extends Error {
  public readonly vendor: RagVendor;
  public readonly mtdUsd: number;
  public readonly capUsd: number;
  constructor(vendor: RagVendor, mtdUsd: number, capUsd: number) {
    super(
      `Monthly budget cap exceeded for ${vendor}: $${mtdUsd.toFixed(2)} / $${capUsd.toFixed(2)} (>=100%)`,
    );
    this.name = 'CostCapExceededError';
    this.vendor = vendor;
    this.mtdUsd = mtdUsd;
    this.capUsd = capUsd;
  }
}

export interface LogVendorCostArgs {
  vendor: RagVendor;
  amountUsd: number;
  topicId?: string | null;
  sourceId?: string | null;
  action: string;
  meta?: Record<string, unknown>;
}

/**
 * Insert a single `rag_cost_ledger` row. Service-role client only (RLS denies
 * INSERT to anon/authenticated). Idempotency is intentionally NOT enforced —
 * every vendor call should produce one row even if the runner is retried,
 * because the vendor still charged us on the retry.
 */
export async function logVendorCost(
  client: SupabaseClient,
  args: LogVendorCostArgs,
): Promise<void> {
  const { error } = await client.from('rag_cost_ledger').insert({
    vendor: args.vendor,
    amount_usd: args.amountUsd,
    topic_id: args.topicId ?? null,
    source_id: args.sourceId ?? null,
    action: args.action,
    meta: args.meta ?? {},
  });
  if (error) {
    // Don't throw — cost-ledger write failure shouldn't kill the scrape run.
    // Log loudly so it shows up in Supabase function logs.
    console.error(
      `[cost-ledger] logVendorCost INSERT failed vendor=${args.vendor} amount=${args.amountUsd} err=${error.message}`,
    );
  }
}

export interface MtdStatus {
  vendor: RagVendor;
  pctUsed: number;
  mtdUsd: number;
  capUsd: number;
  status: CostStatus;
}

/**
 * Classify the per-vendor MTD spend against the configured cap:
 *   - status='ok'      when pct_used < 80
 *   - status='warn'    when 80 <= pct_used < 100
 *   - status='capped'  when pct_used >= 100
 *
 * Returns the row for the requested vendor (one row per vendor in
 * `rag_budget_caps`). Throws if the RPC fails OR the vendor row is missing.
 */
export async function getMtdStatus(
  client: SupabaseClient,
  vendor: RagVendor,
): Promise<MtdStatus> {
  const { data, error } = await client.rpc('rag_mtd_spend_by_vendor');
  if (error) {
    throw new Error(`[cost-ledger] rag_mtd_spend_by_vendor RPC failed: ${error.message}`);
  }
  if (!data || !Array.isArray(data)) {
    throw new Error('[cost-ledger] rag_mtd_spend_by_vendor returned no rows');
  }
  const row = (data as Array<{
    vendor: string;
    mtd_usd: number | string;
    monthly_cap_usd: number | string;
    pct_used: number | string;
  }>).find((r) => r.vendor === vendor);
  if (!row) {
    throw new Error(`[cost-ledger] no rag_budget_caps row for vendor=${vendor}`);
  }
  const pctUsed = Number(row.pct_used);
  const mtdUsd = Number(row.mtd_usd);
  const capUsd = Number(row.monthly_cap_usd);
  let status: CostStatus;
  if (pctUsed >= 100) status = 'capped';
  else if (pctUsed >= 80) status = 'warn';
  else status = 'ok';
  return { vendor, pctUsed, mtdUsd, capUsd, status };
}

/**
 * Short-circuit gate: throws CostCapExceededError if MTD ≥ 100% of cap.
 * Called by rag-scrape-runner BEFORE each Firecrawl request so we don't
 * incur a paid call after the cap.
 */
export async function gateOrThrow(
  client: SupabaseClient,
  vendor: RagVendor,
): Promise<void> {
  const s = await getMtdStatus(client, vendor);
  if (s.status === 'capped') {
    throw new CostCapExceededError(vendor, s.mtdUsd, s.capUsd);
  }
}

/**
 * Send the 80%-threshold email exactly once per vendor + month. Idempotency
 * is enforced by `rag_budget_caps.last_paused_at` for the 100% path and by
 * a presence check on `rag_budget_caps.last_acknowledged_at` cleared each
 * new month for the 80% path.
 *
 * MVP behavior: if the dedicated `rag_budget_alerts_sent` table does not
 * exist (Plan 50-09 finalizes that), this function logs the warning and
 * returns without throwing — the threshold email path is no-op until 50-09
 * ships per [[reference_vendor_gated_send_health_check]].
 */
export async function sendEightyPctEmail(
  client: SupabaseClient,
  vendor: RagVendor,
  mtdUsd: number,
  capUsd: number,
): Promise<void> {
  // Detect whether the alerts-sent dedupe table exists. If not, no-op.
  // We probe via a HEAD select; missing table returns code 42P01 (undefined_table).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const probe: any = await client
    .from('rag_budget_alerts_sent')
    .select('vendor', { count: 'exact', head: true });
  if (probe?.error) {
    // PGRST205 = relation not found in PostgREST; 42P01 = undefined_table.
    const code = probe.error.code ?? '';
    const msg = probe.error.message ?? '';
    if (code === 'PGRST205' || code === '42P01' || /not.*found|does not exist/i.test(msg)) {
      console.warn(
        `[cost-ledger] sendEightyPctEmail no-op: rag_budget_alerts_sent table missing (Plan 50-09 finalizes). vendor=${vendor} mtd=${mtdUsd} cap=${capUsd}`,
      );
      return;
    }
    // Some other unexpected error — log and return (don't throw, email is best-effort).
    console.error(`[cost-ledger] sendEightyPctEmail probe failed: ${msg}`);
    return;
  }
  // Future Plan 50-09 path: check existing alert row, then send via Resend
  // + insert dedupe row. Stubbed here so callers can wire it now.
  console.warn(
    `[cost-ledger] sendEightyPctEmail (Plan 50-09 placeholder) would send vendor=${vendor} mtd=${mtdUsd} cap=${capUsd}`,
  );
}

/**
 * Recommended estimated costs (USD) for runner callers — single source of
 * truth so the estimates stay in sync with D-30 and the per-vendor cap math.
 */
export const ESTIMATED_COST_USD = {
  firecrawlSingleScrape: 0.001,
  firecrawlCrawlPage: 0.002,
  openaiEmbedChunk: 0.00003,
  anthropicSummaryChunk: 0.105,
  resendEmail: 0.0001,
} as const;
