/**
 * Vitest-friendly mirror of supabase/functions/rag-scrape-runner/cost-ledger.ts.
 *
 * Phase 50 Plan 50-04 D-30 — same logic, imports `@supabase/supabase-js`
 * (no `npm:` prefix) so vitest can resolve. See diff-detector.ts mirror header
 * for rationale.
 *
 * If you modify this file, ALSO modify
 * `supabase/functions/rag-scrape-runner/cost-ledger.ts` to match.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type RagVendor = 'firecrawl' | 'openai_embed' | 'anthropic_summary' | 'resend';

export type CostStatus = 'ok' | 'warn' | 'capped';

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

export async function gateOrThrow(
  client: SupabaseClient,
  vendor: RagVendor,
): Promise<void> {
  const s = await getMtdStatus(client, vendor);
  if (s.status === 'capped') {
    throw new CostCapExceededError(vendor, s.mtdUsd, s.capUsd);
  }
}

export async function sendEightyPctEmail(
  client: SupabaseClient,
  vendor: RagVendor,
  mtdUsd: number,
  capUsd: number,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const probe: any = await client
    .from('rag_budget_alerts_sent')
    .select('vendor', { count: 'exact', head: true });
  if (probe?.error) {
    const code = probe.error.code ?? '';
    const msg = probe.error.message ?? '';
    if (code === 'PGRST205' || code === '42P01' || /not.*found|does not exist/i.test(msg)) {
      console.warn(
        `[cost-ledger] sendEightyPctEmail no-op: rag_budget_alerts_sent table missing (Plan 50-09 finalizes). vendor=${vendor} mtd=${mtdUsd} cap=${capUsd}`,
      );
      return;
    }
    console.error(`[cost-ledger] sendEightyPctEmail probe failed: ${msg}`);
    return;
  }
  console.warn(
    `[cost-ledger] sendEightyPctEmail (Plan 50-09 placeholder) would send vendor=${vendor} mtd=${mtdUsd} cap=${capUsd}`,
  );
}

export const ESTIMATED_COST_USD = {
  firecrawlSingleScrape: 0.001,
  firecrawlCrawlPage: 0.002,
  openaiEmbedChunk: 0.00003,
  anthropicSummaryChunk: 0.105,
  resendEmail: 0.0001,
} as const;
