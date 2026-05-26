/**
 * Phase 60 Plan 60-14 — cost-api browser client.
 *
 * Typed wrappers over:
 *   - rag-cost-query Edge Fn  (PostHog $ai_generation aggregation → vendor MTD + sparkline)
 *   - rag_acknowledge_budget_cap SECDEF RPC (defined in 20281201000011_rag_budget_caps.sql)
 *   - rag_budget_caps PostgREST read (RLS staff-only SELECT)
 *
 * Security notes:
 *   - All calls require authenticated Supabase session (is_staff gate enforced
 *     server-side by Edge Fn + SECDEF RPC — browser check is UX only)
 *   - T-60-14-PII-1: Edge Fn strips all columns except day+cost before responding;
 *     this client only extracts { vendor, mtd_usd, sparkline_7d, last_day_with_data }
 *     from the response — no PII fields are mapped or forwarded
 *
 * See: supabase/functions/rag-cost-query/index.ts
 */
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Vendor identifiers — must match ALLOWED_VENDORS in rag-cost-query/index.ts */
export type Vendor =
  | 'firecrawl'
  | 'openai_embed'
  | 'anthropic_summarize'
  | 'cohere_rerank'
  | 'jina_rerank'
  | 'federated_fetch';

/** Trace rollup identifiers for cron-row aggregations */
export type TraceRollup = 'coach_synthesis' | 'tip_of_day' | 'newsletter';

/**
 * Response shape for each vendor/trace-rollup cost row.
 * T-60-14-PII-1: only cost-related fields; no per-user fields.
 */
export interface CostRollupResponse {
  vendor: Vendor | string;
  mtd_usd: number;
  sparkline_7d: number[];
  last_day_with_data: string | null;
}

/** Budget cap row from rag_budget_caps table */
export interface BudgetCapRow {
  vendor: Vendor;
  cap_usd: number;
  mtd_spend_usd: number;
  last_acknowledged_at: string | null;
  source_pause_state: boolean;
}

/** Discriminated error kind for contextual UI rendering */
export type CostApiErrorKind =
  | 'forbidden'
  | 'invalid_vendor'
  | 'upstream_rate_limited'
  | 'unknown';

/** Thrown by fetchCostRollup and acknowledgeBudgetCap on error */
export class CostApiError extends Error {
  readonly kind: CostApiErrorKind;

  constructor(kind: CostApiErrorKind, message?: string) {
    super(message ?? `cost-api:${kind}`);
    this.name = 'CostApiError';
    this.kind = kind;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface FnError {
  message?: string;
  status?: number;
}

function mapFnError(err: FnError | null | undefined): CostApiErrorKind {
  if (!err) return 'unknown';
  const msg = (err.message ?? '').toLowerCase();
  const status = err.status ?? 0;
  if (status === 403 || msg.includes('forbidden')) return 'forbidden';
  if (status === 400 || msg.includes('invalid_vendor')) return 'invalid_vendor';
  if (status === 429 || msg.includes('upstream_rate_limited')) return 'upstream_rate_limited';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// fetchCostRollup
// ---------------------------------------------------------------------------

/**
 * Fetch per-vendor MTD cost + 7-day sparkline from the rag-cost-query Edge Fn.
 *
 * T-60-14-PII-1: only { vendor, mtd_usd, sparkline_7d, last_day_with_data } are
 * extracted from the Edge Fn response — no per-user fields are forwarded.
 *
 * @param args.rangeDays  - Days to look back (default 30, max 90)
 * @param args.vendors    - Vendor identifiers to query (subset of ALLOWED_VENDORS)
 * @param args.traceRollups - Trace rollup identifiers (coach_synthesis, tip_of_day, newsletter)
 * @returns CostRollupResponse[] in request order
 * @throws CostApiError on auth failure, invalid vendor, or upstream error
 */
export async function fetchCostRollup(args: {
  rangeDays?: number;
  vendors?: Vendor[];
  traceRollups?: TraceRollup[];
}): Promise<CostRollupResponse[]> {
  const body = {
    rangeDays: args.rangeDays ?? 30,
    ...(args.vendors && args.vendors.length > 0 ? { vendors: args.vendors } : {}),
    ...(args.traceRollups && args.traceRollups.length > 0
      ? { traceRollups: args.traceRollups }
      : {}),
  };

  const { data, error } = await supabase.functions.invoke('rag-cost-query', { body });

  if (error) {
    const kind = mapFnError(error as FnError);
    throw new CostApiError(kind, (error as FnError).message);
  }

  // T-60-14-PII-1: extract only the safe subset of fields from each result row
  const rawResults = (data as { results: Array<Record<string, unknown>> }).results ?? [];
  return rawResults.map((row): CostRollupResponse => ({
    vendor: row['vendor'] as string,
    mtd_usd: row['mtd_usd'] as number,
    sparkline_7d: row['sparkline_7d'] as number[],
    last_day_with_data: (row['last_day_with_data'] as string | null) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// acknowledgeBudgetCap
// ---------------------------------------------------------------------------

/**
 * Acknowledge a vendor budget cap breach — calls rag_acknowledge_budget_cap SECDEF RPC.
 *
 * RPC re-checks is_staff() inside body (T-60-14-TAMPER-1 defense in depth).
 * On success: clears source_pause_state + sets last_acknowledged_at.
 *
 * @param vendor - The vendor identifier (must be in ALLOWED_VENDORS)
 * @throws CostApiError if RPC returns an error (e.g., forbidden, unknown vendor)
 */
export async function acknowledgeBudgetCap(vendor: Vendor): Promise<void> {
  const { error } = await supabase.rpc('rag_acknowledge_budget_cap', {
    p_vendor: vendor,
  });

  if (error) {
    const kind = mapFnError(error as FnError);
    throw new CostApiError(kind, (error as FnError).message ?? 'rpc error');
  }
}

// ---------------------------------------------------------------------------
// fetchBudgetCaps
// ---------------------------------------------------------------------------

/**
 * Read all vendor budget caps from rag_budget_caps table (RLS staff-only SELECT).
 *
 * Used by RagCostPage to determine:
 *   - cap_usd for CostBar + budget caption
 *   - source_pause_state for auto-pause banner trigger
 *   - last_acknowledged_at for display
 *
 * @returns BudgetCapRow[] — all 6 vendor rows seeded by migration 20281201000011
 * @throws CostApiError on RLS denial or network error
 */
export async function fetchBudgetCaps(): Promise<BudgetCapRow[]> {
  const { data, error } = await supabase
    .from('rag_budget_caps')
    .select('vendor, cap_usd, mtd_spend_usd, last_acknowledged_at, source_pause_state');

  if (error) {
    throw new CostApiError('unknown', (error as { message?: string }).message);
  }

  return (data as BudgetCapRow[]) ?? [];
}
